use std::collections::{BTreeMap, HashMap};
use wasm_bindgen::prelude::*;

use crate::link::{EnterResult, Link};
use crate::metrics::{Metrics, TickStats};
use crate::node::{Node, NodeType, Route};
use crate::packet::{DropReason, Packet, PacketState, ProtocolKind, DEFAULT_TTL, MAX_HOLD_TICKS};
use crate::routing::{link_state_table, LinkMap};
use crate::snapshot::{
    EventKind, FlowSnapshot, LinkSnapshot, NodeSnapshot, PacketSnapshot, SimEvent, SimSnapshot,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RoutingProtocol {
    /// Distance vector, hop count metric, periodic synchronous updates
    Rip,
    /// Link-state, latency metric, recomputed whenever the topology changes
    Ospf,
    /// Link-state whose link cost includes current queue drain time
    Adaptive,
}

impl RoutingProtocol {
    pub fn name(&self) -> &'static str {
        match self {
            RoutingProtocol::Rip => "rip",
            RoutingProtocol::Ospf => "ospf",
            RoutingProtocol::Adaptive => "adaptive",
        }
    }
}

/// RIP's "infinity".
const RIP_INFINITY: usize = 16;

/// A traffic generator: every `interval` ticks from `start` until `stop`
/// (0 = forever), `burst` packets are spawned from `src` to `dst`.
#[derive(Clone, Debug)]
pub struct Flow {
    pub id: usize,
    pub src: usize,
    pub dst: usize,
    pub interval: usize,
    pub burst: usize,
    pub start: usize,
    pub stop: usize,
    pub protocol: ProtocolKind,
}

impl Flow {
    fn due(&self, tick: usize) -> bool {
        tick >= self.start
            && (self.stop == 0 || tick < self.stop)
            && (tick - self.start) % self.interval == 0
    }

    fn exhausted(&self, tick: usize) -> bool {
        self.stop != 0 && tick >= self.stop
    }
}

#[wasm_bindgen]
pub struct Simulation {
    nodes: BTreeMap<usize, Node>,
    links: LinkMap,
    packets: BTreeMap<usize, Packet>,
    flows: Vec<Flow>,
    metrics: Metrics,
    stats: TickStats,
    events: Vec<SimEvent>,
    pending_events: Vec<SimEvent>,
    pending_drops: usize,
    tick: usize,
    next_packet_id: usize,
    next_flow_id: usize,
    routing_protocol: RoutingProtocol,
    routes_dirty: bool,
    rip_update_interval: usize,
    adaptive_interval: usize,
}

fn find_link<'a>(links: &'a mut LinkMap, from: usize, to: usize) -> Option<&'a mut Link> {
    links.get_mut(&from)?.iter_mut().find(|l| l.to_node_id == to)
}

fn event(tick: usize, kind: EventKind) -> SimEvent {
    SimEvent { tick, kind, packet: None, node: None, link: None, reason: None, detail: None }
}

/// Book-keeping shared by every way a packet can be dropped.
fn record_drop(
    p: &mut Packet,
    reason: DropReason,
    tick: usize,
    metrics: &mut Metrics,
    nodes: &mut BTreeMap<usize, Node>,
    events: &mut Vec<SimEvent>,
) {
    let link = p.current_link;
    p.drop_with(reason, tick);
    metrics.dropped += 1;
    if reason == DropReason::QueueFull {
        metrics.total_congestion_drops += 1;
    }
    if let Some(n) = nodes.get_mut(&p.current_node_id) {
        n.dropped += 1;
    }
    events.push(SimEvent {
        packet: Some(p.id),
        node: Some(p.current_node_id),
        link,
        reason: Some(reason),
        ..event(tick, EventKind::Dropped)
    });
}

#[wasm_bindgen]
impl Simulation {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Simulation {
        Simulation {
            nodes: BTreeMap::new(),
            links: BTreeMap::new(),
            packets: BTreeMap::new(),
            flows: Vec::new(),
            metrics: Metrics::new(),
            stats: TickStats::default(),
            events: Vec::new(),
            pending_events: Vec::new(),
            pending_drops: 0,
            tick: 0,
            next_packet_id: 0,
            next_flow_id: 0,
            routing_protocol: RoutingProtocol::Ospf,
            routes_dirty: true,
            rip_update_interval: 3,
            adaptive_interval: 2,
        }
    }

