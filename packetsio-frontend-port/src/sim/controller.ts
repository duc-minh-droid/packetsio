import { loadEngine, Simulation } from "./engine.ts";
import { buildScenario, SCENARIOS, type Scenario } from "./scenarios.ts";
import type { RoutingMode, SimEvent, Snapshot, SnapLink, SnapPacket } from "./types.ts";
import { linkKey, pairKey } from "./types.ts";

export interface Point {
  x: number;
  y: number;
}

export type Selection =
  | { kind: "node"; id: number }
  | { kind: "link"; a: number; b: number }
  | { kind: "packet"; id: number }
  | null;

export interface LogEntry {
  id: number;
  tick: number;
  tone: "ok" | "bad" | "info" | "warn";
  text: string;
}

export interface History {
  throughput: number[];
  latency: number[];
  dropRate: number[];
  queue: number[];
}

const HISTORY = 150;
export const SPEEDS = [1, 2, 4, 8, 16, 30];

const emptySnapshot: Snapshot = {
  tick: 0,
  finished: false,
  routing: "ospf",
  nodes: [],
  links: [],
  packets: [],
  events: [],
  stats: { spawned: 0, delivered: 0, dropped: 0, latency_sum: 0, queued: 0, in_flight: 0, live: 0 },
  metrics: {
    total_packets: 0,
    delivered: 0,
    dropped: 0,
    total_latency: 0,
    total_ticks: 0,
    max_queue_size: 0,
    total_congestion_drops: 0,
    total_queue_delay: 0,
  },
  flows: [],
};

/**
 * Owns the wasm `Simulation`, the playback clock and everything derived from
 * snapshots. React components subscribe via `subscribe`/`version`; the canvas
 * renderer reads fields directly every animation frame.
 */
export class SimController {
  sim: Simulation | null = null;
  ready = false;
  error: string | null = null;
  scenario: Scenario = SCENARIOS[0];
  positions = new Map<number, Point>();
  labels = new Map<number, string>();

  snap: Snapshot = emptySnapshot;
  links = new Map<string, SnapLink>();
  packets = new Map<number, SnapPacket>();
  /** Last known state of recently seen packets, so finished ones can still be inspected. */
  packetCache = new Map<number, SnapPacket>();

  playing = false;
  speedIndex = 2;
  lastTickAt = 0;
  history: History = { throughput: [], latency: [], dropRate: [], queue: [] };
  log: LogEntry[] = [];
  selection: Selection = null;
  version = 0;

  private logId = 0;
  private deliveredAcc = 0;
  private latencyAcc = 0;
  private emaThroughput = 0;
  private emaLatency = 0;
  private recentFinished: Array<[number, number]> = [];
  private listeners = new Set<() => void>();
  private tickListeners = new Set<(events: SimEvent[]) => void>();

  get tps() {
    return SPEEDS[this.speedIndex];
  }
  get interval() {
    return 1000 / this.tps;
  }

