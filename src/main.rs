use packetsio::Simulation;

fn main() {
    let mut sim = Simulation::new();
    sim.load_default_topology();

    for _ in 0..7 {
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