    /// 0: client, 1: router, 2: server, 3: router. Two paths from client to
    /// server: 0-1-2 (latency 5) and 0-3-2 (latency 3, starts disabled).
    pub fn load_default_topology(&mut self) {
        self.add_node(0, "client");
        self.add_node(1, "router");
        self.add_node(2, "server");
        self.add_node(3, "router");

        // latency, bandwidth, capacity, max_queue_size
        self.add_duplex_link(0, 1, 2, 1, 2, 4);
        self.add_duplex_link(0, 3, 1, 1, 2, 4);
        self.add_duplex_link(1, 2, 3, 1, 2, 4);
        self.add_duplex_link(3, 2, 2, 1, 2, 4);

        self.set_link_active(0, 3, false);
        self.set_link_active(3, 0, false);

        self.spawn_packet(0, 2);
    }

    pub fn add_node(&mut self, id: usize, kind: &str) {
        self.nodes.insert(id, Node::new(id, NodeType::from_str(kind)));
        self.links.entry(id).or_default();
        self.routes_dirty = true;
    }

    /// Add (or reconfigure) a directed link.
    pub fn add_link(
        &mut self,
        from: usize,
        to: usize,
        latency: usize,
        bandwidth: usize,
        capacity: usize,
        max_queue_size: usize,
    ) {
        if !self.nodes.contains_key(&from) || !self.nodes.contains_key(&to) || from == to {
            return;
        }
        let neighbours = self.links.entry(from).or_default();
        if let Some(existing) = neighbours.iter_mut().find(|l| l.to_node_id == to) {
            existing.latency = latency.max(1);
            existing.bandwidth = bandwidth.max(1);
            existing.capacity = capacity.max(1);
            existing.max_queue_size = max_queue_size;
        } else {
            neighbours.push(Link::new(from, to, latency, bandwidth, capacity, max_queue_size));
        }
        self.routes_dirty = true;
    }

    /// Convenience: the same link in both directions.
    pub fn add_duplex_link(
        &mut self,
        a: usize,
        b: usize,
        latency: usize,
        bandwidth: usize,
        capacity: usize,
        max_queue_size: usize,
    ) {
        self.add_link(a, b, latency, bandwidth, capacity, max_queue_size);
        self.add_link(b, a, latency, bandwidth, capacity, max_queue_size);
    }

    /// Bring a link up or down. Taking a link down drops what is on the wire
    /// and sends queued packets back to the node to be rerouted.
    pub fn set_link_active(&mut self, from: usize, to: usize, active: bool) -> bool {
        let tick = self.tick;
        let Some(link) = find_link(&mut self.links, from, to) else {
            return false;
        };
        if link.active == active {
            return true;
        }
        link.active = active;
        let requeue: Vec<usize> = link.queue.drain(..).collect();
        self.routes_dirty = true;
        self.pending_events.push(SimEvent {
            link: Some((from, to)),
            detail: Some(if active { "up".into() } else { "down".into() }),
            ..event(tick, EventKind::LinkState)
        });
        if active {
            return true;
        }
        for id in requeue {
            if let Some(p) = self.packets.get_mut(&id) {
                p.state = PacketState::Ready;
                p.current_link = None;
                if let Some(entry) = p.queue_entry_tick.take() {
                    p.queued_ticks += tick.saturating_sub(entry);
                }
            }
        }
        for p in self.packets.values_mut() {
            if p.state == PacketState::Travelling && p.current_link == Some((from, to)) {
                record_drop(p, DropReason::LinkDown, tick, &mut self.metrics, &mut self.nodes, &mut self.pending_events);
                self.pending_drops += 1;
                if let Some(link) = find_link(&mut self.links, from, to) {
                    link.leave();
                }
            }
        }
        true
    }

    pub fn remove_link(&mut self, from: usize, to: usize) -> bool {
        if !self.set_link_active(from, to, false) {
            return false;
        }
        if let Some(v) = self.links.get_mut(&from) {
            v.retain(|l| l.to_node_id != to);
        }
        true
    }

    /// "rip", "ospf" or "adaptive". Routing tables are rebuilt from scratch.
    pub fn set_routing_protocol(&mut self, name: &str) {
        self.routing_protocol = match name.to_lowercase().as_str() {
            "rip" => RoutingProtocol::Rip,
            "adaptive" => RoutingProtocol::Adaptive,
            _ => RoutingProtocol::Ospf,
        };
        for n in self.nodes.values_mut() {
            n.routing_table.clear();
        }
        self.routes_dirty = true;
        self.refresh_routes();
    }

