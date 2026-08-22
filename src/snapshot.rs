use serde::Serialize;
use crate::node::NodeType;
use crate::packet::{PacketState, ProtocolKind};

#[derive(Serialize)]
pub struct NodeSnapshot {
    pub id: usize,
    pub node_type: NodeType,
    pub ip: String,
    pub mask: String,
    pub mac: String,
    pub arp_cache: Vec<(String, String)>,
}

#[derive(Serialize)]
pub struct LinkSnapshot {
    pub from: usize,
    pub to: usize,
    pub latency: usize,
    pub capacity: usize,
    pub current_packets: usize,
    pub queue_len: usize,
    pub active: bool,
}

#[derive(Serialize)]
pub struct PacketSnapshot {
    pub id: usize,
    pub state: PacketState,
    pub from_node: usize,
    pub to_node: Option<usize>,
    pub progress: f64,
    pub ttl: usize,
    pub src_mac: String,
    pub dst_mac: String,
    pub src_ip: String,
    pub dst_ip: String,
    pub protocol: ProtocolKind,
}

#[derive(Serialize)]
pub struct SimSnapshot {
    pub tick: usize,
    pub finished: bool,
    pub nodes: Vec<NodeSnapshot>,
    pub links: Vec<LinkSnapshot>,
    pub packets: Vec<PacketSnapshot>,
}
