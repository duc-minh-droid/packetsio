use serde::Serialize;
use crate::metrics::{Metrics, TickStats};
use crate::node::{NodeType, Route};
use crate::packet::{DropReason, PacketState, ProtocolKind};

#[derive(Serialize)]
pub struct NodeSnapshot {
    pub id: usize,
    pub node_type: NodeType,
    pub ip: String,
    pub mask: String,
    pub mac: String,
    pub arp_cache: Vec<(String, String)>,
    pub routes: Vec<Route>,
    pub forwarded: usize,
    pub received: usize,
    pub dropped: usize,
}

#[derive(Serialize)]
pub struct LinkSnapshot {
    pub from: usize,
    pub to: usize,
    pub latency: usize,
    pub bandwidth: usize,
    pub capacity: usize,
    pub current_packets: usize,
    pub queue_len: usize,
    pub max_queue_size: usize,
    pub active: bool,
    pub utilization: f64,
    pub queue_delay: f64,
    pub packet_loss_rate: f64,
    pub load: f64,
    pub forwarded: usize,
    pub dropped: usize,
}

#[derive(Serialize)]
pub struct PacketSnapshot {
    pub id: usize,
    pub state: PacketState,
    /// Node the packet is at, or the tail of the link it is on / queued for
    pub from_node: usize,
    /// Head of the link it is on / queued for
    pub to_node: Option<usize>,
    pub elapsed: usize,
    pub latency: usize,
    pub progress: f64,
    pub queue_pos: Option<usize>,
    pub ttl: usize,
    pub source: usize,
    pub destination: usize,
    pub src_mac: String,
    pub dst_mac: String,
    pub src_ip: String,
    pub dst_ip: String,
    pub protocol: ProtocolKind,
    pub path: Vec<usize>,
    pub age: usize,
    pub queued_ticks: usize,
    pub drop_reason: Option<DropReason>,
    pub flow: Option<usize>,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    Spawned,
    Delivered,
    Dropped,
    Queued,
    RouteChange,
    LinkState,
}

#[derive(Serialize, Clone, Debug)]
pub struct SimEvent {
    pub tick: usize,
    pub kind: EventKind,
    pub packet: Option<usize>,
    pub node: Option<usize>,
    pub link: Option<(usize, usize)>,
    pub reason: Option<DropReason>,
    pub detail: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct FlowSnapshot {
    pub id: usize,
    pub src: usize,
    pub dst: usize,
    pub interval: usize,
    pub burst: usize,
    pub start: usize,
    pub stop: usize,
}

#[derive(Serialize)]
pub struct SimSnapshot<'a> {
    pub tick: usize,
    pub finished: bool,
    pub routing: &'a str,
    pub nodes: Vec<NodeSnapshot>,
    pub links: Vec<LinkSnapshot>,
    pub packets: Vec<PacketSnapshot>,
    pub events: &'a [SimEvent],
    pub stats: &'a TickStats,
    pub metrics: &'a Metrics,
    pub flows: Vec<FlowSnapshot>,
}