    pub fn routing_protocol(&self) -> String {
        self.routing_protocol.name().to_string()
    }

    /// Apply pending topology changes to routing tables now instead of at the
    /// start of the next tick (so the UI can show routes before playing).
    pub fn refresh_routes(&mut self) {
        if !self.routes_dirty {
            return;
        }
        self.routes_dirty = false;
        match self.routing_protocol {
            RoutingProtocol::Ospf => self.recompute_link_state(false),
            RoutingProtocol::Adaptive => self.recompute_link_state(true),
            RoutingProtocol::Rip => self.rip_local_update(),
        }
    }

    pub fn spawn_packet(&mut self, from: usize, to: usize) -> usize {
        self.spawn_protocol_packet(from, to, ProtocolKind::IcmpEchoRequest, None)
    }

    /// Spawn `count` one-way packets at once. Returns the first id.
    pub fn spawn_burst(&mut self, from: usize, to: usize, count: usize) -> usize {
        let first = self.next_packet_id;
        for _ in 0..count {
            self.spawn_protocol_packet(from, to, ProtocolKind::Udp, None);
        }
        first
    }

    pub fn ping(&mut self, from: usize, target_ip: &str) -> bool {
        let Some(to) = self.node_id_for_ip(target_ip) else {
            return false;
        };
        self.spawn_protocol_packet(from, to, ProtocolKind::IcmpEchoRequest, None);
        true
    }

    /// Register a traffic generator. `stop` = 0 means it never stops.
    pub fn add_flow(
        &mut self,
        src: usize,
        dst: usize,
        interval: usize,
        burst: usize,
        start: usize,
        stop: usize,
    ) -> usize {
        let id = self.next_flow_id;
        self.next_flow_id += 1;
        self.flows.push(Flow {
            id,
            src,
            dst,
            interval: interval.max(1),
            burst: burst.max(1),
            start,
            stop,
            protocol: ProtocolKind::Udp,
        });
        id
    }

    pub fn remove_flow(&mut self, id: usize) -> bool {
        let before = self.flows.len();
        self.flows.retain(|f| f.id != id);
        before != self.flows.len()
    }

    pub fn clear_flows(&mut self) {
        self.flows.clear();
    }

    pub fn is_finished(&self) -> bool {
        self.metrics.total_packets > 0
            && self.packets.values().all(|p| !p.is_live())
            && self.flows.iter().all(|f| f.exhausted(self.tick))
    }

