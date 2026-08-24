use std::collections::VecDeque;
use std::time::Instant;

pub enum EnterResult {
    Entered,
    Queued,
    Dropped,
}

#[derive(Clone, Debug)]
pub struct Link {
    pub from_node_id: usize,
    pub to_node_id: usize,
    pub latency: usize,           // Base propagation delay (in ticks)
    pub bandwidth: usize,         // Bandwidth in packets per tick
    pub capacity: usize,          // Maximum packets that can be in transit
    pub current_packets: usize,   // Currently in transit packets
    pub queue: VecDeque<usize>,   // Queued packet IDs
    pub active: bool,
    pub max_queue_size: usize,

    // Congestion metrics
    pub total_entered: usize,     // Total packets that attempted to enter
    pub total_dropped: usize,     // Total packets dropped due to queue full
    pub total_queue_time: usize,  // Accumulated queue delay for all packets
    pub last_update: Instant,     // Last time metrics were updated
}

impl Link {
    pub fn new(
        from_node_id: usize,
        to_node_id: usize,
        latency: usize,
        bandwidth: usize,
        capacity: usize,
        max_queue_size: usize,
    ) -> Self {
        Self {
            from_node_id,
            to_node_id,
            latency: latency.max(1),
            bandwidth: bandwidth.max(1),
            capacity: capacity.max(1),
            current_packets: 0,
            queue: VecDeque::new(),
            active: true,
            max_queue_size,

            // Initialize congestion metrics
            total_entered: 0,
            total_dropped: 0,
            total_queue_time: 0,
            last_update: Instant::now(),
        }
    }

    // Update congestion metrics - call periodically
    pub fn update_metrics(&mut self) {
        let now = Instant::now();
        let elapsed = now.duration_since(self.last_update).as_secs_f64();

        // Add queue time for all packets currently in queue (approximation)
        // Each packet in queue has been waiting for roughly elapsed time
        self.total_queue_time += (self.queue.len() as f64 * elapsed) as usize;

        self.last_update = now;
    }

    pub fn available(&self) -> bool {
        self.active && self.current_packets < self.capacity
    }

    pub fn utilization(&self) -> f64 {
        if self.capacity == 0 {
            0.0
        } else {
            self.current_packets as f64 / self.capacity as f64
        }
    }

    pub fn queue_delay(&self) -> f64 {
        if self.queue.is_empty() {
            0.0
        } else {
            // Average queue time per packet
            let total_packets = self.total_entered as f64;
            if total_packets > 0.0 {
                self.total_queue_time as f64 / total_packets
            } else {
                0.0
            }
        }
    }

    pub fn packet_loss_rate(&self) -> f64 {
        let total_attempts = self.total_entered as f64;
        if total_attempts > 0.0 {
            self.total_dropped as f64 / total_attempts
        } else {
            0.0
        }
    }

    pub fn effective_latency(&self) -> usize {
        // Base latency + queue delay component
        let queue_delay_ticks = self.queue_delay() as usize;
        self.latency + queue_delay_ticks
    }

    pub fn congestion_metric(&self) -> f64 {
        // Combined metric: utilization + normalized queue delay + packet loss
        let utilization = self.utilization();
        let queue_delay_norm = (self.queue_delay() / 10.0).min(1.0); // Normalize assuming max 10 ticks queue delay
        let loss = self.packet_loss_rate();

        utilization + queue_delay_norm + loss
    }

    pub fn leave(&mut self) {
        self.current_packets = self.current_packets.saturating_sub(1);
    }

    pub fn enter(&mut self, packet_id: usize) -> EnterResult {
        self.total_entered += 1;

        if self.available() {
            self.current_packets += 1;
            EnterResult::Entered
        } else if self.queue.len() < self.max_queue_size {
            if !self.queue.contains(&packet_id) {
                self.queue.push_back(packet_id);
            }
            EnterResult::Queued
        } else {
            self.total_dropped += 1;
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