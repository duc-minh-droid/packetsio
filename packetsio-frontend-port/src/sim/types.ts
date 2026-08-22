/**
 * Engine contract for the rebuilt wasm-bindgen `Simulation` class.
 * The UI is written against these types only.
 */

export type NodeKind = "client" | "router" | "server";

export type PacketState = "ready" | "travelling" | "queued" | "delivered" | "dropped";

export type ProtocolKind = "arp_request" | "arp_reply" | "icmp_echo_request" | "icmp_echo_reply";

export interface SnapNode {
  id: number;
  node_type: NodeKind;
  ip: string;
  mask: string;
  mac: string;
  arp_cache: Array<[string, string]>;
}

export interface SnapLink {
  from: number;
  to: number;
  latency: number;
  capacity: number;
  current_packets: number;
  queue_len: number;
  active: boolean;
}

export interface SnapPacket {
  id: number;
  state: PacketState;
  from_node: number;
  to_node: number | null;
  /** 0.0 at from_node .. 1.0 at to_node */
  progress: number;
  ttl: number;
  src_mac: string;
  dst_mac: string;
  src_ip: string;
  dst_ip: string;
  protocol: ProtocolKind;
}

export interface SimSnapshot {
  tick: number;
  finished: boolean;
  nodes: SnapNode[];
  links: SnapLink[];
  packets: SnapPacket[];
}

export interface SimEngine {
  // topology building
  add_node(id: number, kind: NodeKind): void;
  add_link(from: number, to: number, latency: number, capacity: number, max_queue_size: number): void;
  set_link_active(from: number, to: number, active: boolean): boolean;
  spawn_packet(from: number, to: number): number;
  load_default_topology(): void;

  // stepping
  step(): void;
  is_finished(): boolean;

  /** JSON-encoded SimSnapshot */
  snapshot(): string;

  // metrics
  current_tick(): number;
  delivered(): number;
  dropped(): number;
  total_packets(): number;
  delivery_rate(): number;
  average_latency(): number;
  throughput(): number;
  max_queue_size(): number;

  free?(): void;
}

export interface Metrics {
  tick: number;
  delivered: number;
  dropped: number;
  totalPackets: number;
  deliveryRate: number;
  averageLatency: number;
  throughput: number;
  maxQueueSize: number;
  finished: boolean;
}

export const readMetrics = (sim: SimEngine): Metrics => ({
  tick: sim.current_tick(),
  delivered: sim.delivered(),
  dropped: sim.dropped(),
  totalPackets: sim.total_packets(),
  deliveryRate: sim.delivery_rate(),
  averageLatency: sim.average_latency(),
  throughput: sim.throughput(),
  maxQueueSize: sim.max_queue_size(),
  finished: sim.is_finished(),
});

export const readSnapshot = (sim: SimEngine): SimSnapshot => {
  try {
    return JSON.parse(sim.snapshot()) as SimSnapshot;
  } catch {
    return { tick: sim.current_tick(), finished: sim.is_finished(), nodes: [], links: [], packets: [] };
  }
};

export const emptySnapshot: SimSnapshot = {
  tick: 0,
  finished: false,
  nodes: [],
  links: [],
  packets: [],
};

export type LogKind = "tick" | "sent" | "queued" | "delivered" | "dropped" | "system" | "topology";

export interface LogEntry {
  id: number;
  tick: number;
  kind: LogKind;
  message: string;
}