    pub fn step(&mut self) {
        let tick = self.tick;
        self.events = std::mem::take(&mut self.pending_events);
        let spawned = self.events.iter().filter(|e| e.kind == EventKind::Spawned).count();
        self.stats = TickStats { dropped: self.pending_drops, spawned, ..TickStats::default() };
        self.pending_drops = 0;

        // Forget packets that finished before this tick.
        self.packets
            .retain(|_, p| p.is_live() || p.finished_tick.map_or(false, |t| t >= tick));
        for link in self.links.values_mut().flatten() {
            link.begin_tick();
        }
        if self.routes_dirty {
            self.refresh_routes();
        }

        // 1. Traffic generators.
        let due: Vec<(usize, usize, usize, usize, ProtocolKind)> = self
            .flows
            .iter()
            .filter(|f| f.due(tick))
            .map(|f| (f.id, f.src, f.dst, f.burst, f.protocol))
            .collect();
        for (flow, src, dst, burst, protocol) in due {
            for _ in 0..burst {
                self.spawn_protocol_packet(src, dst, protocol, Some(flow));
            }
        }
        self.events.append(&mut self.pending_events);

        // 2. Packets on the wire move one tick; arrivals free link capacity.
        for p in self.packets.values_mut() {
            if p.state != PacketState::Travelling {
                continue;
            }
            let on = p.current_link;
            if p.travel() {
                if let Some((from, to)) = on {
                    if let Some(link) = find_link(&mut self.links, from, to) {
                        link.leave();
                    }
                }
            }
        }

        // 3. Link queues drain (FIFO, limited by capacity and bandwidth).
        for link in self.links.values_mut().flatten() {
            while let Some(id) = link.dequeue() {
                match self.packets.get_mut(&id) {
                    Some(p) if p.state == PacketState::Queued => {
                        p.start_travel(link.from_node_id, link.to_node_id, link.latency, tick);
                        if let Some(n) = self.nodes.get_mut(&link.from_node_id) {
                            n.forwarded += 1;
                        }
                    }
                    _ => link.leave(), // stale id: give the slot back
                }
            }
        }

        // 4. Packets sitting at a node: deliver, or pick a link and try to enter it.
        let mut replies: Vec<(usize, usize)> = Vec::new();
        let ready: Vec<usize> = self
            .packets
            .values()
            .filter(|p| p.state == PacketState::Ready)
            .map(|p| p.id)
            .collect();
        for id in ready {
            let Some(p) = self.packets.get_mut(&id) else { continue };
            let here = p.current_node_id;

            if here == p.destination {
                p.deliver(tick);
                let latency = tick.saturating_sub(p.created_tick);
                self.metrics.delivered += 1;
                self.metrics.total_latency += latency;
                self.metrics.total_queue_delay += p.queued_ticks;
                self.stats.delivered += 1;
                self.stats.latency_sum += latency;
                if let Some(n) = self.nodes.get_mut(&here) {
                    n.received += 1;
                }
                if p.protocol == ProtocolKind::IcmpEchoRequest {
                    replies.push((here, p.source));
                }
                self.events.push(SimEvent {
                    packet: Some(id),
                    node: Some(here),
                    detail: Some(format!("{} ticks", latency)),
                    ..event(tick, EventKind::Delivered)
                });
                continue;
            }

            let next_hop = self
                .nodes
                .get(&here)
                .and_then(|n| n.routing_table.get(&p.destination))
                .map(|r| r.next_hop);
            let link = next_hop.and_then(|hop| {
                self.links
                    .get_mut(&here)?
                    .iter_mut()
                    .find(|l| l.to_node_id == hop && l.active)
            });

            let Some(link) = link else {
                p.hold_ticks += 1;
                if p.hold_ticks > MAX_HOLD_TICKS {
                    record_drop(p, DropReason::NoRoute, tick, &mut self.metrics, &mut self.nodes, &mut self.events);
                    self.stats.dropped += 1;
                }
                continue;
            };
            p.hold_ticks = 0;

            // Routers decrement TTL when forwarding; the source host does not.
            if here != p.source {
                if p.ttl <= 1 {
                    p.ttl = 0;
                    record_drop(p, DropReason::TtlExpired, tick, &mut self.metrics, &mut self.nodes, &mut self.events);
                    self.stats.dropped += 1;
                    continue;
                }
                p.ttl -= 1;
            }

            p.current_link = Some((link.from_node_id, link.to_node_id));
            match link.enter(id) {
                EnterResult::Entered => {
                    p.start_travel(link.from_node_id, link.to_node_id, link.latency, tick);
                    if let Some(n) = self.nodes.get_mut(&here) {
                        n.forwarded += 1;
                    }
                }
                EnterResult::Queued => {
                    p.state = PacketState::Queued;
                    p.queue_entry_tick = Some(tick);
                    self.events.push(SimEvent {
                        packet: Some(id),
                        node: Some(here),
                        link: p.current_link,
                        ..event(tick, EventKind::Queued)
                    });
                }
                EnterResult::Dropped => {
                    record_drop(p, DropReason::QueueFull, tick, &mut self.metrics, &mut self.nodes, &mut self.events);
                    self.stats.dropped += 1;
                }
            }
        }

        for (from, to) in replies {
            self.spawn_protocol_packet(from, to, ProtocolKind::IcmpEchoReply, None);
        }
        self.events.append(&mut self.pending_events);

        // 5. Routing protocol housekeeping.
        match self.routing_protocol {
            RoutingProtocol::Rip if tick % self.rip_update_interval == 0 => self.rip_round(),
            RoutingProtocol::Adaptive if tick % self.adaptive_interval == 0 => {
                self.recompute_link_state(true)
            }
            _ => {}
        }

        // 6. Metrics.
        for link in self.links.values_mut().flatten() {
            link.update_metrics();
            self.metrics.max_queue_size = self.metrics.max_queue_size.max(link.queue.len());
            self.stats.queued += link.queue.len();
            self.stats.in_flight += link.current_packets;
        }
        self.stats.live = self.packets.values().filter(|p| p.is_live()).count();
        self.metrics.total_ticks += 1;
        self.tick += 1;
    }

    /// Run up to `n` ticks, stopping early if the simulation finishes.
    pub fn run(&mut self, n: usize) -> usize {
        let mut done = 0;
        while done < n && !self.is_finished() {
            self.step();
            done += 1;
        }
        done
    }

