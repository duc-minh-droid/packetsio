use std::collections::HashMap;
use wasm_bindgen::prelude::*;

use crate::link::{EnterResult, Link};
use crate::metrics::Metrics;
use crate::node::{Node, NodeType};
use crate::packet::{Packet, PacketState, ProtocolKind};
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

        self.ping(0, "192.168.1.5");
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
        self.spawn_protocol_packet(from, to, ProtocolKind::IcmpEchoRequest)
    }

    pub fn ping(&mut self, from: usize, target_ip: &str) -> bool {
        let Some(to) = self.node_id_for_ip(target_ip) else {
            return false;
        };
        self.spawn_protocol_packet(from, to, ProtocolKind::IcmpEchoRequest);
        true
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
        let mut reply_queue: Vec<(usize, usize)> = Vec::new();

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
                    if p.current_node_id == p.destination {
                        p.state = PacketState::Delivered;
                        self.metrics.delivered += 1;
                        self.metrics.total_latency += (tick + 1).saturating_sub(p.start_tick);
                        if matches!(p.protocol, ProtocolKind::IcmpEchoRequest) {
                            reply_queue.push((p.destination, p.id));
                        }
                        continue;
                    }

                    match next_hop_link(&mut self.links, p.current_node_id, p.destination) {
                        None => {
                            p.state = PacketState::Dropped;
                            self.metrics.dropped += 1;
                        }
                        Some(link) => {
                            let from_ip = self
                                .nodes
                                .get(&p.current_node_id)
                                .map(|n| n.ip.clone())
                                .unwrap_or_default();
                            let to_mac = self
                                .nodes
                                .get(&link.to_node_id)
                                .map(|n| n.mac.clone())
                                .unwrap_or_else(|| "FF:FF:FF:FF:FF:FF".to_string());

                            if let Some(node) = self.nodes.get_mut(&p.current_node_id) {
                                if !node.arp_cache.contains_key(&from_ip) {
                                    node.arp_cache.insert(from_ip.clone(), p.src_mac.clone());
                                }
                                if !node.arp_cache.contains_key(&p.dst_ip) {
                                    p.requires_arp = true;
                                    p.awaiting_arp_for = Some(link.to_node_id);
                                    p.protocol = ProtocolKind::ArpRequest;
                                    p.dst_mac = "FF:FF:FF:FF:FF:FF".to_string();
                                    node.arp_cache.insert(p.dst_ip.clone(), to_mac.clone());
                                } else {
                                    p.requires_arp = false;
                                    p.awaiting_arp_for = None;
                                    p.protocol = if matches!(p.protocol, ProtocolKind::IcmpEchoReply) {
                                        ProtocolKind::IcmpEchoReply
                                    } else {
                                        ProtocolKind::IcmpEchoRequest
                                    };
                                    p.dst_mac = to_mac;
                                }
                            }

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
                    if matches!(p.state, PacketState::Delivered)
                        && matches!(p.protocol, ProtocolKind::IcmpEchoRequest)
                    {
                        reply_queue.push((p.destination, p.id));
                    }
                    if matches!(p.state, PacketState::Ready)
                        && p.requires_arp
                        && p.awaiting_arp_for.is_some()
                    {
                        p.protocol = ProtocolKind::ArpReply;
                        p.requires_arp = false;
                        p.awaiting_arp_for = None;
                    }
                }
            }
        }

        for (src_node, request_packet_id) in reply_queue {
            if let Some(original) = self.packets.iter().find(|p| p.id == request_packet_id) {
                if let Some(dst_node) = self.node_id_for_ip(&original.src_ip) {
                    self.spawn_protocol_packet(src_node, dst_node, ProtocolKind::IcmpEchoReply);
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
                ip: n.ip.clone(),
                mask: n.mask.clone(),
                mac: n.mac.clone(),
                arp_cache: n
                    .arp_cache
                    .iter()
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect(),
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
                src_mac: p.src_mac.clone(),
                dst_mac: p.dst_mac.clone(),
                src_ip: p.src_ip.clone(),
                dst_ip: p.dst_ip.clone(),
                protocol: p.protocol,
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

    fn node_id_for_ip(&self, ip: &str) -> Option<usize> {
        self.nodes
            .iter()
            .find(|(_, node)| node.ip == ip)
            .map(|(id, _)| *id)
    }

    fn spawn_protocol_packet(
        &mut self,
        from: usize,
        to: usize,
        protocol: ProtocolKind,
    ) -> usize {
        let Some(src) = self.nodes.get(&from).cloned() else {
            return 0;
        };
        let Some(dst) = self.nodes.get(&to).cloned() else {
            return 0;
        };

        let id = self.next_packet_id;
        self.next_packet_id += 1;
        self.packets
            .push(Packet::new(id, from, to, 32, &src, &dst, protocol));
        self.metrics.total_packets += 1;
        id
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
