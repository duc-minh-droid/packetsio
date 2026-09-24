import type { Point, SimController } from "../sim/controller.ts";
import type { NodeKind, SimEvent, SnapLink, SnapPacket } from "../sim/types.ts";
import { linkKey, pairKey } from "../sim/types.ts";
import { COLORS, NODE_COLOR, congestionRGB, packetColor, rgba, withAlpha } from "./palette.ts";

const NODE_R = 27;
const LANE = 5.5;
const TRIM = NODE_R + 7;
const SLOT = 10;
const TRAIL = 24;

interface Lane {
  sx: number;
  sy: number;
  ex: number;
  ey: number;
  ux: number;
  uy: number;
  nx: number;
  ny: number;
  len: number;
}

interface Vis {
  x: number;
  y: number;
  mode: string;
  trail: Point[];
  seen: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
}

interface Effect {
  kind: "burst" | "ring" | "flash";
  x: number;
  y: number;
  t0: number;
  dur: number;
  color: string;
  radius?: number;
  particles?: Particle[];
  pair?: [number, number];
}

export type Hit =
  | { kind: "node"; id: number }
  | { kind: "packet"; id: number }
  | { kind: "link"; a: number; b: number; from: number; to: number };

const easeInOut = (t: number) => 0.5 - Math.cos(Math.PI * t) / 2;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

