#[derive(Clone, Debug, Default)]
pub struct Metrics {
    pub total_packets: usize,
    pub delivered: usize,
    pub dropped: usize,
    pub total_latency: usize,
    pub total_ticks: usize,
    pub max_queue_size: usize,
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
}