    pub fn snapshot(&self) -> String {
        let nodes = self
            .nodes
            .values()
            .map(|n| NodeSnapshot {
                id: n.id,
                node_type: n.node_type,
                ip: n.ip.clone(),
                mask: n.mask.clone(),
                mac: n.mac.clone(),
                arp_cache: n.arp_cache.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
                routes: n.routing_table.values().cloned().collect(),
                forwarded: n.forwarded,
                received: n.received,
                dropped: n.dropped,
            })
            .collect();

        let links = self
            .links
            .values()
            .flatten()
            .map(|l| LinkSnapshot {
                from: l.from_node_id,
                to: l.to_node_id,
                latency: l.latency,
                bandwidth: l.bandwidth,
                capacity: l.capacity,
                current_packets: l.current_packets,
                queue_len: l.queue.len(),
                max_queue_size: l.max_queue_size,
                active: l.active,
                utilization: l.utilization(),
                queue_delay: l.queue_delay(),
                packet_loss_rate: l.packet_loss_rate(),
                load: l.load,
                forwarded: l.total_forwarded,
                dropped: l.total_dropped,
            })
            .collect();

        let queue_pos = |p: &Packet| -> Option<usize> {
            if p.state != PacketState::Queued {
                return None;
            }
            let (from, to) = p.current_link?;
            self.links
                .get(&from)?
                .iter()
                .find(|l| l.to_node_id == to)?
                .queue_position(p.id)
        };

        let packets = self
            .packets
            .values()
            .map(|p| {
                let on_link = matches!(p.state, PacketState::Travelling | PacketState::Queued)
                    || (p.state == PacketState::Dropped && p.current_link.is_some());
                let link = if on_link { p.current_link } else { None };
                PacketSnapshot {
                    id: p.id,
                    state: p.state,
                    from_node: link.map(|(f, _)| f).unwrap_or(p.current_node_id),
                    to_node: link.map(|(_, t)| t),
                    elapsed: p.elapsed(),
                    latency: p.link_latency,
                    progress: p.progress(),
                    queue_pos: queue_pos(p),
                    ttl: p.ttl,
                    source: p.source,
                    destination: p.destination,
                    src_mac: p.src_mac.clone(),
                    dst_mac: p.dst_mac.clone(),
                    src_ip: p.src_ip.clone(),
                    dst_ip: p.dst_ip.clone(),
                    protocol: p.protocol,
                    path: p.path.clone(),
                    age: p.finished_tick.unwrap_or(self.tick).saturating_sub(p.created_tick),
                    queued_ticks: p.queued_ticks,
                    drop_reason: p.drop_reason,
                    flow: p.flow,
                }
            })
            .collect();

        let flows = self
            .flows
            .iter()
            .map(|f| FlowSnapshot {
                id: f.id,
                src: f.src,
                dst: f.dst,
                interval: f.interval,
                burst: f.burst,
                start: f.start,
                stop: f.stop,
            })
            .collect();

        let snap = SimSnapshot {
            tick: self.tick,
            finished: self.is_finished(),
            routing: self.routing_protocol.name(),
            nodes,
            links,
            packets,
            events: &self.events,
            stats: &self.stats,
            metrics: &self.metrics,
            flows,
        };
        serde_json::to_string(&snap).unwrap_or_else(|_| "{}".to_string())
    }

    pub fn current_tick(&self) -> usize {
        self.tick
    }
    pub fn delivered(&self) -> usize {
        self.metrics.delivered
    }
    pub fn dropped(&self) -> usize {
        self.metrics.dropped
    }
    pub fn total_packets(&self) -> usize {
        self.metrics.total_packets
    }
    pub fn delivery_rate(&self) -> f64 {
        self.metrics.delivery_rate()
    }
    pub fn average_latency(&self) -> f64 {
        self.metrics.average_latency()
    }
    pub fn throughput(&self) -> f64 {
        self.metrics.throughput()
    }
    pub fn max_queue_size(&self) -> usize {
        self.metrics.max_queue_size
    }
}

// Native-only helpers (not exported to JS).
impl Simulation {
    pub fn metrics(&self) -> &Metrics {
        &self.metrics
    }

    pub fn nodes(&self) -> &BTreeMap<usize, Node> {
        &self.nodes
    }

    pub fn links(&self) -> &LinkMap {
        &self.links
    }

    pub fn packets(&self) -> impl Iterator<Item = &Packet> {
        self.packets.values()
    }

