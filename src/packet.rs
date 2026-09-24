use serde::Serialize;
use crate::node::Node;

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ProtocolKind {
    ArpRequest,
    ArpReply,
    IcmpEchoRequest,
    IcmpEchoReply,
    OspfLsa,
    /// Plain one-way data (what traffic flows generate)
    Udp,
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

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DropReason {
    /// Tail drop: the outgoing link's queue was full
    QueueFull,
    /// Hop limit reached (usually a routing loop)
    TtlExpired,
    /// No route to the destination for too long
    NoRoute,
    /// The link the packet was on (or queued for) went down
    LinkDown,
}

/// How many ticks a packet may sit at a node without a route before it is dropped.
pub const MAX_HOLD_TICKS: usize = 12;
pub const DEFAULT_TTL: usize = 32;

#[derive(Clone, Debug)]
pub struct Packet {
    pub id: usize,
    pub state: PacketState,
    pub source: usize,
    pub current_node_id: usize,
    pub destination: usize,
    pub remaining: usize,
    pub link_latency: usize,
    /// The link the packet is travelling on or queued for
    pub current_link: Option<(usize, usize)>,
    pub ttl: usize,
    pub created_tick: usize,
    pub finished_tick: Option<usize>,
    pub src_mac: String,
    pub dst_mac: String,
    pub src_ip: String,
    pub dst_ip: String,
    pub protocol: ProtocolKind,
    pub queue_entry_tick: Option<usize>,
    pub queued_ticks: usize,
    pub hold_ticks: usize,
    /// Every node the packet has visited, starting with its source
    pub path: Vec<usize>,
    pub drop_reason: Option<DropReason>,
    pub flow: Option<usize>,
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
        tick: usize,
    ) -> Self {
        Self {
            id,
            state: PacketState::Ready,
            source: from,
            current_node_id: from,
            destination,
            remaining: 0,
            link_latency: 1,
            current_link: None,
            ttl,
            created_tick: tick,
            finished_tick: None,
            src_mac: src.mac.clone(),
            dst_mac: dst.mac.clone(),
            src_ip: src.ip.clone(),
            dst_ip: dst.ip.clone(),
            protocol,
            queue_entry_tick: None,
            queued_ticks: 0,
            hold_ticks: 0,
            path: vec![from],
            drop_reason: None,
            flow: None,
        }
    }

    pub fn is_live(&self) -> bool {
        !matches!(self.state, PacketState::Delivered | PacketState::Dropped)
    }

    /// Put the packet on the wire.
    pub fn start_travel(&mut self, from: usize, to: usize, latency: usize, tick: usize) {
        if let Some(entry) = self.queue_entry_tick.take() {
            self.queued_ticks += tick.saturating_sub(entry);
        }
        self.current_link = Some((from, to));
        self.link_latency = latency.max(1);
        self.remaining = self.link_latency;
        self.state = PacketState::Travelling;
    }

    /// Advance one tick along the wire. Returns true when the packet arrives.
    pub fn travel(&mut self) -> bool {
        self.remaining = self.remaining.saturating_sub(1);
        if self.remaining > 0 {
            return false;
        }
        if let Some((_, to)) = self.current_link.take() {
            self.current_node_id = to;
            self.path.push(to);
        }
        self.state = PacketState::Ready;
        true
    }

    pub fn deliver(&mut self, tick: usize) {
        self.state = PacketState::Delivered;
        self.finished_tick = Some(tick);
    }

    pub fn drop_with(&mut self, reason: DropReason, tick: usize) {
        self.state = PacketState::Dropped;
        self.drop_reason = Some(reason);
        self.finished_tick = Some(tick);
        self.queue_entry_tick = None;
    }

    /// Ticks already spent on the current link (0 right after entering it).
    pub fn elapsed(&self) -> usize {
        match self.state {
            PacketState::Travelling => self.link_latency.saturating_sub(self.remaining),
            _ => 0,
        }
    }

    pub fn progress(&self) -> f64 {
        match self.state {
            PacketState::Travelling => {
                (self.elapsed() as f64 / self.link_latency.max(1) as f64).clamp(0.0, 1.0)
            }
            PacketState::Delivered => 1.0,
            _ => 0.0,
        }
    }
}
