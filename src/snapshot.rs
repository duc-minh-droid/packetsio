use serde::Serialize;
use crate::node::NodeType;
use crate::packet::PacketState;

#[derive(Serialize)]
pub struct NodeSnapshot {
    pub id: usize,
    pub node_type: NodeType,
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
}

#[derive(Serialize)]
pub struct SimSnapshot {
    pub tick: usize,
    pub finished: bool,
    pub nodes: Vec<NodeSnapshot>,
    pub links: Vec<LinkSnapshot>,
    pub packets: Vec<PacketSnapshot>,
}
