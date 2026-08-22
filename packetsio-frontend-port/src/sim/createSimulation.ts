import wasmUrl from "../wasm/packetsio_bg.wasm?url";
import type { NodeKind, SimEngine, SimSnapshot } from "./types.ts";

/**
 * Loads the real wasm-pack (`--target web`) build at `src/wasm/packetsio.js`
 * and constructs a `Simulation`. Browser-only (dynamic import keeps it out of
 * the SSR pass). `createFallback` remains as a stand-in only if wasm init fails.
 */
export async function createSimulation(): Promise<{ sim: SimEngine; source: "wasm" | "fallback" }> {
  try {
    const mod = await import("../wasm/packetsio");
    await (mod as any).default(wasmUrl);
    return { sim: new mod.Simulation() as unknown as SimEngine, source: "wasm" };
  } catch (err) {
    console.warn("[packetsio] wasm engine unavailable, using stand-in engine", err);
    return { sim: createFallback(), source: "fallback" };
  }
}



interface FLink {
  from: number;
  to: number;
  latency: number;
  capacity: number;
  max_queue_size: number;
  active: boolean;
  inflight: number[];
  queue: number[];
}

interface FPacket {
  id: number;
  state: "ready" | "travelling" | "queued" | "delivered" | "dropped";
  from_node: number;
  to_node: number | null;
  dest: number;
  elapsed: number;
  ttl: number;
  born: number;
  latency: number;
}

