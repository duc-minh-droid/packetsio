use std::collections::{BinaryHeap, HashMap};
use std::collections::VecDeque;
use std::cmp::Reverse;
use serde::Serialize;
use wasm_bindgen::prelude::*;

// ---------------------------------------------------------------------
// Core enums — Serialize so JSON snapshots carry them as plain strings.
// ---------------------------------------------------------------------

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
enum NodeType { Client, Router, Server }

impl NodeType {
    fn from_str(s: &str) -> NodeType {
        match s.to_lowercase().as_str() {
            "client" => NodeType::Client,
            "server" => NodeType::Server,
            _ => NodeType::Router,
        }
    }
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
enum PacketState { Ready, Travelling, Queued, Delivered, Dropped }

enum EnterResult { Entered, Queued, Dropped }

struct Node {
    id: usize,
    node_type: NodeType,
}

struct Packet {
    id: usize,
    state: PacketState,
    current_node_id: usize,
    destination: usize,
    remaining: usize,
    // latency of the link currently being traversed — captured at
    // start_travel so we can compute 0.0..1.0 animation progress.
    link_latency: usize,
    current_link: Option<(usize, usize)>,
    arrived_link: Option<(usize, usize)>,
    ttl: usize,
    start_tick: usize,
    has_started: bool,
}

impl Packet {
    fn start_travel(&mut self, link: &Link) {
        self.current_link = Some((link.from_node_id, link.to_node_id));
        self.remaining = link.latency;
        self.link_latency = link.latency.max(1);
    }
    fn end_travel(&mut self) {
        let (_, to) = self.current_link.unwrap();
        self.current_node_id = to;
        self.arrived_link = self.current_link;
        self.state = if self.current_node_id == self.destination {
            PacketState::Delivered
        } else {
            PacketState::Ready
        };
    }
    fn travel(&mut self, tick: usize, metrics: &mut Metrics) {
        self.remaining -= 1;
        if self.remaining > 0 {
            self.state = PacketState::Travelling;
        } else {
            self.end_travel();
            if matches!(self.state, PacketState::Delivered) {
                metrics.delivered += 1;
                metrics.total_latency += tick + 1 - self.start_tick;
            }
        }
    }
    fn advance_on_link(&mut self, link: &Link, tick: usize, metrics: &mut Metrics) {
        self.start_travel(link);
        self.travel(tick, metrics);
    }

