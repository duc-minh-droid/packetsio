import type { NodeKind, SnapPacket } from "../sim/types.ts";

export const COLORS = {
  bg: "#06080d",
  grid: "rgba(148, 163, 184, 0.075)",
  cable: "rgba(148, 163, 184, 0.07)",
  text: "#e2e8f0",
  muted: "#64748b",
  cyan: "#38bdf8",
  teal: "#2dd4bf",
  amber: "#fbbf24",
  rose: "#fb7185",
  violet: "#a78bfa",
  white: "#f8fafc",
};

export const NODE_COLOR: Record<NodeKind, string> = {
  client: "#38bdf8",
  router: "#a78bfa",
  server: "#34d399",
};

const FLOW_COLORS = ["#38bdf8", "#f472b6", "#fbbf24", "#a3e635", "#c084fc", "#fb923c"];

export function packetColor(p: Pick<SnapPacket, "flow" | "protocol">): string {
  if (p.protocol === "icmp_echo_request") return "#c084fc";
  if (p.protocol === "icmp_echo_reply") return "#2dd4bf";
  if (p.flow == null) return "#fb923c";
  return FLOW_COLORS[p.flow % FLOW_COLORS.length];
}

export function flowColor(id: number) {
  return FLOW_COLORS[id % FLOW_COLORS.length];
}

type RGB = [number, number, number];
const hex = (h: string): RGB => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];
const STOPS: RGB[] = [hex("#38bdf8"), hex("#fbbf24"), hex("#fb7185")];

/** 0 = idle cyan, 0.5 = amber, 1 = saturated rose */
export function congestionRGB(c: number): RGB {
  const t = Math.max(0, Math.min(1, c)) * 2;
  const i = Math.min(1, Math.floor(t));
  const f = t - i;
  const a = STOPS[i];
  const b = STOPS[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${a})`;
export const withAlpha = (h: string, a: number) => rgba(hex(h), a);