  async init() {
    try {
      await loadEngine();
      this.ready = true;
      this.load(this.scenario.id);
    } catch (e) {
      this.error = String(e);
      this.emit();
    }
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;

  onTick(fn: (events: SimEvent[]) => void) {
    this.tickListeners.add(fn);
    return () => this.tickListeners.delete(fn);
  }

  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  load(id: string) {
    const s = SCENARIOS.find((x) => x.id === id) ?? SCENARIOS[0];
    this.scenario = s;
    this.sim?.free();
    const sim = new Simulation();
    buildScenario(sim, s);
    this.sim = sim;
    this.positions = new Map(s.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    this.labels = new Map(s.nodes.map((n) => [n.id, n.label]));
    this.history = { throughput: [], latency: [], dropRate: [], queue: [] };
    this.emaThroughput = 0;
    this.emaLatency = 0;
    this.recentFinished = [];
    this.deliveredAcc = 0;
    this.latencyAcc = 0;
    this.packetCache.clear();
    this.selection = null;
    this.log = [];
    this.read();
    this.pushLog("info", `Loaded “${s.name}” · ${s.nodes.length} nodes · routing ${s.routing.toUpperCase()}`);
    this.lastTickAt = performance.now() - this.interval;
    this.emit();
  }

  reset() {
    const wasPlaying = this.playing;
    this.load(this.scenario.id);
    this.playing = wasPlaying;
    this.emit();
  }

  private read() {
    if (!this.sim) return;
    this.snap = JSON.parse(this.sim.snapshot()) as Snapshot;
    this.links = new Map(this.snap.links.map((l) => [linkKey(l.from, l.to), l]));
    this.packets = new Map(this.snap.packets.map((p) => [p.id, p]));
    for (const p of this.snap.packets) this.packetCache.set(p.id, p);
    if (this.packetCache.size > 600) {
      const keep = [...this.packetCache.keys()].slice(-400);
      const sel = this.selection?.kind === "packet" ? this.selection.id : -1;
      for (const k of this.packetCache.keys()) if (!keep.includes(k) && k !== sel) this.packetCache.delete(k);
    }
  }

  /** Advance the engine one tick and derive chart data from its stats. */
  step(now = performance.now()) {
    if (!this.sim) return;
    this.sim.step();
    this.read();
    this.lastTickAt = now;
    const st = this.snap.stats;

    this.emaThroughput = this.emaThroughput * 0.8 + st.delivered * 0.2;
    if (st.delivered > 0) {
      const lat = st.latency_sum / st.delivered;
      this.emaLatency = this.emaLatency === 0 ? lat : this.emaLatency * 0.75 + lat * 0.25;
    }
    this.recentFinished.push([st.delivered, st.dropped]);
    if (this.recentFinished.length > 12) this.recentFinished.shift();
    const [d, x] = this.recentFinished.reduce((a, b) => [a[0] + b[0], a[1] + b[1]], [0, 0]);
    const h = this.history;
    h.throughput.push(this.emaThroughput);
    h.latency.push(this.emaLatency);
    h.dropRate.push(d + x > 0 ? (x / (d + x)) * 100 : 0);
    h.queue.push(st.queued);
    for (const k of Object.keys(h) as Array<keyof History>) if (h[k].length > HISTORY) h[k].shift();

    this.logEvents(this.snap.events);
    for (const fn of this.tickListeners) fn(this.snap.events);
    if (this.snap.finished && this.playing) {
      this.playing = false;
      this.pushLog("info", `Simulation finished at tick ${this.snap.tick}`);
    }
    this.emit();
  }

  /** Called by the render loop every frame. */
  frame(now: number) {
    if (!this.playing || !this.sim) return;
    const due = now - this.lastTickAt;
    if (due >= this.interval) {
      // If the tab stalled, don't try to catch up with a burst of ticks.
      this.step(due > this.interval * 3 ? now : this.lastTickAt + this.interval);
    }
  }

  /** 0..1 progress through the current tick, used for interpolation. */
  alpha(now: number) {
    return Math.min(1, Math.max(0, (now - this.lastTickAt) / this.interval));
  }

  play() {
    if (this.snap.finished) this.reset();
    this.playing = true;
    this.lastTickAt = performance.now() - this.interval;
    this.emit();
  }
  pause() {
    this.playing = false;
    this.emit();
  }
  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }
  manualStep() {
    this.playing = false;
    this.step();
  }
  setSpeed(i: number) {
    this.speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, i));
    this.emit();
  }

  setRouting(mode: RoutingMode) {
    if (!this.sim) return;
    this.sim.set_routing_protocol(mode);
    this.read();
    this.pushLog("info", `Routing switched to ${mode.toUpperCase()}`);
    this.emit();
  }

  /** Cut or restore both directions of a cable. */
  setPairActive(a: number, b: number, active: boolean) {
    if (!this.sim) return;
    this.sim.set_link_active(a, b, active);
    this.sim.set_link_active(b, a, active);
    this.sim.refresh_routes();
    this.read();
    this.pushLog(active ? "ok" : "warn", `Link ${this.name(a)} ⇄ ${this.name(b)} ${active ? "restored" : "cut"}`);
    this.emit();
  }

  pairActive(a: number, b: number) {
    const f = this.links.get(linkKey(a, b));
    const r = this.links.get(linkKey(b, a));
    return (f?.active ?? false) || (r?.active ?? false);
  }

  /** Cut the busiest active cable (by queue + load). */
  chaos() {
    let best: [number, number] | null = null;
    let score = -1;
    const seen = new Set<string>();
    for (const l of this.snap.links) {
      const k = pairKey(l.from, l.to);
      if (seen.has(k) || !l.active) continue;
      seen.add(k);
      const kinds = [this.kindOf(l.from), this.kindOf(l.to)];
      if (kinds.includes("client") || kinds.includes("server")) continue;
      const rev = this.links.get(linkKey(l.to, l.from));
      const s = l.queue_len + l.load * 4 + l.forwarded * 0.01 + (rev ? rev.queue_len + rev.load * 4 : 0);
      if (s > score) {
        score = s;
        best = [l.from, l.to];
      }
    }
    if (best) {
      this.setPairActive(best[0], best[1], false);
      this.selection = { kind: "link", a: best[0], b: best[1] };
      this.emit();
    }
  }

  /** Burst from a client (the selected one if any) to a server. */
  burst(count = 10) {
    if (!this.sim) return;
    const clients = this.snap.nodes.filter((n) => n.node_type === "client");
    const servers = this.snap.nodes.filter((n) => n.node_type === "server");
    if (!clients.length || !servers.length) return;
    const sel = this.selection?.kind === "node" ? this.selection.id : null;
    const src = clients.find((c) => c.id === sel) ?? clients[this.snap.tick % clients.length];
    const dst = servers[(this.snap.tick + src.id) % servers.length];
    this.sim.spawn_burst(src.id, dst.id, count);
    this.read();
    this.pushLog("info", `Burst of ${count} packets ${this.name(src.id)} → ${this.name(dst.id)}`);
    this.emit();
  }

  ping(from: number, to: number) {
    if (!this.sim) return;
    const target = this.snap.nodes.find((n) => n.id === to);
    if (!target) return;
    this.sim.ping(from, target.ip);
    this.read();
    this.pushLog("info", `ping ${target.ip} from ${this.name(from)}`);
    this.emit();
  }

  select(sel: Selection) {
    this.selection = sel;
    this.emit();
  }

  moveNode(id: number, p: Point) {
    this.positions.set(id, p);
  }

  name(id: number) {
    return this.labels.get(id) ?? `N${id}`;
  }
  kindOf(id: number) {
    return this.snap.nodes.find((n) => n.id === id)?.node_type ?? "router";
  }

  /** Remaining hops for a packet according to the routers' current tables. */
  predictedPath(p: SnapPacket): number[] {
    const start = p.state === "travelling" || p.state === "queued" ? (p.to_node ?? p.from_node) : p.from_node;
    const out = [start];
    let cur = start;
    for (let i = 0; i < 24 && cur !== p.destination; i++) {
      const node = this.snap.nodes.find((n) => n.id === cur);
      const r = node?.routes.find((x) => x.destination === p.destination);
      if (!r || out.includes(r.next_hop)) break;
      out.push(r.next_hop);
      cur = r.next_hop;
    }
    return out;
  }

  pushLog(tone: LogEntry["tone"], text: string) {
    this.log.push({ id: ++this.logId, tick: this.snap.tick, tone, text });
    if (this.log.length > 120) this.log.shift();
  }

  private logEvents(events: SimEvent[]) {
    for (const e of events) {
      if (e.kind === "delivered") {
        this.deliveredAcc++;
        this.latencyAcc += parseInt(e.detail ?? "0", 10) || 0;
      } else if (e.kind === "dropped" && e.packet != null) {
        const where = e.link ? `${this.name(e.link[0])} → ${this.name(e.link[1])}` : this.name(e.node ?? 0);
        const why = { queue_full: "queue full", ttl_expired: "TTL expired", no_route: "no route", link_down: "link down" }[
          e.reason ?? "queue_full"
        ];
        this.pushLog("bad", `#${e.packet} dropped at ${where} (${why})`);
      } else if (e.kind === "route_change" && e.node != null) {
        this.pushLog("warn", `${this.name(e.node)}: ${e.detail}`);
      }
    }
    // Deliveries are frequent; summarise them every 10 ticks.
    if (this.snap.tick % 10 === 0 && this.deliveredAcc > 0) {
      const n = this.deliveredAcc;
      this.pushLog("ok", `${n} delivered in the last 10 ticks · avg ${(this.latencyAcc / n).toFixed(1)} ticks`);
      this.deliveredAcc = 0;
      this.latencyAcc = 0;
    }
  }
}

export const controller = new SimController();
