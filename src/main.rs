use packetsio::Simulation;
use packetsio::node::NodeType;

fn main() {
    let mut sim = Simulation::new();
    sim.load_default_topology();

    // Activate both paths: 0-1-2 and 0-3-2
    sim.set_link_active(0, 3, true);
    sim.set_link_active(3, 0, true);

    // Create a burst of packets from client (0) to server (2)
    // We'll send 30 packets to create congestion
    for _ in 0..30 {
        sim.spawn_packet(0, 2);
    }

    println!("Starting simulation with 30 packets from client to server...");
    println!("Both paths are active: 0-1-2 (latency 5) and 0-3-2 (latency 3)");
    println!("We expect congestion on the first path due to limited bandwidth and capacity");

    // Run for 200 steps or until finished
    let mut step = 0;
    while !sim.is_finished() && step < 200 {
        sim.step();
        step += 1;

        // Print progress every 20 steps
        if step % 20 == 0 {
            println!("Step {}: {} packets delivered, {} dropped",
                     step, sim.delivered(), sim.dropped());
        }
    }

    println!("\n=== SIMULATION FINISHED ===");
    println!("Steps: {}", step);
    println!("Packets: {}", sim.total_packets());
    println!("Delivered: {}", sim.delivered());
    println!("Dropped: {}", sim.dropped());
    println!("Delivery rate: {:.2}%", sim.delivery_rate() * 100.0);
    println!("Average latency: {:.2} ticks", sim.average_latency());
    println!("Throughput: {:.2} packets/tick", sim.throughput());
    println!("Max queue size: {}", sim.max_queue_size());
    println!("Congestion drops: {}", sim.metrics.total_congestion_drops);
    println!("Congestion drop rate: {:.2}%", sim.metrics.congestion_drop_rate() * 100.0);
    println!("Average queue delay: {:.2} ticks", sim.metrics.average_queue_delay());

    // Print routing tables for routers
    println!("\n=== ROUTING TABLES ===");
    for (id, node) in &sim.nodes {
        if node.node_type == NodeType::Router {
            println!("Router {}:", id);
            for (dest, route) in &node.routing_table {
                println!("  To {} via {} (cost: {})", dest, route.next_hop, route.cost);
            }
        }
    }

    // Print link congestion metrics from the simulation
    println!("\n=== LINK CONGESTION METRICS ===");
    for (from, links) in &sim.links {
        for link in links {
            if link.active {
                println!("Link {} -> {}: utilization={:.2}, queue_delay={:.2}, loss_rate={:.2}",
                         from, link.to_node_id,
                         link.utilization(),
                         link.queue_delay(),
                         link.packet_loss_rate());
            }
        }
    }
}