    fn node_id_for_ip(&self, ip: &str) -> Option<usize> {
        self.nodes.values().find(|n| n.ip == ip).map(|n| n.id)
    }

    fn spawn_protocol_packet(
        &mut self,
        from: usize,
        to: usize,
        protocol: ProtocolKind,
        flow: Option<usize>,
    ) -> usize {
        let (Some(src), Some(dst)) = (self.nodes.get(&from), self.nodes.get(&to)) else {
            return usize::MAX;
        };
        let id = self.next_packet_id;
        self.next_packet_id += 1;
        let mut packet = Packet::new(id, from, to, DEFAULT_TTL, src, dst, protocol, self.tick);
        packet.flow = flow;
        self.packets.insert(id, packet);
        self.metrics.total_packets += 1;
        self.stats.spawned += 1;
        let ev = SimEvent { packet: Some(id), node: Some(from), ..event(self.tick, EventKind::Spawned) };
        // Spawns between ticks show up with the next tick's events.
        self.pending_events.push(ev);
        id
    }

    /// Dijkstra from every node. With `adaptive`, link cost includes queue
    /// drain time and a route only changes when the new path is clearly
    /// better (hysteresis of one tick), which stops routes flapping.
    fn recompute_link_state(&mut self, adaptive: bool) {
        let cost = |l: &Link| if adaptive { l.congestion_cost() } else { l.latency };
        let ids: Vec<usize> = self.nodes.keys().copied().collect();
        let mut tables: HashMap<usize, BTreeMap<usize, Route>> = ids
            .iter()
            .map(|&id| (id, link_state_table(&self.links, id, cost)))
            .collect();

        if adaptive {
            for &id in &ids {
                let old = &self.nodes[&id].routing_table;
                let mut keep: Vec<Route> = Vec::new();
                for (dest, new_route) in &tables[&id] {
                    let Some(old_route) = old.get(dest) else { continue };
                    if old_route.next_hop == new_route.next_hop {
                        continue;
                    }
                    // Cost of sticking with the old next hop.
                    let via_old = self.links.get(&id).and_then(|v| {
                        let l = v.iter().find(|l| l.to_node_id == old_route.next_hop && l.active)?;
                        let rest = if old_route.next_hop == *dest {
                            0
                        } else {
                            tables.get(&old_route.next_hop)?.get(dest)?.cost
                        };
                        // Don't keep a next hop that would route straight back to us.
                        if old_route.next_hop != *dest
                            && tables[&old_route.next_hop][dest].next_hop == id
                        {
                            return None;
                        }
                        Some(cost(l) + rest)
                    });
                    if let Some(c) = via_old {
                        if c <= new_route.cost + 1 {
                            keep.push(Route { destination: *dest, next_hop: old_route.next_hop, cost: c });
                        }
                    }
                }
                let t = tables.get_mut(&id).unwrap();
                for r in keep {
                    t.insert(r.destination, r);
                }
            }
        }

        for id in ids {
            let table = tables.remove(&id).unwrap_or_default();
            self.install_table(id, table);
        }
    }

    /// Replace a node's table and emit an event if any next hop changed.
    fn install_table(&mut self, id: usize, table: BTreeMap<usize, Route>) {
        let tick = self.tick;
        let Some(node) = self.nodes.get_mut(&id) else { return };
        let changed = table
            .iter()
            .filter(|(d, r)| node.routing_table.get(d).map(|o| o.next_hop) != Some(r.next_hop))
            .count()
            + node.routing_table.keys().filter(|d| !table.contains_key(d)).count();
        let had_routes = !node.routing_table.is_empty();
        node.routing_table = table;
        if changed > 0 && had_routes {
            self.events.push(SimEvent {
                node: Some(id),
                detail: Some(format!("{} route{} updated", changed, if changed == 1 { "" } else { "s" })),
                ..event(tick, EventKind::RouteChange)
            });
        }
    }

    /// RIP: what a router knows without talking to anyone - its live
    /// neighbours at cost 1, and nothing that goes through a dead link.
    fn rip_local_update(&mut self) {
        let ids: Vec<usize> = self.nodes.keys().copied().collect();
        for id in ids {
            let up: Vec<usize> = self
                .links
                .get(&id)
                .map(|v| v.iter().filter(|l| l.active).map(|l| l.to_node_id).collect())
                .unwrap_or_default();
            let mut table: BTreeMap<usize, Route> = self.nodes[&id]
                .routing_table
                .iter()
                .filter(|(_, r)| up.contains(&r.next_hop))
                .map(|(d, r)| (*d, r.clone()))
                .collect();
            for n in up {
                table.insert(n, Route { destination: n, next_hop: n, cost: 1 });
            }
            self.install_table(id, table);
        }
    }

