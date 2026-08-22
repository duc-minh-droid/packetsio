use serde::Serialize;
use std::collections::HashMap;

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
            "client" => NodeType::Client,
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
        }
    }
}

fn default_mac(id: usize) -> String {
    format!("AA:BB:CC:{:02X}:{:02X}:{:02X}", 0, (id / 256) & 0xff, id & 0xff)
}

fn default_interface(id: usize, node_type: NodeType) -> (String, String) {
    let host_octet = match node_type {
        NodeType::Client => 10 + id,
        NodeType::Router => id.max(1),
        NodeType::Server => 3 + id,
    };
    (
        format!("192.168.1.{}", host_octet.min(254)),
        "255.255.255.0".to_string(),
    )
}
