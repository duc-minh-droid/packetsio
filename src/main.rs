use packetsio::Simulation;

fn main() {
    let mut sim = Simulation::new();
    sim.load_default_topology();

    let ok = sim.ping(0, "192.168.1.5");
    println!("ping 192.168.1.5 -> {}", if ok { "scheduled" } else { "failed" });

    for _ in 0..12 {
        if sim.is_finished() {
            break;
        }
        sim.step();
        println!("{}", sim.snapshot());
    }

    println!("\n=== METRICS ===");
    println!("Packets: {}", sim.total_packets());
    println!("Delivered: {}", sim.delivered());
    println!("Dropped: {}", sim.dropped());
    println!("Delivery rate: {:.2}%", sim.delivery_rate() * 100.0);
    println!("Average latency: {:.2} ticks", sim.average_latency());
    println!("Throughput: {:.2} packets/tick", sim.throughput());
    println!("Max queue size: {}", sim.max_queue_size());
}