    /// 0.0 at from_node, 1.0 at to_node — for the frontend to tween
    /// a packet's on-screen position between ticks.
    fn progress(&self) -> f64 {
        match self.state {
            PacketState::Travelling => {
                let elapsed = self.link_latency - self.remaining;
                elapsed as f64 / self.link_latency as f64
            }
            PacketState::Delivered => 1.0,
            _ => 0.0,
        }
    }
}

struct Link {
    from_node_id: usize,
    to_node_id: usize,
    latency: usize,
    capacity: usize,
    current_packets: usize,
    queue: VecDeque<usize>,
    active: bool,
    max_queue_size: usize,
}

impl Link {
    fn available(&self) -> bool {
        self.active && self.capacity > self.current_packets
    }
    fn leave(&mut self) {
        self.current_packets -= 1;
    }
    fn enter(&mut self, packet_id: usize) -> EnterResult {
        if self.available() {
            self.current_packets += 1;
            EnterResult::Entered
        } else if self.queue.len() < self.max_queue_size {
            self.queue.push_back(packet_id);
            EnterResult::Queued
        } else {
            EnterResult::Dropped
        }
    }
    fn dequeue(&mut self) -> Option<usize> {
        if self.available() {
            let packet_id = self.queue.pop_front()?;
            self.current_packets += 1;
            Some(packet_id)
        } else {
            None
        }
    }
}

struct Metrics {
    total_packets: usize,
    delivered: usize,
    dropped: usize,
    total_latency: usize,
    total_ticks: usize,
    max_queue_size: usize,
}

impl Metrics {
    fn delivery_rate(&self) -> f64 {
        if self.total_packets == 0 { 0.0 } else { self.delivered as f64 / self.total_packets as f64 }
    }
    fn average_latency(&self) -> f64 {
        if self.delivered == 0 { 0.0 } else { self.total_latency as f64 / self.delivered as f64 }
    }
    fn throughput(&self) -> f64 {
        if self.total_ticks == 0 { 0.0 } else { self.delivered as f64 / self.total_ticks as f64 }
    }
}

// ---------------------------------------------------------------------
// Routing — recomputed fresh from wherever a packet currently is, so
// adding/removing links or toggling `active` at runtime is safe.
// ---------------------------------------------------------------------

fn quickest_route(links: &HashMap<usize, Vec<Link>>, from: usize, to: usize) -> Option<Vec<usize>> {
    let mut distance: HashMap<usize, usize> = HashMap::new();
    let mut previous: HashMap<usize, usize> = HashMap::new();
    let mut heap: BinaryHeap<Reverse<(usize, usize)>> = BinaryHeap::new();

    for &k in links.keys() {
        distance.insert(k, usize::MAX);
    }
    distance.insert(from, 0);
    heap.push(Reverse((0, from)));

    while let Some(Reverse((current_distance, current))) = heap.pop() {
        if current_distance > *distance.get(&current).unwrap_or(&usize::MAX) {
            continue;
        }
        if let Some(neighbours) = links.get(&current) {
            for link in neighbours {
                if !link.active {
                    continue;
                }
                let neighbor_node_id = link.to_node_id;
                let new_distance = current_distance + link.latency;
                if new_distance < *distance.get(&neighbor_node_id).unwrap_or(&usize::MAX) {
                    distance.insert(neighbor_node_id, new_distance);
                    previous.insert(neighbor_node_id, current);
                    heap.push(Reverse((new_distance, neighbor_node_id)));
                }
            }
        }
    }

    if from == to {
        return Some(vec![from]);
    }
    let mut path: Vec<usize> = Vec::new();
    let mut current = to;
    while current != from {
        path.push(current);
        current = *previous.get(&current)?;
    }
    path.push(current);
    path.reverse();
    Some(path)
}

fn next_hop_link<'a>(links: &'a mut HashMap<usize, Vec<Link>>, current: usize, destination: usize) -> Option<&'a mut Link> {
    let path = quickest_route(links, current, destination)?;
    let next_node = *path.get(1)?;
    links.get_mut(&current)?
        .iter_mut()
        .find(|link| link.to_node_id == next_node && link.active)
}

// ---------------------------------------------------------------------
// Snapshot types — what actually crosses the wasm boundary as JSON.
// ---------------------------------------------------------------------

#[derive(Serialize)]
struct NodeSnapshot {
    id: usize,
    node_type: NodeType,
}

#[derive(Serialize)]
struct LinkSnapshot {
    from: usize,
    to: usize,
    latency: usize,
    capacity: usize,
    current_packets: usize,
    queue_len: usize,
    active: bool,
}

#[derive(Serialize)]
struct PacketSnapshot {
    id: usize,
    state: PacketState,
    from_node: usize,
    to_node: Option<usize>,
    /// 0.0 (just left from_node) .. 1.0 (arrived at to_node)
    progress: f64,
    ttl: usize,
}

#[derive(Serialize)]
struct SimSnapshot {
    tick: usize,
    finished: bool,
    nodes: Vec<NodeSnapshot>,
    links: Vec<LinkSnapshot>,
    packets: Vec<PacketSnapshot>,
}

// ---------------------------------------------------------------------
// Simulation — now supports building a topology piece by piece
// (add_node / add_link / spawn_packet) instead of only the one
// hard-coded default, and exposes snapshot() for real animation data.
// ---------------------------------------------------------------------