/** Stand-in engine mirroring the Rust API, including per-tick snapshots. */
function createFallback(): SimEngine {
  let nodes = new Map<number, NodeKind>();
  let links: FLink[] = [];
  let packets: FPacket[] = [];
  let tick = 0;
  let nextPacketId = 0;
  let delivered = 0;
  let dropped = 0;
  let latencySum = 0;
  let maxQueue = 0;

  const findLink = (from: number, to: number) =>
    links.find((l) => l.from === from && l.to === to);

  /** Dijkstra over active links, weighted by latency. */
  function nextHop(from: number, dest: number): number | null {
    const dist = new Map<number, number>([[from, 0]]);
    const prev = new Map<number, number>();
    const seen = new Set<number>();
    while (true) {
      let cur: number | null = null;
      let best = Infinity;
      for (const [n, d] of dist) {
        if (!seen.has(n) && d < best) {
          best = d;
          cur = n;
        }
      }
      if (cur === null) break;
      if (cur === dest) break;
      seen.add(cur);
      for (const l of links) {
        if (!l.active || l.from !== cur) continue;
        const nd = best + l.latency;
        if (nd < (dist.get(l.to) ?? Infinity)) {
          dist.set(l.to, nd);
          prev.set(l.to, cur);
        }
      }
    }
    if (!dist.has(dest)) return null;
    let step = dest;
    while (prev.get(step) !== undefined && prev.get(step) !== from) step = prev.get(step)!;
    return prev.get(step) === from ? step : dest === from ? null : null;
  }

  function stepOnce() {
    tick += 1;

    // advance travelling packets
    for (const p of packets) {
      if (p.state !== "travelling") continue;
      p.elapsed += 1;
      if (p.elapsed >= p.latency) {
        const link = findLink(p.from_node, p.to_node!);
        if (link) link.inflight = link.inflight.filter((id) => id !== p.id);
        p.from_node = p.to_node!;
        p.to_node = null;
        p.elapsed = 0;
        if (p.from_node === p.dest) {
          p.state = "delivered";
          delivered += 1;
          latencySum += tick - p.born;
        } else {
          p.state = "ready";
        }
      }
    }

    // ttl decay
    for (const p of packets) {
      if (p.state === "delivered" || p.state === "dropped") continue;
      p.ttl -= 1;
      if (p.ttl <= 0) {
        p.state = "dropped";
        dropped += 1;
        const link = p.to_node === null ? undefined : findLink(p.from_node, p.to_node);
        if (link) {
          link.inflight = link.inflight.filter((id) => id !== p.id);
          link.queue = link.queue.filter((id) => id !== p.id);
        }
      }
    }

    // dispatch ready/queued packets
    for (const p of packets) {
      if (p.state !== "ready" && p.state !== "queued") continue;
      const hop = nextHop(p.from_node, p.dest);
      if (hop === null) continue;
      const link = findLink(p.from_node, hop);
      if (!link || !link.active) continue;
      if (link.inflight.length < link.capacity) {
        link.queue = link.queue.filter((id) => id !== p.id);
        link.inflight.push(p.id);
        p.state = "travelling";
        p.to_node = hop;
        p.elapsed = 0;
        p.latency = link.latency;
      } else if (link.queue.length < link.max_queue_size) {
        if (!link.queue.includes(p.id)) link.queue.push(p.id);
        p.state = "queued";
        p.to_node = hop;
      } else {
        p.state = "dropped";
        dropped += 1;
      }
    }

    maxQueue = links.reduce((m, l) => Math.max(m, l.queue.length), maxQueue);
  }

  const api: SimEngine = {
    add_node(id, kind) {
      nodes.set(id, kind);
    },
    add_link(from, to, latency, capacity, max_queue_size) {
      links.push({
        from,
        to,
        latency: Math.max(1, latency),
        capacity: Math.max(1, capacity),
        max_queue_size: Math.max(0, max_queue_size),
        active: true,
        inflight: [],
        queue: [],
      });
    },
    set_link_active(from, to, active) {
      const l = findLink(from, to);
      if (!l) return false;
      l.active = active;
      return true;
    },
    spawn_packet(from, to) {
      const id = nextPacketId++;
      packets.push({
        id,
        state: "ready",
        from_node: from,
        to_node: null,
        dest: to,
        elapsed: 0,
        ttl: 64,
        born: tick,
        latency: 1,
      });
      return id;
    },
    load_default_topology() {
      nodes = new Map();
      links = [];
      packets = [];
      tick = 0;
      nextPacketId = 0;
      delivered = 0;
      dropped = 0;
      latencySum = 0;
      maxQueue = 0;
      api.add_node(0, "client");
      api.add_node(1, "router");
      api.add_node(3, "router");
      api.add_node(2, "server");
      api.add_link(0, 1, 2, 1, 4);
      api.add_link(0, 3, 1, 1, 4);
      api.add_link(1, 2, 3, 1, 4);
      api.add_link(3, 2, 2, 1, 4);
      api.set_link_active(0, 3, false);
      api.spawn_packet(0, 2);
    },
    step() {
      if (api.is_finished()) return;
      stepOnce();
    },
    is_finished() {
      return (
        packets.length > 0 &&
        packets.every((p) => p.state === "delivered" || p.state === "dropped")
      );
    },
    snapshot() {
      const snap: SimSnapshot = {
        tick,
        finished: api.is_finished(),
        nodes: [...nodes.entries()].map(([id, node_type]) => ({ id, node_type })),
        links: links.map((l) => ({
          from: l.from,
          to: l.to,
          latency: l.latency,
          capacity: l.capacity,
          current_packets: l.inflight.length,
          queue_len: l.queue.length,
          active: l.active,
        })),
        packets: packets.map((p) => ({
          id: p.id,
          state: p.state,
          from_node: p.from_node,
          to_node: p.to_node,
          progress:
            p.state === "travelling" ? Math.min(1, p.elapsed / Math.max(1, p.latency)) : 0,
          ttl: p.ttl,
        })),
      };
      return JSON.stringify(snap);
    },
    current_tick: () => tick,
    delivered: () => delivered,
    dropped: () => dropped,
    total_packets: () => packets.length,
    delivery_rate: () => (packets.length ? delivered / packets.length : 0),
    average_latency: () => (delivered ? latencySum / delivered : 0),
    throughput: () => (tick ? delivered / tick : 0),
    max_queue_size: () => maxQueue,
  };

  return api;
}
