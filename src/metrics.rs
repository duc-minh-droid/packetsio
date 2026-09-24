use serde::Serialize;

#[derive(Serialize, Clone, Debug, Default)]
pub struct Metrics {
    pub total_packets: usize,
    pub delivered: usize,
    pub dropped: usize,
    pub total_latency: usize,
    pub total_ticks: usize,
    pub max_queue_size: usize,

    // Congestion metrics
    pub total_congestion_drops: usize,
    pub total_queue_delay: usize,
}

/// What happened during the most recent tick. The frontend charts these.
#[derive(Serialize, Clone, Debug, Default)]
pub struct TickStats {
    pub spawned: usize,
    pub delivered: usize,
    pub dropped: usize,
    /// Sum of end-to-end latency of packets delivered this tick
    pub latency_sum: usize,
    pub queued: usize,
    pub in_flight: usize,
    pub live: usize,
}

impl Metrics {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn delivery_rate(&self) -> f64 {
        if self.total_packets == 0 {
            0.0
        } else {
            self.delivered as f64 / self.total_packets as f64
        }
    }

    pub fn average_latency(&self) -> f64 {
        if self.delivered == 0 {
            0.0
        } else {
            self.total_latency as f64 / self.delivered as f64
        }
    }

    pub fn throughput(&self) -> f64 {
        if self.total_ticks == 0 {
            0.0
        } else {
            self.delivered as f64 / self.total_ticks as f64
        }
    }

    pub fn congestion_drop_rate(&self) -> f64 {
        if self.total_packets == 0 {
            0.0
        } else {
            self.total_congestion_drops as f64 / self.total_packets as f64
        }
    }

    pub fn average_queue_delay(&self) -> f64 {
        if self.delivered == 0 {
            0.0
        } else {
            self.total_queue_delay as f64 / self.delivered as f64
        }
    }
}
