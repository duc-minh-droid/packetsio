import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createSimulation } from "@/sim/createSimulation.ts";
import { DEFAULT_POSITIONS, fallbackPosition, type Point } from "@/sim/topology.ts";
import {
  emptySnapshot,
  readMetrics,
  readSnapshot,
  type LogEntry,
  type Metrics,
  type NodeKind,
  type PacketState,
  type ProtocolKind,
  type SimEngine,
  type SimSnapshot,
} from "@/sim/types.ts";

const emptyMetrics: Metrics = {
  tick: 0,
  delivered: 0,
  dropped: 0,
  totalPackets: 0,
  deliveryRate: 0,
  averageLatency: 0,
  throughput: 0,
  maxQueueSize: 0,
  finished: false,
};

const stateVerb: Record<PacketState, string> = {
  ready: "is ready at",
  travelling: "started travelling",
  queued: "queued at",
  delivered: "delivered to",
  dropped: "dropped at",
};

function logKindFor(state: PacketState): LogEntry["kind"] {
  if (state === "delivered") return "delivered";
  if (state === "dropped") return "dropped";
  if (state === "queued") return "queued";
  return "sent";
}

const protocolLabel: Record<ProtocolKind, string> = {
  arp_request: "ARP Who-has",
  arp_reply: "ARP Reply",
  icmp_echo_request: "ICMP Echo Request",
  icmp_echo_reply: "ICMP Echo Reply",
};

