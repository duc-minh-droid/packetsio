/**
 * Presentation-only layout for the engine's topology.
 *
 * The engine knows nothing about x/y — node coordinates live here (and in
 * React state) and are keyed by the node id reported in `snapshot().nodes`.
 */

import type { NodeKind } from "./types.ts";

export interface Point {
  x: number;
  y: number;
}

export const VIEW_W = 640;
export const VIEW_H = 320;
export const NODE_R = 30;
/** Radius used to trim link endpoints so arrowheads stop at the circle. */
export const EDGE_TRIM = 34;

/** Layout for the built-in demo network (ids as emitted by load_default_topology). */
export const DEFAULT_POSITIONS: Record<number, Point> = {
  0: { x: 70, y: 160 },
  1: { x: 300, y: 70 },
  3: { x: 300, y: 250 },
  2: { x: 560, y: 160 },
};

/** Deterministic fallback spot for a node with no stored position. */
export function fallbackPosition(id: number): Point {
  const golden = 0.6180339887;
  const t = (id * golden) % 1;
  return {
    x: 80 + t * (VIEW_W - 160),
    y: 60 + ((id * 97) % 200),
  };
}

export const NODE_KIND_COLORS: Record<NodeKind, string> = {
  client: "var(--color-primary)",
  router: "var(--color-secondary)",
  server: "var(--color-chart-4)",
};

export const NODE_KIND_LABEL: Record<NodeKind, string> = {
  client: "CLIENT",
  router: "ROUTER",
  server: "SERVER",
};

export function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Trim a segment by `trim` px at both ends. */
export function trimSegment(a: Point, b: Point, trim = EDGE_TRIM) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  return {
    x1: a.x + ux * trim,
    y1: a.y + uy * trim,
    x2: b.x - ux * trim,
    y2: b.y - uy * trim,
  };
}

export const linkKey = (from: number, to: number) => `${from}-${to}`;
