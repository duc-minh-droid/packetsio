use std::collections::VecDeque;

pub enum EnterResult {
    Entered,
    Queued,
    Dropped,
}

/// A directed link between two nodes.
///
/// * `latency`   - propagation delay in ticks
/// * `bandwidth` - how many packets may *enter* the link per tick
/// * `capacity`  - how many packets may be in transit at the same time
/// * `max_queue_size` - FIFO buffer at the sending end; tail-drop when full
#[derive(Clone, Debug)]
pub struct Link {
    pub from_node_id: usize,
    pub to_node_id: usize,
    pub latency: usize,
    pub bandwidth: usize,
    pub capacity: usize,
    pub current_packets: usize,
    pub queue: VecDeque<usize>,
    pub active: bool,
    pub max_queue_size: usize,

    // Per-tick bandwidth accounting
    pub sent_this_tick: usize,

    // Congestion metrics
    pub total_entered: usize,    // packets that tried to use the link
    pub total_forwarded: usize,  // packets that actually started travelling
    pub total_dropped: usize,    // tail drops (queue full)
    pub total_queue_time: usize, // ticks spent waiting in this link's queue
    pub load: f64,               // EWMA of (in transit + queued) / (capacity + queue)
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
            sent_this_tick: 0,
            total_entered: 0,
            total_forwarded: 0,
            total_dropped: 0,
            total_queue_time: 0,
            load: 0.0,
        }
    }

    /// Reset per-tick bandwidth tokens. Called at the start of every tick.
    pub fn begin_tick(&mut self) {
        self.sent_this_tick = 0;
    }

    /// Called at the end of every tick.
    pub fn update_metrics(&mut self) {
        self.total_queue_time += self.queue.len();
        let denom = (self.capacity + self.max_queue_size).max(1) as f64;
        let instant = (self.current_packets + self.queue.len()) as f64 / denom;
        self.load = self.load * 0.8 + instant * 0.2;
    }

    /// True when a packet could start travelling right now.
    pub fn available(&self) -> bool {
        self.active && self.current_packets < self.capacity && self.sent_this_tick < self.bandwidth
    }

    pub fn utilization(&self) -> f64 {
        self.current_packets as f64 / self.capacity.max(1) as f64
    }

    /// Average number of ticks a forwarded packet waited in this link's queue.
    pub fn queue_delay(&self) -> f64 {
        if self.total_forwarded == 0 {
            0.0
        } else {
            self.total_queue_time as f64 / self.total_forwarded as f64
        }
    }

    pub fn packet_loss_rate(&self) -> f64 {
        if self.total_entered == 0 {
            0.0
        } else {
            self.total_dropped as f64 / self.total_entered as f64
        }
    }

    /// Link-state cost used by the congestion-aware routing mode: propagation
    /// delay plus the time the current queue needs to drain.
    pub fn congestion_cost(&self) -> usize {
        let drain = (self.queue.len() + self.bandwidth - 1) / self.bandwidth;
        let saturated = if self.current_packets >= self.capacity { 1 } else { 0 };
        self.latency + drain + saturated
    }

    pub fn congestion_metric(&self) -> f64 {
        let queue_fill = if self.max_queue_size == 0 {
            0.0
        } else {
            self.queue.len() as f64 / self.max_queue_size as f64
        };
        self.utilization() + queue_fill + self.packet_loss_rate()
    }

    fn start_one(&mut self) {
        self.current_packets += 1;
        self.sent_this_tick += 1;
        self.total_forwarded += 1;
    }

    pub fn leave(&mut self) {
        self.current_packets = self.current_packets.saturating_sub(1);
    }

    /// Offer a packet to the link. FIFO: a new packet never overtakes a queue.
    pub fn enter(&mut self, packet_id: usize) -> EnterResult {
        self.total_entered += 1;
        if self.queue.is_empty() && self.available() {
            self.start_one();
            EnterResult::Entered
        } else if self.active && self.queue.len() < self.max_queue_size {
            self.queue.push_back(packet_id);
            EnterResult::Queued
        } else {
            self.total_dropped += 1;
            EnterResult::Dropped
        }
    }

    /// Pop the head of the queue if the link can accept it this tick.
    pub fn dequeue(&mut self) -> Option<usize> {
        if self.available() {
            let packet_id = self.queue.pop_front()?;
            self.start_one();
            Some(packet_id)
        } else {
            None
        }
    }

    pub fn queue_position(&self, packet_id: usize) -> Option<usize> {
        self.queue.iter().position(|&id| id == packet_id)
    }
}