    /// One synchronous RIP exchange: every node rebuilds its table from its
    /// neighbours' previous tables (Bellman-Ford with split horizon).
    fn rip_round(&mut self) {
        let old: BTreeMap<usize, BTreeMap<usize, Route>> = self
            .nodes
            .iter()
            .map(|(id, n)| (*id, n.routing_table.clone()))
            .collect();
        let ids: Vec<usize> = self.nodes.keys().copied().collect();
        for id in ids {
            let mut table: BTreeMap<usize, Route> = BTreeMap::new();
            let neighbours: Vec<usize> = self
                .links
                .get(&id)
                .map(|v| v.iter().filter(|l| l.active).map(|l| l.to_node_id).collect())
                .unwrap_or_default();
            for &m in &neighbours {
                table.insert(m, Route { destination: m, next_hop: m, cost: 1 });
            }
            for &m in &neighbours {
                let Some(advert) = old.get(&m) else { continue };
                for (dest, r) in advert {
                    if *dest == id || r.next_hop == id {
                        continue; // split horizon
                    }
                    let cost = r.cost + 1;
                    if cost >= RIP_INFINITY {
                        continue;
                    }
                    let better = match table.get(dest) {
                        None => true,
                        Some(cur) if cost < cur.cost => true,
                        Some(cur) if cost == cur.cost => {
                            // Tie: prefer the next hop we already used.
                            old[&id].get(dest).map(|o| o.next_hop) == Some(m) && cur.next_hop != m
                        }
                        _ => false,
                    };
                    if better {
                        table.insert(*dest, Route { destination: *dest, next_hop: m, cost });
                    }
                }
            }
            self.install_table(id, table);
        }
    }
}

