use std::collections::{BinaryHeap, HashMap};
use std::collections::VecDeque;
use std::cmp::Reverse;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Simulation {
    links: HashMap<usize, Vec<Link>>,
    packets: Vec<Packet>,
    metrics: Metrics,
    tick: usize,
}

#[wasm_bindgen]
impl Simulation {
    #[wasm_bindgen(constructor)]
    pub fn new_default() -> Simulation {
        // same topology main() used to build by hand
        let mut links: HashMap<usize, Vec<Link>> = HashMap::new();
        links.insert(0, vec![
            Link { from_node_id: 0, to_node_id: 1, latency: 2, capacity: 1, current_packets: 0, queue: VecDeque::new(), active: true, max_queue_size: 5 },
            Link { from_node_id: 0, to_node_id: 3, latency: 1, capacity: 1, current_packets: 0, queue: VecDeque::new(), active: false, max_queue_size: 5 },
        ]);
        links.insert(1, vec![Link { from_node_id: 1, to_node_id: 2, latency: 3, capacity: 1, current_packets: 0, queue: VecDeque::new(), active: true, max_queue_size: 5 }]);
        links.insert(3, vec![Link { from_node_id: 3, to_node_id: 2, latency: 2, capacity: 1, current_packets: 0, queue: VecDeque::new(), active: true, max_queue_size: 5 }]);

        let packets = create_packets(1, 0, 2, 0);
        let total_packets = packets.len();

        Simulation {
            links,
            packets,
            metrics: Metrics { total_packets, delivered: 0, dropped: 0, total_latency: 0, total_ticks: 0, max_queue_size: 0 },
            tick: 0,
        }
    }

    pub fn is_finished(&self) -> bool {
        self.packets.iter().all(|p| matches!(p.state, PacketState::Delivered | PacketState::Dropped))
    }

    pub fn step(&mut self) {
        let tick = self.tick;
        println!("tick {}", tick);

        for p in self.packets.iter_mut() {
            match p.state {
                PacketState::Delivered | PacketState::Dropped => continue,
                _ => {}
            }
            if p.ttl == 0 {
                p.state = PacketState::Dropped;
                self.metrics.dropped += 1;
                log(tick, p, "TTL EXPIRED");
                continue;
            }
            p.ttl -= 1;
            match p.state {
                PacketState::Dropped => { }
                PacketState::Ready => {
                    match next_hop_link(&mut self.links, p.current_node_id, p.destination) {
                        None => {
                            p.state = PacketState::Dropped;
                            self.metrics.dropped += 1;
                            log(tick, p, "NO ROUTE");
                        }
                        Some(quickest) => {
                            p.current_link = Some((quickest.from_node_id, quickest.to_node_id));
                            match quickest.enter(p.id) {
                                EnterResult::Entered => {
                                    if !p.has_started {
                                        p.has_started = true;
                                        p.start_tick = tick;
                                    }
                                    log(tick, p, "ENTER LINK");
                                    p.advance_on_link(quickest, tick, &mut self.metrics);
                                }
                                EnterResult::Queued => {
                                    p.state = PacketState::Queued;
                                    log(tick, p, "QUEUED");
                                }
                                EnterResult::Dropped => {
                                    p.state = PacketState::Dropped;
                                    self.metrics.dropped += 1;
                                    log(tick, p, "DROPPED");
                                }
                            }
                        }
                    }
                }
                PacketState::Queued => {
                    let (from, to) = p.current_link.unwrap();
                    let link = self.links.get_mut(&from).unwrap().iter_mut().find(|link| link.to_node_id == to).unwrap();
                    if link.dequeue() == Some(p.id) {
                        log(tick, p, "DEQUEUED");
                        p.advance_on_link(link, tick, &mut self.metrics);
                    }
                }
                PacketState::Delivered => { }
                PacketState::Travelling => {
                    p.travel(tick, &mut self.metrics);
                }
            }
        }

        for p in self.packets.iter_mut() {
            if let Some((from, to)) = p.arrived_link.take() {
                let link = self.links
                    .get_mut(&from)
                    .unwrap()
                    .iter_mut()
                    .find(|link| link.to_node_id == to)
                    .unwrap();

                link.leave();
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

    // wasm_bindgen can't export the Metrics struct directly, so we
    // expose plain getter methods JS can call: sim.delivered(), etc.
    pub fn delivered(&self) -> usize { self.metrics.delivered }
    pub fn dropped(&self) -> usize { self.metrics.dropped }
    pub fn total_packets(&self) -> usize { self.metrics.total_packets }
    pub fn delivery_rate(&self) -> f64 { self.metrics.delivery_rate() }
    pub fn average_latency(&self) -> f64 { self.metrics.average_latency() }
    pub fn throughput(&self) -> f64 { self.metrics.throughput() }
    pub fn max_queue_size(&self) -> usize { self.metrics.max_queue_size }
    pub fn current_tick(&self) -> usize { self.tick }
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

#[derive(Debug, Clone, Copy, PartialEq)]
enum PacketState { Ready, Travelling, Queued, Delivered, Dropped }

enum EnterResult { Entered, Queued, Dropped }

struct Packet {
    id: usize,
    state: PacketState,
    current_node_id: usize,
    destination: usize,
    remaining: usize,
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
            log(tick, self, "TRAVELLING");
        } else {
            self.end_travel();
            if matches!(self.state, PacketState::Delivered) {
                metrics.delivered += 1;
                metrics.total_latency += tick + 1 - self.start_tick;
            }
            log(tick, self, "ARRIVED");
        }
    }
    fn advance_on_link(&mut self, link: &Link, tick: usize, metrics: &mut Metrics) {
        self.start_travel(link);
        self.travel(tick, metrics);
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
        self.capacity > self.current_packets
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

fn create_packets(qty: usize, from: usize, to: usize, id_start: usize) -> Vec<Packet> {
    (0..qty).map(|i| Packet { id: id_start + i, state: PacketState::Ready, current_node_id: from, destination: to, remaining: 0, current_link: None, arrived_link: None, ttl: 5, start_tick: 0, has_started: false }).collect()
}

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
        if current_distance > distance[&current] {
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

fn log(tick: usize, packet: &Packet, event: &str) {
    println!(
        "[t={:>2}] P{} | {:<12} | node={} | state={:?} | remaining={}",
        tick, packet.id, event, packet.current_node_id, packet.state, packet.remaining
    );
}