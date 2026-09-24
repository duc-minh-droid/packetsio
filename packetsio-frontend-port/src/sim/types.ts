/**
 * Mirror of the JSON produced by `Simulation::snapshot()` in src/snapshot.rs.
 * The UI never simulates anything itself; it only reads these.
 */

export type NodeKind = "client" | "router" | "server";
export type PacketState = "ready" | "travelling" | "queued" | "delivered" | "dropped";
export type ProtocolKind =
  | "arp_request"
  | "arp_reply"
  | "icmp_echo_request"
  | "icmp_echo_reply"
  | "ospf_lsa"
  | "udp";
export type DropReason = "queue_full" | "ttl_expired" | "no_route" | "link_down";
export type RoutingMode = "ospf" | "adaptive" | "rip";

export interface Route {
  destination: number;
  next_hop: number;
  cost: number;
}

export interface SnapNode {
  id: number;
  node_type: NodeKind;
  ip: string;
  mask: string;
  mac: string;
  routes: Route[];
  forwarded: number;
  received: number;
  dropped: number;
}

export interface SnapLink {
  from: number;
  to: number;
  latency: number;
  bandwidth: number;
  capacity: number;
  current_packets: number;
  queue_len: number;
  max_queue_size: number;
  active: boolean;
  utilization: number;
  queue_delay: number;
  packet_loss_rate: number;
  load: number;
  forwarded: number;
  dropped: number;
}

export interface SnapPacket {
  id: number;
  state: PacketState;
  from_node: number;
  to_node: number | null;
  elapsed: number;
  latency: number;
  progress: number;
  queue_pos: number | null;
  ttl: number;
  source: number;
  destination: number;
  src_mac: string;
  dst_mac: string;
  src_ip: string;
  dst_ip: string;
  protocol: ProtocolKind;
  path: number[];
  age: number;
  queued_ticks: number;
  drop_reason: DropReason | null;
  flow: number | null;
}

export type EventKind = "spawned" | "delivered" | "dropped" | "queued" | "route_change" | "link_state";

export interface SimEvent {
  tick: number;
  kind: EventKind;
  packet: number | null;
  node: number | null;
  link: [number, number] | null;
  reason: DropReason | null;
  detail: string | null;
}

export interface TickStats {
  spawned: number;
  delivered: number;
  dropped: number;
  latency_sum: number;
  queued: number;
  in_flight: number;
  live: number;
}

export interface EngineMetrics {
  total_packets: number;
  delivered: number;
  dropped: number;
  total_latency: number;
  total_ticks: number;
  max_queue_size: number;
  total_congestion_drops: number;
  total_queue_delay: number;
}

export interface FlowInfo {
  id: number;
  src: number;
  dst: number;
  interval: number;
  burst: number;
  start: number;
  stop: number;
}

export interface Snapshot {
  tick: number;
  finished: boolean;
  routing: RoutingMode;
  nodes: SnapNode[];
  links: SnapLink[];
  packets: SnapPacket[];
  events: SimEvent[];
  stats: TickStats;
  metrics: EngineMetrics;
  flows: FlowInfo[];
}

export const linkKey = (from: number, to: number) => `${from}>${to}`;
export const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