impl Default for Simulation {
    fn default() -> Self {
        Simulation::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn line(n: usize, lat: usize, bw: usize, cap: usize, q: usize) -> Simulation {
        let mut sim = Simulation::new();
        for i in 0..n {
            let kind = if i == 0 { "client" } else if i == n - 1 { "server" } else { "router" };
            sim.add_node(i, kind);
        }
        for i in 0..n - 1 {
            sim.add_duplex_link(i, i + 1, lat, bw, cap, q);
        }
        sim
    }

    #[test]
    fn multi_hop_packet_is_delivered_with_exact_latency() {
        let mut sim = line(4, 2, 1, 1, 4);
        sim.spawn_burst(0, 3, 1);
        sim.run(100);
        assert_eq!(sim.delivered(), 1);
        assert_eq!(sim.dropped(), 0);
        // three links of latency 2
        assert_eq!(sim.metrics().total_latency, 6);
    }

    #[test]
    fn default_topology_ping_round_trips() {
        let mut sim = Simulation::new();
        sim.load_default_topology();
        sim.run(100);
        // echo request + echo reply
        assert_eq!(sim.total_packets(), 2);
        assert_eq!(sim.delivered(), 2);
        assert!(sim.is_finished());
    }

    #[test]
    fn shortest_latency_path_is_used() {
        let mut sim = Simulation::new();
        sim.load_default_topology();
        sim.set_link_active(0, 3, true);
        sim.set_link_active(3, 0, true);
        sim.refresh_routes();
        assert_eq!(sim.nodes()[&0].routing_table[&2].next_hop, 3);
        assert_eq!(sim.nodes()[&0].routing_table[&2].cost, 3);
    }

    #[test]
    fn queue_is_fifo_and_tail_drops_when_full() {
        // capacity 1, bandwidth 1, queue 2: of 5 packets sent at once,
        // 1 enters, 2 queue, 2 are dropped.
        let mut sim = line(2, 1, 1, 1, 2);
        sim.spawn_burst(0, 1, 5);
        sim.step();
        assert_eq!(sim.dropped(), 2);
        let snap: Value = serde_json::from_str(&sim.snapshot()).unwrap();
        let queued: Vec<u64> = snap["packets"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|p| p["state"] == "queued")
            .map(|p| p["id"].as_u64().unwrap())
            .collect();
        assert_eq!(queued, vec![1, 2]);
        sim.run(20);
        assert_eq!(sim.delivered(), 3);
        // delivered in order: 0 at tick 1, 1 at tick 2, 2 at tick 3
        assert_eq!(sim.metrics().total_latency, 1 + 2 + 3);
    }

    #[test]
    fn bandwidth_limits_entries_per_tick() {
        // plenty of capacity, bandwidth 2 -> 6 packets take 3 ticks to leave
        let mut sim = line(2, 5, 2, 10, 10);
        sim.spawn_burst(0, 1, 6);
        sim.step();
        assert_eq!(sim.links()[&0][0].current_packets, 2);
        sim.step();
        assert_eq!(sim.links()[&0][0].current_packets, 4);
    }

    #[test]
    fn link_failure_drops_in_flight_and_reroutes_the_rest() {
        let mut sim = Simulation::new();
        sim.load_default_topology();
        sim.set_link_active(0, 3, true);
        sim.set_link_active(3, 0, true);
        sim.add_flow(0, 2, 1, 1, 0, 30);
        for _ in 0..10 {
            sim.step();
        }
        sim.set_link_active(3, 2, false);
        sim.run(200);
        assert!(sim.is_finished());
        let m = sim.metrics();
        assert!(m.dropped >= 1, "in-flight packet on 3->2 should be lost");
        assert_eq!(m.delivered + m.dropped, m.total_packets);
        // after the failure the client routes via router 1
        assert_eq!(sim.nodes()[&0].routing_table[&2].next_hop, 1);
    }

    #[test]
    fn unreachable_destination_is_dropped_after_hold() {
        let mut sim = line(3, 1, 1, 1, 4);
        sim.set_link_active(1, 2, false);
        sim.spawn_burst(0, 2, 1);
        sim.run(100);
        assert_eq!(sim.dropped(), 1);
        assert!(sim.is_finished());
    }

    #[test]
    fn rip_converges_to_hop_count() {
        let mut sim = line(6, 1, 1, 1, 4);
        sim.set_routing_protocol("rip");
        assert!(sim.nodes()[&0].routing_table.get(&5).is_none());
        for _ in 0..30 {
            sim.step();
        }
        let r = &sim.nodes()[&0].routing_table[&5];
        assert_eq!((r.next_hop, r.cost), (1, 5));
        sim.spawn_burst(0, 5, 3);
        sim.run(100);
        assert_eq!(sim.delivered(), 3);
    }

    #[test]
    fn adaptive_routing_spreads_load_over_both_paths() {
        let mut sim = Simulation::new();
        sim.load_default_topology();
        sim.set_link_active(0, 3, true);
        sim.set_link_active(3, 0, true);
        sim.set_routing_protocol("adaptive");
        sim.add_flow(0, 2, 1, 3, 0, 40);
        sim.run(300);
        let via1 = sim.links()[&0].iter().find(|l| l.to_node_id == 1).unwrap().total_forwarded;
        let via3 = sim.links()[&0].iter().find(|l| l.to_node_id == 3).unwrap().total_forwarded;
        assert!(via1 > 0 && via3 > 0, "via1={} via3={}", via1, via3);
    }

    #[test]
    fn packet_count_is_conserved() {
        let mut sim = Simulation::new();
        for i in 0..5 {
            sim.add_node(i, if i < 2 { "client" } else if i == 4 { "server" } else { "router" });
        }
        sim.add_duplex_link(0, 2, 1, 2, 2, 3);
        sim.add_duplex_link(1, 2, 1, 2, 2, 3);
        sim.add_duplex_link(2, 3, 2, 1, 1, 3);
        sim.add_duplex_link(3, 4, 1, 1, 1, 3);
        sim.add_flow(0, 4, 1, 2, 0, 50);
        sim.add_flow(1, 4, 2, 2, 0, 50);
        sim.run(500);
        let m = sim.metrics();
        assert!(sim.is_finished());
        assert_eq!(m.delivered + m.dropped, m.total_packets);
        assert!(m.total_congestion_drops > 0);
        for link in sim.links().values().flatten() {
            assert_eq!(link.current_packets, 0);
            assert!(link.queue.is_empty());
        }
    }

    #[test]
    fn nodes_get_unique_addresses() {
        let mut sim = Simulation::new();
        for i in 0..40 {
            sim.add_node(i, ["client", "router", "server"][i % 3]);
        }
        let mut ips: Vec<&String> = sim.nodes().values().map(|n| &n.ip).collect();
        ips.sort();
        ips.dedup();
        assert_eq!(ips.len(), 40);
    }
}