export function useSimulation() {
  const simRef = useRef<SimEngine | null>(null);
  const bootGeneration = useRef(0);
  const logId = useRef(0);
  const prevPacketStates = useRef(new Map<number, PacketState>());

  const [ready, setReady] = useState(false);
  const [source, setSource] = useState<"wasm" | "fallback" | null>(null);
  const [metrics, setMetrics] = useState<Metrics>(emptyMetrics);
  const [snapshot, setSnapshot] = useState<SimSnapshot>(emptySnapshot);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2); // ticks per second (default 2.0 = 500ms / tick)
  const [positions, setPositions] = useState<Record<number, Point>>({ ...DEFAULT_POSITIONS });

  const tickMs = useMemo(() => Math.max(30, Math.round(1000 / Math.max(0.1, speed))), [speed]);

  const pushLog = useCallback((tick: number, kind: LogEntry["kind"], message: string) => {
    logId.current += 1;
    const entry = { id: logId.current, tick, kind, message };
    setLog((prev) => [...prev.slice(-499), entry]);
  }, []);

  const disposeSimulation = useCallback((sim: SimEngine | null = simRef.current) => {
    if (!sim) return;

    try {
      sim.free?.();
    } catch {
      // ignore double-free / already-dropped WASM instances
    }

    if (simRef.current === sim) {
      simRef.current = null;
    }
  }, []);

  /** Read metrics + snapshot without stepping (used after topology edits). */
  const refresh = useCallback(() => {
    const sim = simRef.current;
    if (!sim) return;
    setMetrics(readMetrics(sim));
    const snap = readSnapshot(sim);
    setSnapshot(snap);
    return snap;
  }, []);

  const boot = useCallback(async () => {
    const generation = ++bootGeneration.current;

    // Free any previously allocated WASM Simulation before creating a new one.
    // This prevents double-boot in React Strict Mode from corrupting the WASM allocator.
    disposeSimulation();

    const { sim, source: src } = await createSimulation();

    if (bootGeneration.current !== generation) {
      try {
        sim.free?.();
      } catch {
        // ignore stale instances that lost the race to a newer boot
      }
      return;
    }

    sim.load_default_topology();

    if (bootGeneration.current !== generation) {
      try {
        sim.free?.();
      } catch {
        // ignore stale instances that lost the race to a newer boot
      }
      return;
    }

    simRef.current = sim;
    setSource(src);
    setReady(true);
    setPositions({ ...DEFAULT_POSITIONS });
    setLog([]);
    logId.current = 0;
    prevPacketStates.current = new Map();
    const snap = readSnapshot(sim);
    setSnapshot(snap);
    setMetrics(readMetrics(sim));
    for (const p of snap.packets) prevPacketStates.current.set(p.id, p.state);
    pushLog(
      snap.tick,
      "system",
      `Default topology loaded — ${snap.nodes.length} nodes, ${snap.links.length} links, ${snap.packets.length} packet(s)`,
    );
  }, [disposeSimulation, pushLog]);

  useEffect(() => {
    void boot();

    return () => {
      bootGeneration.current += 1;
      disposeSimulation();
    };
  }, [boot]);

  const step = useCallback(() => {
    const sim = simRef.current;
    if (!sim || sim.is_finished()) {
      setPlaying(false);
      return;
    }
    try {
      sim.step();
      const snap = readSnapshot(sim);
      setSnapshot(snap);
      setMetrics(readMetrics(sim));

      // Real per-packet transitions, diffed against the previous snapshot.
      for (const p of snap.packets) {
        const before = prevPacketStates.current.get(p.id);
        if (before === p.state) continue;
        prevPacketStates.current.set(p.id, p.state);
        const where =
          p.state === "travelling"
            ? `${p.from_node} → ${p.to_node ?? "?"}`
            : `node ${p.from_node}`;
        pushLog(
          snap.tick,
          logKindFor(p.state),
          `${protocolLabel[p.protocol]} packet #${p.id} ${stateVerb[p.state]} ${where} | ${p.src_ip} (${p.src_mac}) → ${p.dst_ip} (${p.dst_mac})${before ? ` (was ${before})` : ""}`,
        );
      }

      if (snap.finished) {
        pushLog(snap.tick, "system", "Run finished — all packets arrived or dropped");
        setPlaying(false);
      }
    } catch (err) {
      console.error("[packetsio] error during step execution:", err);
      const raw = err instanceof Error ? err.message : String(err);
      const tick = (() => { try { return sim.current_tick(); } catch { return -1; } })();

      // Translate common WASM / Rust panic messages into actionable diagnostics.
      let diagnosis: string;
      if (/memory access out of bounds/i.test(raw)) {
        diagnosis =
          "WASM memory access out of bounds — the engine accessed an invalid address. " +
          "Likely cause: a packet routing to a node that no longer exists, or an empty/malformed topology. " +
          "→ Reset the simulation or check your topology for disconnected nodes.";
      } else if (/unreachable/i.test(raw) || /wasm unreachable/i.test(raw)) {
        diagnosis =
          "WASM engine hit an unreachable code path (Rust panic). " +
          "This is a logic assertion failure inside the engine. " +
          "→ Reset the simulation or try a simpler topology.";
      } else if (/out of bounds table access/i.test(raw)) {
        diagnosis =
          "WASM function table out-of-bounds — the engine may have been freed or corrupted. " +
          "→ Refresh the page to reload the simulation engine.";
      } else if (/integer overflow/i.test(raw) || /divide by zero/i.test(raw)) {
        diagnosis =
          "Arithmetic error inside the engine (overflow or divide-by-zero). " +
          "→ Check link latency/capacity values — they may be zero or extremely large.";
      } else {
        diagnosis = `Engine error: ${raw}`;
      }

      pushLog(tick, "system", `Step failed at tick ${tick}: ${diagnosis}`);
      setPlaying(false);
    }
  }, [pushLog]);

  const reset = useCallback(() => {
    setPlaying(false);
    bootGeneration.current += 1;
    disposeSimulation();
    setReady(false);
    setMetrics(emptyMetrics);
    setSnapshot(emptySnapshot);
    void boot();
  }, [boot, disposeSimulation]);

  useEffect(() => {
    if (!playing || !ready) return;
    const id = window.setInterval(step, tickMs);
    return () => window.clearInterval(id);
  }, [playing, ready, step, tickMs]);

  // ---- topology editing (positions are frontend-only) ----

  const addNode = useCallback(
    (kind: NodeKind, at: Point) => {
      const sim = simRef.current;
      if (!sim) return;
      const existing = readSnapshot(sim).nodes.map((n) => n.id);
      const id = existing.length ? Math.max(...existing) + 1 : 0;
      sim.add_node(id, kind);
      setPositions((prev) => ({ ...prev, [id]: at }));
      pushLog(sim.current_tick(), "topology", `added ${kind} node ${id}`);
      refresh();
      return id;
    },
    [pushLog, refresh],
  );

  const addLink = useCallback(
    (from: number, to: number, latency: number, capacity: number, maxQueueSize: number) => {
      const sim = simRef.current;
      if (!sim) return;
      sim.add_link(from, to, latency, capacity, maxQueueSize);
      pushLog(
        sim.current_tick(),
        "topology",
        `added link ${from} → ${to} (lat ${latency}, cap ${capacity}, queue ${maxQueueSize})`,
      );
      refresh();
    },
    [pushLog, refresh],
  );

  const toggleLink = useCallback(
    (from: number, to: number, active: boolean) => {
      const sim = simRef.current;
      if (!sim) return;
      const ok = sim.set_link_active(from, to, active);
      pushLog(
        sim.current_tick(),
        "topology",
        ok
          ? `link ${from} → ${to} set ${active ? "ACTIVE" : "INACTIVE"}`
          : `link ${from} → ${to} not found`,
      );
      refresh();
    },
    [pushLog, refresh],
  );

  const spawnPacket = useCallback(
    (from: number, to: number) => {
      const sim = simRef.current;
      if (!sim) return;
      const id = sim.spawn_packet(from, to);
      prevPacketStates.current.set(id, "ready");
      pushLog(sim.current_tick(), "topology", `spawned packet #${id}: ${from} → ${to}`);
      refresh();
      return id;
    },
    [pushLog, refresh],
  );

  const setNodePosition = useCallback((id: number, at: Point) => {
    setPositions((prev) => ({ ...prev, [id]: at }));
  }, []);

  const positionOf = useCallback(
    (id: number): Point => positions[id] ?? fallbackPosition(id),
    [positions],
  );

  return {
    ready,
    source,
    metrics,
    snapshot,
    log,
    playing,
    setPlaying,
    speed,
    setSpeed,
    tickMs,
    step,
    reset,
    positions,
    positionOf,
    setNodePosition,
    addNode,
    addLink,
    toggleLink,
    spawnPacket,
  };
}