#[wasm_bindgen]
pub struct Simulation {
    nodes: HashMap<usize, Node>,
    links: HashMap<usize, Vec<Link>>,
    packets: Vec<Packet>,
    metrics: Metrics,
    tick: usize,
    next_packet_id: usize,
}

#[wasm_bindgen]
impl Simulation {
    /// Starts with an empty topology. Build it up with add_node /
    /// add_link / spawn_packet, or call load_default_topology() for
    /// the demo network.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Simulation {
        Simulation {
            nodes: HashMap::new(),
            links: HashMap::new(),
            packets: Vec::new(),
            metrics: Metrics { total_packets: 0, delivered: 0, dropped: 0, total_latency: 0, total_ticks: 0, max_queue_size: 0 },
            tick: 0,
            next_packet_id: 0,
        }
    }

    /// Wipes the current topology and loads the original 4-node demo
    /// network. Handy for a "Reset to demo" button.
    pub fn load_default_topology(&mut self) {
        self.nodes.clear();
        self.links.clear();
        self.packets.clear();
        self.metrics = Metrics { total_packets: 0, delivered: 0, dropped: 0, total_latency: 0, total_ticks: 0, max_queue_size: 0 };
        self.tick = 0;
        self.next_packet_id = 0;

        self.add_node(0, "client");
        self.add_node(1, "router");
        self.add_node(2, "server");
        self.add_node(3, "router");

        self.add_link(0, 1, 2, 1, 5);
        self.add_link(0, 3, 1, 1, 5);
        self.set_link_active(0, 3, false);
        self.add_link(1, 2, 3, 1, 5);
        self.add_link(3, 2, 2, 1, 5);

        self.spawn_packet(0, 2);
    }

    // -------------------------------------------------------------
    // Topology building — call these from JS to add nodes/links at
    // runtime, e.g. in response to a user dragging a new node in.
    // -------------------------------------------------------------

    pub fn add_node(&mut self, id: usize, kind: &str) {
        self.nodes.insert(id, Node { id, node_type: NodeType::from_str(kind) });
        self.links.entry(id).or_insert_with(Vec::new);
    }

    pub fn add_link(&mut self, from: usize, to: usize, latency: usize, capacity: usize, max_queue_size: usize) {
        self.links.entry(from).or_insert_with(Vec::new).push(Link {
            from_node_id: from,
            to_node_id: to,
            latency,
            capacity,
            current_packets: 0,
            queue: VecDeque::new(),
            active: true,
            max_queue_size,
        });
    }

    /// Returns true if a matching link was found and toggled.
    pub fn set_link_active(&mut self, from: usize, to: usize, active: bool) -> bool {
        if let Some(link) = self.links.get_mut(&from).and_then(|links| links.iter_mut().find(|l| l.to_node_id == to)) {
            link.active = active;
            true
        } else {
            false
        }
    }

    /// Adds a new packet travelling from -> to. Returns its unique id.
    pub fn spawn_packet(&mut self, from: usize, to: usize) -> usize {
        let id = self.next_packet_id;
        self.next_packet_id += 1;
        self.packets.push(Packet {
            id,
            state: PacketState::Ready,
            current_node_id: from,
            destination: to,
            remaining: 0,
            link_latency: 1,
            current_link: None,
            arrived_link: None,
            ttl: 5,
            start_tick: 0,
            has_started: false,
        });
        self.metrics.total_packets += 1;
        id
    }

    // -------------------------------------------------------------
    // Simulation stepping
    // -------------------------------------------------------------

    pub fn is_finished(&self) -> bool {
        !self.packets.is_empty()
            && self.packets.iter().all(|p| matches!(p.state, PacketState::Delivered | PacketState::Dropped))
    }

    pub fn step(&mut self) {
        let tick = self.tick;

        for p in self.packets.iter_mut() {
            match p.state {
                PacketState::Delivered | PacketState::Dropped => continue,
                _ => {}
            }
            if p.ttl == 0 {
                p.state = PacketState::Dropped;
                self.metrics.dropped += 1;
                continue;
            }
            p.ttl -= 1;
            match p.state {
                PacketState::Dropped => {}
                PacketState::Ready => {
                    match next_hop_link(&mut self.links, p.current_node_id, p.destination) {
                        None => {
                            p.state = PacketState::Dropped;
                            self.metrics.dropped += 1;
                        }
                        Some(link) => {
                            p.current_link = Some((link.from_node_id, link.to_node_id));
                            match link.enter(p.id) {
                                EnterResult::Entered => {
                                    if !p.has_started {
                                        p.has_started = true;
                                        p.start_tick = tick;
                                    }
                                    p.advance_on_link(link, tick, &mut self.metrics);
                                }
                                EnterResult::Queued => {
                                    p.state = PacketState::Queued;
                                }
                                EnterResult::Dropped => {
                                    p.state = PacketState::Dropped;
                                    self.metrics.dropped += 1;
                                }
                            }
                        }
                    }
                }
                PacketState::Queued => {
                    let (from, to) = p.current_link.unwrap();
                    if let Some(link) = self.links.get_mut(&from).and_then(|links| links.iter_mut().find(|l| l.to_node_id == to)) {
                        if link.dequeue() == Some(p.id) {
                            p.advance_on_link(link, tick, &mut self.metrics);
                        }
                    }
                }
                PacketState::Delivered => {}
                PacketState::Travelling => {
                    p.travel(tick, &mut self.metrics);
                }
            }
        }

        for p in self.packets.iter_mut() {
            if let Some((from, to)) = p.arrived_link.take() {
                if let Some(link) = self.links.get_mut(&from).and_then(|links| links.iter_mut().find(|l| l.to_node_id == to)) {
                    link.leave();
                }
            }
        }

        for neighbours in self.links.values() {
            for link in neighbours {
                self.metrics.max_queue_size = self.metrics.max_queue_size.max(link.queue.len());
            }
        }
        self.metrics.total_ticks += 1;
        self.tick += 1;
    }

    // -------------------------------------------------------------
    // The new piece: real per-tick data for animation, as a JSON
    // string. Call this after every step() (or on demand) and
    // JSON.parse() it in JS/TS.
    // -------------------------------------------------------------

    pub fn snapshot(&self) -> String {
        let nodes = self.nodes.values().map(|n| NodeSnapshot { id: n.id, node_type: n.node_type }).collect();

        let links = self.links.values().flatten().map(|l| LinkSnapshot {
            from: l.from_node_id,
            to: l.to_node_id,
            latency: l.latency,
            capacity: l.capacity,
            current_packets: l.current_packets,
            queue_len: l.queue.len(),
            active: l.active,
        }).collect();

        let packets = self.packets.iter().map(|p| PacketSnapshot {
            id: p.id,
            state: p.state,
            from_node: p.current_link.map(|(f, _)| f).unwrap_or(p.current_node_id),
            to_node: p.current_link.map(|(_, t)| t),
            progress: p.progress(),
            ttl: p.ttl,
        }).collect();

        let snap = SimSnapshot { tick: self.tick, finished: self.is_finished(), nodes, links, packets };
        serde_json::to_string(&snap).unwrap()
    }

    // -------------------------------------------------------------
    // Metrics getters (unchanged from before)
    // -------------------------------------------------------------

    pub fn current_tick(&self) -> usize { self.tick }
    pub fn delivered(&self) -> usize { self.metrics.delivered }
    pub fn dropped(&self) -> usize { self.metrics.dropped }
    pub fn total_packets(&self) -> usize { self.metrics.total_packets }
    pub fn delivery_rate(&self) -> f64 { self.metrics.delivery_rate() }
    pub fn average_latency(&self) -> f64 { self.metrics.average_latency() }
    pub fn throughput(&self) -> f64 { self.metrics.throughput() }
    pub fn max_queue_size(&self) -> usize { self.metrics.max_queue_size }
}

impl Default for Simulation {
    fn default() -> Self {
        Simulation::new()
    }
}