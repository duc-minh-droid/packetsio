use serde::Serialize;

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
}

impl Node {
    pub fn new(id: usize, node_type: NodeType) -> Self {
        Self { id, node_type }
    }
}
