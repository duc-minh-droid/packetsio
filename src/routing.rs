use std::cmp::Reverse;
use std::collections::{BTreeMap, BinaryHeap};
use crate::link::Link;
use crate::node::Route;

pub type LinkMap = BTreeMap<usize, Vec<Link>>;

/// Dijkstra over active links. `cost` maps a link to its weight.
/// Returns (distance, first hop) for every reachable node.
pub fn shortest_paths<F>(links: &LinkMap, from: usize, cost: F) -> BTreeMap<usize, (usize, usize)>
where
    F: Fn(&Link) -> usize,
{
    let mut best: BTreeMap<usize, (usize, usize)> = BTreeMap::new();
    let mut heap: BinaryHeap<Reverse<(usize, usize, usize)>> = BinaryHeap::new();
    // (distance, node, first hop)
    heap.push(Reverse((0, from, from)));

    while let Some(Reverse((dist, node, first))) = heap.pop() {
        if best.contains_key(&node) {
            continue;
        }
        best.insert(node, (dist, first));
        if let Some(neighbours) = links.get(&node) {
            for link in neighbours.iter().filter(|l| l.active) {
                if best.contains_key(&link.to_node_id) {
                    continue;
                }
                let hop = if node == from { link.to_node_id } else { first };
                heap.push(Reverse((dist.saturating_add(cost(link)), link.to_node_id, hop)));
            }
        }
    }
    best.remove(&from);
    best
}

/// Link-state routing table for one node (what OSPF converges to).
pub fn link_state_table<F>(links: &LinkMap, from: usize, cost: F) -> BTreeMap<usize, Route>
where
    F: Fn(&Link) -> usize,
{
    shortest_paths(links, from, cost)
        .into_iter()
        .map(|(dest, (dist, hop))| (dest, Route { destination: dest, next_hop: hop, cost: dist }))
        .collect()
}

/// Full node path from `from` to `to` by latency, if one exists.
pub fn quickest_route(links: &LinkMap, from: usize, to: usize) -> Option<Vec<usize>> {
    if from == to {
        return Some(vec![from]);
    }
    let mut path = vec![from];
    let mut current = from;
    // Walk first hops; each step re-runs Dijkstra from the current node, which
    // is fine for the small topologies this crate simulates.
    while current != to {
        let (_, hop) = *shortest_paths(links, current, |l| l.latency).get(&to)?;
        if path.contains(&hop) || path.len() > links.len() + 1 {
            return None;
        }
        path.push(hop);
        current = hop;
    }
    Some(path)
}

pub fn next_hop_link<'a>(links: &'a mut LinkMap, current: usize, destination: usize) -> Option<&'a mut Link> {
    let path = quickest_route(links, current, destination)?;
    let next_node = *path.get(1)?;
    links
        .get_mut(&current)?
        .iter_mut()
        .find(|link| link.to_node_id == next_node && link.active)
}
