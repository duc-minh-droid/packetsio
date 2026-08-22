use serde::Serialize;
use crate::link::Link;
use crate::metrics::Metrics;
use crate::node::Node;

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ProtocolKind {
    ArpRequest,
    ArpReply,
    IcmpEchoRequest,
    IcmpEchoReply,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PacketState {
    Ready,
    Travelling,
    Queued,
    Delivered,
    Dropped,
}

#[derive(Clone, Debug)]
pub struct Packet {
    pub id: usize,
    pub state: PacketState,
    pub current_node_id: usize,
    pub destination: usize,
    pub remaining: usize,
    pub link_latency: usize,
    pub current_link: Option<(usize, usize)>,
    pub arrived_link: Option<(usize, usize)>,
    pub ttl: usize,
    pub start_tick: usize,
    pub has_started: bool,
    pub src_mac: String,
    pub dst_mac: String,
    pub src_ip: String,
    pub dst_ip: String,
    pub protocol: ProtocolKind,
    pub requires_arp: bool,
    pub awaiting_arp_for: Option<usize>,
}

impl Packet {
    pub fn new(
        id: usize,
        from: usize,
        destination: usize,
        ttl: usize,
        src: &Node,
        dst: &Node,
        protocol: ProtocolKind,
    ) -> Self {
        Self {
            id,
            state: PacketState::Ready,
            current_node_id: from,
            destination,
            remaining: 0,
            link_latency: 1,
            current_link: None,
            arrived_link: None,
            ttl,
            start_tick: 0,
            has_started: false,
            src_mac: src.mac.clone(),
            dst_mac: "FF:FF:FF:FF:FF:FF".to_string(),
            src_ip: src.ip.clone(),
            dst_ip: dst.ip.clone(),
            protocol,
            requires_arp: false,
            awaiting_arp_for: None,
        }
    }

    pub fn start_travel(&mut self, link: &Link) {
        self.current_link = Some((link.from_node_id, link.to_node_id));
        self.remaining = link.latency.max(1);
        self.link_latency = link.latency.max(1);
    }

    pub fn end_travel(&mut self) {
        if let Some((_, to)) = self.current_link {
            self.current_node_id = to;
            self.arrived_link = self.current_link;
            self.state = if self.current_node_id == self.destination {
                PacketState::Delivered
            } else {
                PacketState::Ready
            };
        }
    }

    pub fn travel(&mut self, tick: usize, metrics: &mut Metrics) {
        self.remaining = self.remaining.saturating_sub(1);
        if self.remaining > 0 {
            self.state = PacketState::Travelling;
        } else {
            self.end_travel();
            if matches!(self.state, PacketState::Delivered) {
                metrics.delivered += 1;
                metrics.total_latency += (tick + 1).saturating_sub(self.start_tick);
            }
        }
    }

    pub fn advance_on_link(&mut self, link: &Link, tick: usize, metrics: &mut Metrics) {
        self.start_travel(link);
        self.travel(tick, metrics);
    }

    pub fn progress(&self) -> f64 {
        match self.state {
            PacketState::Travelling => {
                if self.link_latency == 0 {
                    1.0
                } else {
                    let elapsed = self.link_latency.saturating_sub(self.remaining);
                    (elapsed as f64 / self.link_latency as f64).clamp(0.0, 1.0)
                }
            }
            PacketState::Delivered => 1.0,
            _ => 0.0,
        }
    }
}
