use std::collections::VecDeque;

pub enum EnterResult {
    Entered,
    Queued,
    Dropped,
}

#[derive(Clone, Debug)]
pub struct Link {
    pub from_node_id: usize,
    pub to_node_id: usize,
    pub latency: usize,
    pub capacity: usize,
    pub current_packets: usize,
    pub queue: VecDeque<usize>,
    pub active: bool,
    pub max_queue_size: usize,
}

impl Link {
    pub fn new(
        from_node_id: usize,
        to_node_id: usize,
        latency: usize,
        capacity: usize,
        max_queue_size: usize,
    ) -> Self {
        Self {
            from_node_id,
            to_node_id,
            latency: latency.max(1),
            capacity: capacity.max(1),
            current_packets: 0,
            queue: VecDeque::new(),
            active: true,
            max_queue_size,
        }
    }

    pub fn available(&self) -> bool {
        self.active && self.capacity > self.current_packets
    }

    pub fn leave(&mut self) {
        self.current_packets = self.current_packets.saturating_sub(1);
    }

    pub fn enter(&mut self, packet_id: usize) -> EnterResult {
        if self.available() {
            self.current_packets += 1;
            EnterResult::Entered
        } else if self.queue.len() < self.max_queue_size {
            if !self.queue.contains(&packet_id) {
                self.queue.push_back(packet_id);
            }
            EnterResult::Queued
        } else {
            EnterResult::Dropped
        }
    }

    pub fn dequeue(&mut self) -> Option<usize> {
        if self.available() {
            let packet_id = self.queue.pop_front()?;
            self.current_packets += 1;
            Some(packet_id)
        } else {
            None
        }
    }
}
