use std::collections::HashMap;
use wasm_bindgen::prelude::*;

use crate::link::{EnterResult, Link};
use crate::metrics::Metrics;
use crate::node::{Node, NodeType};
use crate::packet::{Packet, PacketState};
use crate::routing::next_hop_link;
use crate::snapshot::{LinkSnapshot, NodeSnapshot, PacketSnapshot, SimSnapshot};

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
    #[wasm_bindgen(constructor)]
    pub fn new() -> Simulation {
        #[cfg(target_arch = "wasm32")]
        console_error_panic_hook::set_once();

        Simulation {
            nodes: HashMap::new(),
            links: HashMap::new(),
            packets: Vec::new(),
            metrics: Metrics::new(),
            tick: 0,
            next_packet_id: 0,
        }
    }

    pub fn load_default_topology(&mut self) {
        self.nodes.clear();
        self.links.clear();
        self.packets.clear();
        self.metrics = Metrics::new();
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

    pub fn add_node(&mut self, id: usize, kind: &str) {
        self.nodes.insert(id, Node::new(id, NodeType::from_str(kind)));
        self.links.entry(id).or_default();
    }

    pub fn add_link(
        &mut self,
        from: usize,
        to: usize,
        latency: usize,
        capacity: usize,
        max_queue_size: usize,
    ) {
        let neighbours = self.links.entry(from).or_default();
        if let Some(existing) = neighbours.iter_mut().find(|l| l.to_node_id == to) {
            existing.latency = latency.max(1);
            existing.capacity = capacity.max(1);
            existing.max_queue_size = max_queue_size;
        } else {
            neighbours.push(Link::new(from, to, latency, capacity, max_queue_size));
        }
    }

    pub fn set_link_active(&mut self, from: usize, to: usize, active: bool) -> bool {
        if let Some(link) = self
            .links
            .get_mut(&from)
            .and_then(|links| links.iter_mut().find(|l| l.to_node_id == to))
        {
            link.active = active;
            true
        } else {
            false
        }
    }

    pub fn spawn_packet(&mut self, from: usize, to: usize) -> usize {
        let id = self.next_packet_id;
        self.next_packet_id += 1;
        self.packets.push(Packet::new(id, from, to, 32));
        self.metrics.total_packets += 1;
        id
    }

    pub fn is_finished(&self) -> bool {
        !self.packets.is_empty()
            && self
                .packets
                .iter()
                .all(|p| matches!(p.state, PacketState::Delivered | PacketState::Dropped))
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
                if let Some((from, to)) = p.current_link.take() {
                    p.arrived_link = Some((from, to));
                }
                self.metrics.dropped += 1;
                continue;
            }
            p.ttl = p.ttl.saturating_sub(1);
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
                    if let Some((from, to)) = p.current_link {
                        if let Some(link) = self
                            .links
                            .get_mut(&from)
                            .and_then(|links| links.iter_mut().find(|l| l.to_node_id == to))
                        {
                            if link.dequeue() == Some(p.id) {
                                p.advance_on_link(link, tick, &mut self.metrics);
                            }
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
                if let Some(link) = self
                    .links
                    .get_mut(&from)
                    .and_then(|links| links.iter_mut().find(|l| l.to_node_id == to))
                {
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

    pub fn snapshot(&self) -> String {
        let nodes = self
            .nodes
            .values()
            .map(|n| NodeSnapshot {
                id: n.id,
                node_type: n.node_type,
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
                capacity: l.capacity,
                current_packets: l.current_packets,
                queue_len: l.queue.len(),
                active: l.active,
            })
            .collect();

        let packets = self
            .packets
            .iter()
            .map(|p| PacketSnapshot {
                id: p.id,
                state: p.state,
                from_node: p.current_link.map(|(f, _)| f).unwrap_or(p.current_node_id),
                to_node: p.current_link.map(|(_, t)| t),
                progress: p.progress(),
                ttl: p.ttl,
            })
            .collect();

        let snap = SimSnapshot {
            tick: self.tick,
            finished: self.is_finished(),
            nodes,
            links,
            packets,
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

impl Default for Simulation {
    fn default() -> Self {
        Simulation::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_topology_step() {
        let mut sim = Simulation::new();
        sim.load_default_topology();
        println!("Before step: tick={}, packets={}", sim.tick, sim.packets.len());
        let snap_before = sim.snapshot();
        println!("Snapshot before: {}", snap_before);
        sim.step();
        println!("After step: tick={}, packets={}", sim.tick, sim.packets.len());
        let snap_after = sim.snapshot();
        println!("Snapshot after: {}", snap_after);
    }
}
