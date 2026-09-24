use serde::Serialize;
use std::collections::{BTreeMap, HashMap};

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum NodeType {
    Client,
    Router,
    Server,
}

impl NodeType {
    pub fn from_str(s: &str) -> NodeType {
        match s.to_lowercase().as_str() {
            "client" | "host" => NodeType::Client,
            "server" => NodeType::Server,
            _ => NodeType::Router,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Node {
    pub id: usize,
    pub node_type: NodeType,
    pub ip: String,
    pub mask: String,
    pub mac: String,
    pub arp_cache: HashMap<String, String>,
    /// destination node id -> route. BTreeMap keeps iteration deterministic.
    pub routing_table: BTreeMap<usize, Route>,
    pub forwarded: usize,
    pub dropped: usize,
    pub received: usize,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct Route {
    pub destination: usize, // node ID
    pub next_hop: usize,    // immediate neighbor node ID
    pub cost: usize,        // latency sum (link-state) or hop count (RIP)
}

impl Node {
    pub fn new(id: usize, node_type: NodeType) -> Self {
        let (ip, mask) = default_interface(id, node_type);
        Self {
            id,
            node_type,
            ip,
            mask,
            mac: default_mac(id),
            arp_cache: HashMap::new(),
            routing_table: BTreeMap::new(),
            forwarded: 0,
            dropped: 0,
            received: 0,
        }
    }
}

fn default_mac(id: usize) -> String {
    format!("AA:BB:CC:{:02X}:{:02X}:{:02X}", 0, (id / 256) & 0xff, id & 0xff)
}

/// Each node gets a unique address: hosts in 10.0.x, routers in 10.255.x,
/// servers in 10.1.x. (The old scheme gave client 1 and server 8 the same IP
/// in some topologies, which broke `ping` and echo replies.)
fn default_interface(id: usize, node_type: NodeType) -> (String, String) {
    let subnet = match node_type {
        NodeType::Client => 0,
        NodeType::Server => 1,
        NodeType::Router => 255,
    };
    (
        format!("10.{}.{}.{}", subnet, (id / 250) & 0xff, (id % 250) + 1),
        "255.255.255.0".to_string(),
    )
}