function glowSprite(color: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, withAlpha(color, 0.9));
  grad.addColorStop(0.18, withAlpha(color, 0.45));
  grad.addColorStop(0.45, withAlpha(color, 0.12));
  grad.addColorStop(1, withAlpha(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return c;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  w = 0;
  h = 0;
  cam = { s: 1, ox: 0, oy: 0 };
  hover: Hit | null = null;
  private effects: Effect[] = [];
  private vis = new Map<number, Vis>();
  private sprites = new Map<string, HTMLCanvasElement>();
  private linkActivity = new Map<string, number>();
  private nodeHover = new Map<number, number>();
  private last = performance.now();
  private raf = 0;
  private fittedFor = "";
  private mouse: Point | null = null;
  private unsubscribe: () => void;
  bottomInset = 110;
  topInset = 150;

  private canvas: HTMLCanvasElement;
  private C: SimController;

  constructor(canvas: HTMLCanvasElement, C: SimController) {
    this.canvas = canvas;
    this.C = C;
    this.ctx = canvas.getContext("2d")!;
    this.unsubscribe = C.onTick((events) => this.onEvents(events));
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.unsubscribe();
  }

  resize(w: number, h: number) {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.fit();
  }

  fit() {
    const pts = [...this.C.positions.values()];
    if (!pts.length || !this.w) return;
    const minX = Math.min(...pts.map((p) => p.x)) - 90;
    const maxX = Math.max(...pts.map((p) => p.x)) + 90;
    const minY = Math.min(...pts.map((p) => p.y)) - 70;
    const maxY = Math.max(...pts.map((p) => p.y)) + 80;
    // Keep clear of the event feed (top) and the control dock (bottom), but
    // centre in the whole stage when there is room.
    const availH = this.h - this.bottomInset - this.topInset;
    const s = Math.min(this.w / (maxX - minX), availH / (maxY - minY), 1.35);
    const gh = (maxY - minY) * s;
    const top = Math.max(this.topInset, (this.h - this.bottomInset + 20 - gh) / 2);
    this.cam.s = s;
    this.cam.ox = (this.w - (maxX - minX) * s) / 2 - minX * s;
    this.cam.oy = Math.min(top, this.h - this.bottomInset - gh) - minY * s;
    this.fittedFor = this.C.scenario.id + ":" + this.C.version;
  }

  toWorld(sx: number, sy: number): Point {
    return { x: (sx - this.cam.ox) / this.cam.s, y: (sy - this.cam.oy) / this.cam.s };
  }

  zoomAt(sx: number, sy: number, factor: number) {
    const before = this.toWorld(sx, sy);
    this.cam.s = Math.max(0.3, Math.min(3, this.cam.s * factor));
    this.cam.ox = sx - before.x * this.cam.s;
    this.cam.oy = sy - before.y * this.cam.s;
  }

  setMouse(p: Point | null) {
    this.mouse = p;
  }

  private sprite(color: string) {
    let s = this.sprites.get(color);
    if (!s) {
      s = glowSprite(color);
      this.sprites.set(color, s);
    }
    return s;
  }

  private pos(id: number): Point {
    return this.C.positions.get(id) ?? { x: 0, y: 0 };
  }

  lane(from: number, to: number): Lane {
    const a = this.pos(from);
    const b = this.pos(to);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    return {
      sx: a.x + ux * TRIM + nx * LANE,
      sy: a.y + uy * TRIM + ny * LANE,
      ex: b.x - ux * TRIM + nx * LANE,
      ey: b.y - uy * TRIM + ny * LANE,
      ux,
      uy,
      nx,
      ny,
      len: len - TRIM * 2,
    };
  }

  private slot(l: Lane, i: number): Point {
    const d = 6 + i * SLOT;
    return { x: l.sx + l.ux * d + l.nx * 11, y: l.sy + l.uy * d + l.ny * 11 };
  }

  private congestion(l: SnapLink) {
    const q = l.max_queue_size > 0 ? l.queue_len / l.max_queue_size : 0;
    return Math.min(1, Math.max(q, l.load * 1.6, l.utilization * 0.35));
  }

  // ---------------------------------------------------------------- events

  private onEvents(events: SimEvent[]) {
    const now = performance.now();
    const ringed = new Set<number>();
    for (const e of events) {
      if (e.kind === "dropped") {
        let p: Point | null = null;
        const v = e.packet != null ? this.vis.get(e.packet) : undefined;
        if (e.reason === "queue_full" && e.link) {
          const l = this.C.links.get(linkKey(e.link[0], e.link[1]));
          p = this.slot(this.lane(e.link[0], e.link[1]), Math.min(12, l?.max_queue_size ?? 4));
        } else if (v) p = { x: v.x, y: v.y };
        else if (e.node != null) p = this.pos(e.node);
        if (p) this.burst(p, now);
      } else if (e.kind === "delivered" && e.node != null && !ringed.has(e.node)) {
        ringed.add(e.node);
        const p = this.pos(e.node);
        this.effects.push({ kind: "ring", x: p.x, y: p.y, t0: now, dur: 650, color: COLORS.teal, radius: NODE_R });
      } else if (e.kind === "route_change" && e.node != null) {
        const p = this.pos(e.node);
        this.effects.push({ kind: "ring", x: p.x, y: p.y, t0: now, dur: 800, color: COLORS.violet, radius: NODE_R - 4 });
      } else if (e.kind === "link_state" && e.link) {
        this.effects.push({
          kind: "flash",
          x: 0,
          y: 0,
          t0: now,
          dur: 900,
          color: e.detail === "up" ? COLORS.teal : COLORS.rose,
          pair: e.link,
        });
      }
    }
  }

  private burst(p: Point, now: number) {
    const particles: Particle[] = [];
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 40 + Math.random() * 90;
      particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, size: 1.5 + Math.random() * 2.5 });
    }
    this.effects.push({ kind: "burst", x: p.x, y: p.y, t0: now, dur: 750, color: COLORS.rose, particles });
  }

  // ---------------------------------------------------------------- hit test

  hitTest(sx: number, sy: number): Hit | null {
    const w = this.toWorld(sx, sy);
    const tol = 1 / this.cam.s;
    for (const n of this.C.snap.nodes) {
      const p = this.pos(n.id);
      if (Math.hypot(p.x - w.x, p.y - w.y) < NODE_R + 4 * tol) return { kind: "node", id: n.id };
    }
    let best: Hit | null = null;
    let bestD = 11 * Math.max(1, tol);
    for (const [id, v] of this.vis) {
      const p = this.C.packets.get(id);
      if (!p || p.state === "dropped" || p.state === "delivered") continue;
      const d = Math.hypot(v.x - w.x, v.y - w.y);
      if (d < bestD) {
        bestD = d;
        best = { kind: "packet", id };
      }
    }
    if (best) return best;
    let bestL = 12 * Math.max(1, tol);
    for (const l of this.C.snap.links) {
      const ln = this.lane(l.from, l.to);
      const t = Math.max(0, Math.min(1, ((w.x - ln.sx) * ln.ux + (w.y - ln.sy) * ln.uy) / Math.max(1, ln.len)));
      const px = ln.sx + ln.ux * ln.len * t;
      const py = ln.sy + ln.uy * ln.len * t;
      const d = Math.hypot(px - w.x, py - w.y);
      if (d < bestL) {
        bestL = d;
        best = { kind: "link", a: Math.min(l.from, l.to), b: Math.max(l.from, l.to), from: l.from, to: l.to };
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- frame

  private loop(now: number) {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(64, now - this.last);
    this.last = now;
    this.C.frame(now);
    if (!this.fittedFor.startsWith(this.C.scenario.id + ":")) this.fit();
    this.draw(now, dt);
  }

  private draw(now: number, dt: number) {
    const { ctx, cam, C } = this;
    const alpha = C.alpha(now);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, this.w, this.h);

    // vignette glow
    const vg = ctx.createRadialGradient(this.w * 0.5, this.h * 0.42, 0, this.w * 0.5, this.h * 0.42, this.w * 0.7);
    vg.addColorStop(0, "rgba(56, 189, 248, 0.055)");
    vg.addColorStop(0.5, "rgba(167, 139, 250, 0.025)");
    vg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, this.w, this.h);

    ctx.setTransform(this.dpr * cam.s, 0, 0, this.dpr * cam.s, this.dpr * cam.ox, this.dpr * cam.oy);
    this.drawGrid();
    this.drawCables(now);
    this.drawLanes(now, dt);
    this.drawSelectionRoute(now);
    this.drawQueues(now);
    this.drawPackets(now, dt, alpha);
    this.drawNodes(now, dt);
    this.drawEffects(now);
    this.drawTooltip();
  }

  private drawGrid() {
    const { ctx, cam } = this;
    const tl = this.toWorld(0, 0);
    const br = this.toWorld(this.w, this.h);
    const step = 40;
    ctx.fillStyle = COLORS.grid;
    const r = 1.2 / cam.s;
    for (let x = Math.floor(tl.x / step) * step; x < br.x; x += step) {
      for (let y = Math.floor(tl.y / step) * step; y < br.y; y += step) {
        ctx.fillRect(x - r / 2, y - r / 2, r, r);
      }
    }
  }

  private pairs() {
    const seen = new Map<string, [number, number]>();
    for (const l of this.C.snap.links) {
      const k = pairKey(l.from, l.to);
      if (!seen.has(k)) seen.set(k, [Math.min(l.from, l.to), Math.max(l.from, l.to)]);
    }
    return [...seen.values()];
  }

  private drawCables(now: number) {
    const { ctx, C } = this;
    const sel = C.selection;
    ctx.lineCap = "round";
    for (const [a, b] of this.pairs()) {
      const pa = this.pos(a);
      const pb = this.pos(b);
      const up = C.pairActive(a, b);
      const selected = sel?.kind === "link" && sel.a === a && sel.b === b;
      const hovered = this.hover?.kind === "link" && this.hover.a === a && this.hover.b === b;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.strokeStyle = selected ? "rgba(248,250,252,0.10)" : hovered ? "rgba(148,163,184,0.11)" : COLORS.cable;
      ctx.lineWidth = 26;
      ctx.stroke();
      if (!up) {
        ctx.save();
        ctx.setLineDash([7, 7]);
        ctx.lineDashOffset = -now / 60;
        ctx.strokeStyle = withAlpha(COLORS.rose, 0.55);
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
        // cut marker
        const mx = (pa.x + pb.x) / 2;
        const my = (pa.y + pb.y) / 2;
        ctx.save();
        ctx.translate(mx, my);
        ctx.fillStyle = "#1a0d12";
        ctx.strokeStyle = COLORS.rose;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-3.5, -3.5);
        ctx.lineTo(3.5, 3.5);
        ctx.moveTo(3.5, -3.5);
        ctx.lineTo(-3.5, 3.5);
        ctx.stroke();
        ctx.restore();
      }
      if (selected) {
        ctx.save();
        ctx.setLineDash([2, 6]);
        ctx.lineDashOffset = -now / 40;
        ctx.strokeStyle = "rgba(248,250,252,0.5)";
        ctx.lineWidth = 1;
        const nx = -(pb.y - pa.y);
        const ny = pb.x - pa.x;
        const len = Math.hypot(nx, ny) || 1;
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(pa.x + (nx / len) * 15 * s, pa.y + (ny / len) * 15 * s);
          ctx.lineTo(pb.x + (nx / len) * 15 * s, pb.y + (ny / len) * 15 * s);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  private drawLanes(now: number, dt: number) {
    const { ctx, C } = this;
    for (const l of C.snap.links) {
      if (!l.active) continue;
      const key = linkKey(l.from, l.to);
      const target = l.current_packets > 0 || l.queue_len > 0 ? 1 : 0;
      const prev = this.linkActivity.get(key) ?? 0;
      const act = prev + (target - prev) * (1 - Math.exp(-dt / 350));
      this.linkActivity.set(key, act);

      const ln = this.lane(l.from, l.to);
      const c = congestionRGB(this.congestion(l));
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(ln.sx, ln.sy);
      ctx.lineTo(ln.ex, ln.ey);
      // glow
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = rgba(c, 0.05 + act * 0.13);
      ctx.lineWidth = 9;
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = rgba(c, 0.28 + act * 0.5);
      ctx.lineWidth = 1.8;
      ctx.stroke();
      // moving dashes show direction of travel
      if (act > 0.02) {
        ctx.save();
        ctx.setLineDash([3, 13]);
        ctx.lineDashOffset = -(now / 1000) * (22 + 30 / l.latency);
        ctx.strokeStyle = rgba(c, 0.55 * act);
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.restore();
      }
      // arrowhead near the receiving end
      const ax = ln.ex - ln.ux * 2;
      const ay = ln.ey - ln.uy * 2;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - ln.ux * 6 + ln.nx * 3, ay - ln.uy * 6 + ln.ny * 3);
      ctx.lineTo(ax - ln.ux * 6 - ln.nx * 3, ay - ln.uy * 6 - ln.ny * 3);
      ctx.closePath();
      ctx.fillStyle = rgba(c, 0.35 + act * 0.5);
      ctx.fill();
    }
  }

  private drawQueues(now: number) {
    const { ctx, C } = this;
    for (const l of C.snap.links) {
      if (!l.active || l.max_queue_size === 0) continue;
      const selected =
        C.selection?.kind === "link" &&
        C.selection.a === Math.min(l.from, l.to) &&
        C.selection.b === Math.max(l.from, l.to);
      if (l.queue_len === 0 && !selected) continue;
      const ln = this.lane(l.from, l.to);
      const n = Math.min(l.max_queue_size, 12);
      const fill = l.queue_len / l.max_queue_size;
      const c = congestionRGB(0.35 + fill * 0.65);
      const angle = Math.atan2(ln.uy, ln.ux);
      for (let i = 0; i < n; i++) {
        const p = this.slot(ln, i);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(angle);
        const filled = i < l.queue_len;
        if (filled && fill >= 1) ctx.translate(Math.sin(now / 45 + i) * 0.6, 0);
        ctx.beginPath();
        ctx.roundRect(-4, -4, 8, 8, 2);
        if (filled) {
          ctx.fillStyle = rgba(c, 0.95);
          ctx.fill();
        } else {
          ctx.strokeStyle = "rgba(148,163,184,0.28)";
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
        ctx.restore();
      }
      if (l.queue_len > 0) {
        const g = this.slot(ln, (l.queue_len - 1) / 2);
        ctx.globalCompositeOperation = "lighter";
        const s = 26 + l.queue_len * 7;
        ctx.globalAlpha = 0.35 + fill * 0.4;
        ctx.drawImage(this.sprite(fill >= 1 ? COLORS.rose : COLORS.amber), g.x - s / 2, g.y - s / 2, s, s);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      }
    }
  }

  private packetTarget(p: SnapPacket, alpha: number, now: number): { pt: Point; mode: string } | null {
    if (p.state === "travelling" && p.to_node != null) {
      const ln = this.lane(p.from_node, p.to_node);
      const f = Math.min(1, (p.elapsed + alpha) / Math.max(1, p.latency));
      const e = easeInOut(f);
      return { pt: { x: ln.sx + ln.ux * ln.len * e, y: ln.sy + ln.uy * ln.len * e }, mode: "t" + linkKey(p.from_node, p.to_node) };
    }
    if (p.state === "queued" && p.to_node != null) {
      const ln = this.lane(p.from_node, p.to_node);
      return { pt: this.slot(ln, p.queue_pos ?? 0), mode: "q" };
    }
    if (p.state === "ready" || p.state === "delivered") {
      const c = this.pos(p.from_node);
      if (p.state === "delivered") return { pt: c, mode: "d" };
      const a = p.id * 2.39996 + now / 900;
      return { pt: { x: c.x + Math.cos(a) * (NODE_R + 9), y: c.y + Math.sin(a) * (NODE_R + 9) }, mode: "r" };
    }
    return null;
  }

  private drawPackets(now: number, dt: number, alpha: number) {
    const { ctx, C } = this;
    const k = 1 - Math.exp(-dt / 55);
    for (const [id, v] of this.vis) if (!C.packets.has(id) && now - v.seen > 100) this.vis.delete(id);

    const sel = C.selection?.kind === "packet" ? C.selection.id : null;
    ctx.lineCap = "round";
    for (const p of C.snap.packets) {
      if (p.state === "dropped") continue;
      const t = this.packetTarget(p, alpha, now);
      if (!t) continue;
      let v = this.vis.get(p.id);
      if (!v) {
        v = { x: t.pt.x, y: t.pt.y, mode: t.mode, trail: [], seen: now };
        this.vis.set(p.id, v);
      }
      v.seen = now;
      const jump = Math.hypot(t.pt.x - v.x, t.pt.y - v.y);
      if (t.mode.startsWith("t") && v.mode === t.mode && jump < 40) {
        v.x = t.pt.x;
        v.y = t.pt.y;
      } else {
        v.x += (t.pt.x - v.x) * k;
        v.y += (t.pt.y - v.y) * k;
        if (jump < 1.5) v.mode = t.mode;
      }
      if (t.mode.startsWith("t")) v.mode = t.mode;
      const lastT = v.trail[v.trail.length - 1];
      if (!lastT || Math.hypot(lastT.x - v.x, lastT.y - v.y) > 1.2) {
        v.trail.push({ x: v.x, y: v.y });
        if (v.trail.length > TRAIL) v.trail.shift();
      } else if (v.trail.length > 1 && p.state !== "travelling") {
        v.trail.shift();
      }

      const color = packetColor(p);
      let fade = 1;
      if (p.state === "delivered") fade = 1 - easeOut(alpha);
      if (fade <= 0.01) continue;
      const isSel = sel === p.id;

      // latency trail
      if (v.trail.length > 2 && p.state !== "queued") {
        ctx.globalCompositeOperation = "lighter";
        for (let i = 1; i < v.trail.length; i++) {
          const f = i / v.trail.length;
          ctx.beginPath();
          ctx.moveTo(v.trail[i - 1].x, v.trail[i - 1].y);
          ctx.lineTo(v.trail[i].x, v.trail[i].y);
          ctx.strokeStyle = withAlpha(color, 0.7 * f * f * fade);
          ctx.lineWidth = 4.6 * f;
          ctx.stroke();
        }
        ctx.globalCompositeOperation = "source-over";
      }
      if (p.state === "queued") continue; // drawn as a queue slot

      const size = p.state === "ready" ? 22 : 40;
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = fade * (p.state === "ready" ? 0.6 : 1);
      ctx.drawImage(this.sprite(color), v.x - size / 2, v.y - size / 2, size, size);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.beginPath();
      ctx.arc(v.x, v.y, p.state === "ready" ? 2.4 : 3.8, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha("#ffffff", 0.92 * fade);
      ctx.fill();
      if (isSel) {
        ctx.beginPath();
        ctx.arc(v.x, v.y, 9 + Math.sin(now / 160) * 1.5, 0, Math.PI * 2);
        ctx.strokeStyle = withAlpha(color, 0.95);
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
    }

    // outline selected queued packet
    if (sel != null) {
      const p = C.packets.get(sel);
      const v = this.vis.get(sel);
      if (p && v && p.state === "queued") {
        ctx.beginPath();
        ctx.arc(v.x, v.y, 7.5, 0, Math.PI * 2);
        ctx.strokeStyle = COLORS.white;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
    }
  }

  private drawSelectionRoute(now: number) {
    const { ctx, C } = this;
    if (C.selection?.kind !== "packet") return;
    const p = C.packets.get(C.selection.id) ?? C.packetCache.get(C.selection.id);
    if (!p) return;
    const color = packetColor(p);
    const past = p.path.map((id) => this.pos(id));
    const v = this.vis.get(p.id);
    if (v && (p.state === "travelling" || p.state === "queued")) past.push({ x: v.x, y: v.y });
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (past.length > 1) {
      ctx.beginPath();
      past.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = withAlpha(color, 0.22);
      ctx.lineWidth = 18;
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = withAlpha(color, 0.9);
      ctx.lineWidth = 3.5;
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    if (p.state !== "delivered" && p.state !== "dropped") {
      const future = C.predictedPath(p).map((id) => this.pos(id));
      if (v) future.unshift({ x: v.x, y: v.y });
      if (future.length > 1) {
        ctx.save();
        ctx.setLineDash([5, 7]);
        ctx.lineDashOffset = -now / 30;
        ctx.beginPath();
        future.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
        ctx.strokeStyle = "rgba(248,250,252,0.55)";
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  private drawNodes(now: number, dt: number) {
    const { ctx, C, cam } = this;
    const sel = C.selection;
    const inv = 1 / cam.s;
    const outQueue = new Map<number, [number, number]>();
    for (const l of C.snap.links) {
      if (!l.active) continue;
      const q = outQueue.get(l.from) ?? [0, 0];
      q[0] += l.queue_len;
      q[1] += l.max_queue_size;
      outQueue.set(l.from, q);
    }

    for (const n of C.snap.nodes) {
      const p = this.pos(n.id);
      const color = NODE_COLOR[n.node_type];
      const hovered = this.hover?.kind === "node" && this.hover.id === n.id;
      const h0 = this.nodeHover.get(n.id) ?? 0;
      const h = h0 + ((hovered ? 1 : 0) - h0) * (1 - Math.exp(-dt / 90));
      this.nodeHover.set(n.id, h);
      const r = NODE_R * (1 + h * 0.08);
      const isSel = sel?.kind === "node" && sel.id === n.id;

      // aura
      ctx.globalCompositeOperation = "lighter";
      const breath = 0.5 + 0.5 * Math.sin(now / 1400 + n.id);
      ctx.globalAlpha = 0.22 + breath * 0.08 + h * 0.15;
      const s = r * 4.2;
      ctx.drawImage(this.sprite(color), p.x - s / 2, p.y - s / 2, s, s);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";

      // body
      const grad = ctx.createRadialGradient(p.x - r * 0.35, p.y - r * 0.45, r * 0.1, p.x, p.y, r);
      grad.addColorStop(0, "#1c2638");
      grad.addColorStop(1, "#0a0f18");
      ctx.beginPath();
      if (n.node_type === "router") ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      else ctx.roundRect(p.x - r, p.y - r, r * 2, r * 2, r * 0.42);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = withAlpha(color, 0.85);
      ctx.lineWidth = 1.8;
      ctx.stroke();

      // queue pressure ring
      const q = outQueue.get(n.id);
      if (q && q[1] > 0 && q[0] > 0) {
        const f = Math.min(1, q[0] / q[1]);
        const c = congestionRGB(0.4 + f * 0.6);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.06, f));
        ctx.strokeStyle = rgba(c, 0.95);
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.stroke();
      }

      this.drawIcon(n.node_type, p.x, p.y, color);

      if (isSel) {
        ctx.save();
        ctx.setLineDash([4, 5]);
        ctx.lineDashOffset = -now / 50;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 11, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(248,250,252,0.8)";
        ctx.lineWidth = 1.3;
        ctx.stroke();
        ctx.restore();
      }

      // labels (constant screen size)
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const ly = p.y + r + 8 + (isSel ? 4 : 0);
      const nameFont = `600 ${12.5 * inv}px Inter, system-ui, sans-serif`;
      const ipFont = `500 ${10 * inv}px "JetBrains Mono", monospace`;
      ctx.font = nameFont;
      const nw = ctx.measureText(C.name(n.id)).width;
      ctx.font = ipFont;
      const iw = ctx.measureText(n.ip).width;
      const bw = Math.max(nw, iw) + 12 * inv;
      ctx.beginPath();
      ctx.roundRect(p.x - bw / 2, ly - 3 * inv, bw, 32 * inv, 6 * inv);
      ctx.fillStyle = "rgba(6, 8, 13, 0.78)";
      ctx.fill();
      ctx.font = nameFont;
      ctx.fillStyle = COLORS.text;
      ctx.fillText(C.name(n.id), p.x, ly);
      ctx.font = ipFont;
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(n.ip, p.x, ly + 15 * inv);
    }
  }

  private drawIcon(kind: NodeKind, x: number, y: number, color: string) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.7;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (kind === "client") {
      ctx.beginPath();
      ctx.roundRect(-10, -9, 20, 13, 2);
      ctx.stroke();
      ctx.globalAlpha = 0.18;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(0, 4);
      ctx.lineTo(0, 8);
      ctx.moveTo(-5, 9);
      ctx.lineTo(5, 9);
      ctx.stroke();
    } else if (kind === "router") {
      const arrow = (x1: number, y1: number, x2: number, y2: number) => {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        const a = Math.atan2(y2 - y1, x2 - x1);
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - Math.cos(a - 0.6) * 4, y2 - Math.sin(a - 0.6) * 4);
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - Math.cos(a + 0.6) * 4, y2 - Math.sin(a + 0.6) * 4);
        ctx.stroke();
      };
      arrow(-9, -4, 9, -4);
      arrow(9, 4, -9, 4);
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(0, 0, 14, 0, Math.PI * 2);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      for (let i = 0; i < 3; i++) {
        const yy = -10 + i * 7;
        ctx.beginPath();
        ctx.roundRect(-10, yy, 20, 5.5, 1.5);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(-6, yy + 2.75, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-1, yy + 2.75);
        ctx.lineTo(6, yy + 2.75);
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1.7;
      }
    }
    ctx.restore();
  }

  private drawEffects(now: number) {
    const { ctx } = this;
    this.effects = this.effects.filter((e) => now - e.t0 < e.dur);
    for (const e of this.effects) {
      const t = (now - e.t0) / e.dur;
      if (e.kind === "ring") {
        ctx.beginPath();
        ctx.arc(e.x, e.y, (e.radius ?? 20) + easeOut(t) * 22, 0, Math.PI * 2);
        ctx.strokeStyle = withAlpha(e.color, 0.8 * (1 - t));
        ctx.lineWidth = 2.2 * (1 - t) + 0.4;
        ctx.stroke();
      } else if (e.kind === "burst" && e.particles) {
        const secs = (now - e.t0) / 1000;
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.9 * (1 - t);
        const s = 34 * (1 - t * 0.5);
        ctx.drawImage(this.sprite(e.color), e.x - s / 2, e.y - s / 2, s, s);
        ctx.globalAlpha = 1;
        for (const p of e.particles) {
          const drag = 1 - Math.exp(-secs * 3);
          const x = p.x + (p.vx / 3) * drag;
          const y = p.y + (p.vy / 3) * drag;
          ctx.fillStyle = withAlpha(e.color, 1 - t);
          ctx.fillRect(x - p.size / 2, y - p.size / 2, p.size, p.size);
        }
        ctx.globalCompositeOperation = "source-over";
        ctx.beginPath();
        ctx.arc(e.x, e.y, 4 + easeOut(t) * 16, 0, Math.PI * 2);
        ctx.strokeStyle = withAlpha(e.color, 0.7 * (1 - t));
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else if (e.kind === "flash" && e.pair) {
        const a = this.pos(e.pair[0]);
        const b = this.pos(e.pair[1]);
        ctx.globalCompositeOperation = "lighter";
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = withAlpha(e.color, 0.45 * (1 - t));
        ctx.lineWidth = 18 * (1 - t) + 2;
        ctx.stroke();
        ctx.globalCompositeOperation = "source-over";
      }
    }
  }

  private drawTooltip() {
    const { ctx, C, hover, mouse } = this;
    if (!hover || !mouse || hover.kind === "node") return;
    let text = "";
    if (hover.kind === "link") {
      const l = C.links.get(linkKey(hover.from, hover.to));
      if (!l) return;
      text = `${C.name(l.from)} → ${C.name(l.to)}   lat ${l.latency}  bw ${l.bandwidth}/t  q ${l.queue_len}/${l.max_queue_size}`;
    } else {
      const p = C.packets.get(hover.id);
      if (!p) return;
      text = `#${p.id}  ${C.name(p.source)} → ${C.name(p.destination)}  ${p.state}  age ${p.age}`;
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.font = `500 11px "JetBrains Mono", monospace`;
    const w = ctx.measureText(text).width + 18;
    const x = Math.min(mouse.x + 14, this.w - w - 8);
    const y = mouse.y + 16;
    ctx.beginPath();
    ctx.roundRect(x, y, w, 24, 6);
    ctx.fillStyle = "rgba(12,17,27,0.92)";
    ctx.fill();
    ctx.strokeStyle = "rgba(148,163,184,0.25)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + 9, y + 12.5);
  }
}
