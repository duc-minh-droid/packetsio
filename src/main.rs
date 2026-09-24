//! CLI demo for the packetsio engine.
//!
//!   cargo run                       human-readable congestion demo
//!   cargo run -- --routing adaptive same demo with congestion-aware routing
//!   cargo run -- --trace 120        one JSON snapshot per tick (JSON lines)

use packetsio::node::NodeType;
use packetsio::Simulation;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let arg_value = |name: &str| {
        args.iter()
            .position(|a| a == name)
            .and_then(|i| args.get(i + 1))
            .cloned()
    };
    let routing = arg_value("--routing").unwrap_or_else(|| "ospf".to_string());
    let trace_ticks = arg_value("--trace").and_then(|v| v.parse::<usize>().ok());

    let mut sim = Simulation::new();
    sim.load_default_topology();
    sim.set_routing_protocol(&routing);

    // Bring up the faster path 0-3-2 and offer 3 packets per tick for 10 ticks.
    sim.set_link_active(0, 3, true);
    sim.set_link_active(3, 0, true);
    sim.add_flow(0, 2, 1, 3, 0, 10);
    sim.refresh_routes();

    if let Some(ticks) = trace_ticks {
        println!("{}", sim.snapshot());
        for _ in 0..ticks {
            if sim.is_finished() {
                break;
            }
            sim.step();
            println!("{}", sim.snapshot());
        }
        return;
    }

    println!("3 packets/tick for 10 ticks from client (0) to server (2), routing = {}", sim.routing_protocol());
    println!("Paths: 0-1-2 (latency 5) and 0-3-2 (latency 3); links carry 1 pkt/tick, queue 4\n");

    let mut step = 0;
    while !sim.is_finished() && step < 200 {
        sim.step();
        step += 1;
        if step % 5 == 0 {
            println!(
                "tick {:>3}: delivered {:>2}, dropped {:>2}",
                step,
                sim.delivered(),
                sim.dropped()
            );
        }
    }

    let m = sim.metrics();
    println!("\n=== SIMULATION FINISHED ===");
    println!("Ticks: {}", step);
    println!("Packets: {}", sim.total_packets());
    println!("Delivered: {}", sim.delivered());
    println!("Dropped: {}", sim.dropped());
    println!("Delivery rate: {:.2}%", sim.delivery_rate() * 100.0);
    println!("Average latency: {:.2} ticks", sim.average_latency());
    println!("Throughput: {:.2} packets/tick", sim.throughput());
    println!("Max queue size: {}", sim.max_queue_size());
    println!("Congestion drops: {}", m.total_congestion_drops);
    println!("Congestion drop rate: {:.2}%", m.congestion_drop_rate() * 100.0);
    println!("Average queue delay: {:.2} ticks", m.average_queue_delay());

    println!("\n=== ROUTING TABLES ===");
    for (id, node) in sim.nodes() {
        if node.node_type == NodeType::Router || node.node_type == NodeType::Client {
            println!("Node {} ({:?}):", id, node.node_type);
            for (dest, route) in &node.routing_table {
                println!("  to {} via {} (cost {})", dest, route.next_hop, route.cost);
            }
        }
    }

    println!("\n=== LINKS ===");
    for (from, links) in sim.links() {
        for link in links.iter().filter(|l| l.active) {
            println!(
                "{} -> {}: forwarded={:>2} dropped={:>2} loss={:.2} avg_queue_delay={:.2}",
                from,
                link.to_node_id,
                link.total_forwarded,
                link.total_dropped,
                link.packet_loss_rate(),
                link.queue_delay()
            );
        }
    }
}
