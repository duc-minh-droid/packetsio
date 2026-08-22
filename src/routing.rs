use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};
use crate::link::Link;

pub fn quickest_route(
    links: &HashMap<usize, Vec<Link>>,
    from: usize,
    to: usize,
) -> Option<Vec<usize>> {
    if from == to {
        return Some(vec![from]);
    }

    let mut distance: HashMap<usize, usize> = HashMap::new();
    let mut previous: HashMap<usize, usize> = HashMap::new();
    let mut heap: BinaryHeap<Reverse<(usize, usize)>> = BinaryHeap::new();

    for &k in links.keys() {
        distance.insert(k, usize::MAX);
    }
    distance.insert(from, 0);
    heap.push(Reverse((0, from)));

    while let Some(Reverse((current_distance, current))) = heap.pop() {
        if current == to {
            break;
        }
        if current_distance > *distance.get(&current).unwrap_or(&usize::MAX) {
            continue;
        }
        if let Some(neighbours) = links.get(&current) {
            for link in neighbours {
                if !link.active {
                    continue;
                }
                let neighbor_node_id = link.to_node_id;
                let new_distance = current_distance.saturating_add(link.latency);
                if new_distance < *distance.get(&neighbor_node_id).unwrap_or(&usize::MAX) {
                    distance.insert(neighbor_node_id, new_distance);
                    previous.insert(neighbor_node_id, current);
                    heap.push(Reverse((new_distance, neighbor_node_id)));
                }
            }
        }
    }

    if *distance.get(&to).unwrap_or(&usize::MAX) == usize::MAX {
        return None;
    }

    let mut path: Vec<usize> = Vec::new();
    let mut current = to;
    let mut visited_count = 0;
    let max_hops = links.len().max(32);

    while current != from {
        path.push(current);
        visited_count += 1;
        if visited_count > max_hops {
            return None;
        }
        current = *previous.get(&current)?;
    }
    path.push(current);
    path.reverse();
    Some(path)
}

pub fn next_hop_link<'a>(
    links: &'a mut HashMap<usize, Vec<Link>>,
    current: usize,
    destination: usize,
) -> Option<&'a mut Link> {
    let path = quickest_route(links, current, destination)?;
    if path.len() < 2 {
        return None;
    }
    let next_node = *path.get(1)?;
    links
        .get_mut(&current)?
        .iter_mut()
        .find(|link| link.to_node_id == next_node && link.active)
}
