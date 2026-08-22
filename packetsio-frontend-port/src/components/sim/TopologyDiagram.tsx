import { useEffect, useMemo, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import {
  EDGE_TRIM,
  NODE_KIND_COLORS,
  NODE_KIND_LABEL,
  NODE_R,
  VIEW_H,
  VIEW_W,
  lerp,
  trimSegment,
  type Point,
} from "@/sim/topology.ts";
import type { NodeKind, SimSnapshot } from "@/sim/types.ts";

interface Props {
  snapshot: SimSnapshot;
  positionOf: (id: number) => Point;
  /** ms per tick — drives the packet tween duration. */
  tickMs: number;
  isRunning: boolean;
  onSetNodePosition: (id: number, at: Point) => void;
  onAddNode: (kind: NodeKind, at: Point) => void;
  onAddLink: (
    from: number,
    to: number,
    latency: number,
    capacity: number,
    maxQueueSize: number,
  ) => void;
  onToggleLink: (from: number, to: number, active: boolean) => void;
  onSpawnPacket: (from: number, to: number) => void;
}

type PendingNode = { at: Point };
type PendingLink = { from: number; to: number };
type PendingPacket = { from: number };

export function TopologyDiagram({
  snapshot,
  positionOf,
  tickMs,
  isRunning,
  onSetNodePosition,
  onAddNode,
  onAddLink,
  onToggleLink,
  onSpawnPacket,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [pendingNode, setPendingNode] = useState<PendingNode | null>(null);
  const [pendingLink, setPendingLink] = useState<PendingLink | null>(null);
  const [pendingPacket, setPendingPacket] = useState<PendingPacket | null>(null);

  const [nodeKind, setNodeKind] = useState<NodeKind>("router");
  const [latency, setLatency] = useState(2);
  const [capacity, setCapacity] = useState(1);
  const [queueSize, setQueueSize] = useState(4);
  const [dest, setDest] = useState<number | null>(null);
  const [mode, setMode] = useState<"interact" | "add-node" | "connect">("interact");
  const [connectFrom, setConnectFrom] = useState<number | null>(null);
  const [connectTo, setConnectTo] = useState<number | null>(null);
  const [camera, setCamera] = useState({ x: 0, y: 0, w: VIEW_W, h: VIEW_H });
  const [panning, setPanning] = useState<{
    startClient: Point;
    startCamera: { x: number; y: number; w: number; h: number };
  } | null>(null);
  const [movingNode, setMovingNode] = useState<{
    id: number;
    down: Point;
    moved: boolean;
  } | null>(null);

  const MIN_VIEW_W = VIEW_W * 0.4;
  const MAX_VIEW_W = VIEW_W * 2.8;

  useEffect(() => {
    if (isRunning) {
      setMode("interact");
      setConnectFrom(null);
      setConnectTo(null);
      setPanning(null);
      setMovingNode(null);
    }
  }, [isRunning]);

  useEffect(() => {
    if (mode !== "connect") {
      setConnectFrom(null);
      setConnectTo(null);
    }
  }, [mode]);

  const toWorld = (e: { clientX: number; clientY: number }): Point => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const r = svg.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width;
    const ny = (e.clientY - r.top) / r.height;
    return {
      x: camera.x + nx * camera.w,
      y: camera.y + ny * camera.h,
    };
  };

  const clampView = (next: { x: number; y: number; w: number; h: number }) => {
    const clampedW = Math.max(MIN_VIEW_W, Math.min(MAX_VIEW_W, next.w));
    const clampedH = clampedW * (VIEW_H / VIEW_W);
    const minX = -VIEW_W * 1.2;
    const maxX = VIEW_W * 1.2;
    const minY = -VIEW_H * 1.2;
    const maxY = VIEW_H * 1.2;
    return {
      x: Math.max(minX, Math.min(maxX, next.x)),
      y: Math.max(minY, Math.min(maxY, next.y)),
      w: clampedW,
      h: clampedH,
    };
  };

  const zoomAt = (clientX: number, clientY: number, zoomFactor: number) => {
    const anchor = toWorld({ clientX, clientY });
    setCamera((prev) => {
      const nextW = Math.max(MIN_VIEW_W, Math.min(MAX_VIEW_W, prev.w * zoomFactor));
      const nextH = nextW * (VIEW_H / VIEW_W);
      const rx = (anchor.x - prev.x) / prev.w;
      const ry = (anchor.y - prev.y) / prev.h;
      return clampView({
        x: anchor.x - rx * nextW,
        y: anchor.y - ry * nextH,
        w: nextW,
        h: nextH,
      });
    });
  };

  const resetView = () => setCamera({ x: 0, y: 0, w: VIEW_W, h: VIEW_H });

  const nodeIds = useMemo(() => snapshot.nodes.map((n) => n.id), [snapshot.nodes]);

  // Smooth 60fps frame interpolation state
  const [animPackets, setAnimPackets] = useState<{
    id: number;
    x: number;
    y: number;
    targetX: number;
    targetY: number;
    state: string;
    color: string;
    opacity: number;
    scale: number;
  }[]>([]);
  const animMapRef = useRef<Map<number, {
    id: number;
    x: number;
    y: number;
    targetX: number;
    targetY: number;
    state: string;
    color: string;
    opacity: number;
    scale: number;
  }>>(new Map());
  const prevTickRef = useRef(snapshot.tick);

  // Sync snapshot packet targets
  useEffect(() => {
    if (snapshot.tick === 0 && prevTickRef.current !== 0) {
      animMapRef.current.clear();
    }
    prevTickRef.current = snapshot.tick;

    const currentMap = animMapRef.current;

    for (const pk of snapshot.packets) {
      const from = positionOf(pk.from_node);
      const to = pk.to_node === null ? from : positionOf(pk.to_node);

      let tx = from.x;
      let ty = from.y;

      if (pk.state === "travelling" && pk.to_node !== null) {
        const seg = trimSegment(from, to, EDGE_TRIM);
        const p = lerp({ x: seg.x1, y: seg.y1 }, { x: seg.x2, y: seg.y2 }, pk.progress);
        tx = p.x;
        ty = p.y;
      } else if (pk.state === "queued" && pk.to_node !== null) {
        const p = lerp(from, to, 0.18);
        tx = p.x;
        ty = p.y;
      } else if (pk.state === "delivered" && pk.to_node !== null) {
        tx = to.x;
        ty = to.y;
      } else {
        tx = from.x;
        ty = from.y;
      }

      const color =
        pk.state === "dropped"
          ? "var(--color-destructive)"
          : pk.state === "delivered"
            ? "var(--color-chart-4)"
            : pk.state === "queued"
              ? "var(--color-secondary)"
              : "var(--color-primary)";

      const existing = currentMap.get(pk.id);
      if (!existing) {
        currentMap.set(pk.id, {
          id: pk.id,
          x: from.x,
          y: from.y,
          targetX: tx,
          targetY: ty,
          state: pk.state,
          color,
          opacity: 0,
          scale: 1,
        });
      } else {
        existing.targetX = tx;
        existing.targetY = ty;
        existing.state = pk.state;
        existing.color = color;
      }
    }
  }, [snapshot, positionOf]);

  // Continuous rAF animation loop for sub-tick smooth interpolation
  useEffect(() => {
    let animId: number;
    let lastTime = performance.now();

    const frame = (time: number) => {
      const dt = Math.min(0.08, (time - lastTime) / 1000);
      lastTime = time;

      const currentMap = animMapRef.current;
      const speedRatio = 1000 / Math.max(30, tickMs);
      const lerpFactor = 1 - Math.exp(-dt * Math.max(3.5, speedRatio * 2.2));

      const updatedList: typeof animPackets = [];

      for (const [id, p] of currentMap.entries()) {
        p.x += (p.targetX - p.x) * lerpFactor;
        p.y += (p.targetY - p.y) * lerpFactor;

        if (p.state === "delivered") {
          p.opacity = Math.max(0, p.opacity - dt * 2.0);
          p.scale = Math.min(1.8, p.scale + dt * 1.5);
          if (p.opacity <= 0.01) {
            currentMap.delete(id);
            continue;
          }
        } else if (p.state === "dropped") {
          p.opacity = Math.max(0, p.opacity - dt * 2.0);
          p.scale = Math.max(0.3, p.scale - dt * 1.2);
          if (p.opacity <= 0.01) {
            currentMap.delete(id);
            continue;
          }
        } else {
          p.opacity = Math.min(1, p.opacity + dt * 6.0);
          p.scale = 1.0;
        }

        updatedList.push({ ...p });
      }

      setAnimPackets(updatedList);
      animId = requestAnimationFrame(frame);
    };

    animId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animId);
  }, [tickMs]);

  return (
    <div className="border border-border bg-card">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border bg-muted/20 px-3.5 py-2">
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="text-primary font-bold">&gt;</span>
          <h2 className="uppercase tracking-widest text-primary font-bold">
            TOPOLOGY
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted-foreground">
          <span>NODES:</span>
          <span className="text-foreground font-bold tabular-nums">{snapshot.nodes.length}</span>
          <span>| LINKS:</span>
          <span className="text-foreground font-bold tabular-nums">{snapshot.links.length}</span>
          <span>| IN FLIGHT:</span>
          <span className="text-secondary font-bold tabular-nums">
            {snapshot.packets.filter((p) => p.state === "travelling" || p.state === "queued").length}
          </span>
          {!isRunning ? (
            <span className="ml-2 border border-primary bg-primary/15 px-1.5 py-0.5 text-primary">[EDIT READY]</span>
          ) : (
            <span className="ml-2 border border-border px-1.5 py-0.5">[PAUSE TO EDIT]</span>
          )}
        </div>
      </header>

      {/* Inline topology tools (paused only) */}
      {!isRunning && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-3.5 py-2 font-mono text-[10px]">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setMode("interact")}
              className={`border px-2.5 py-1 uppercase transition-colors cursor-pointer ${
                mode === "interact"
                  ? "border-primary bg-primary text-primary-foreground font-bold"
                  : "border-border text-muted-foreground hover:border-primary hover:text-primary"
              }`}
            >
              [ ✎ EDIT ]
            </button>
            <button
              onClick={() => setMode("add-node")}
              className={`border px-2.5 py-1 uppercase transition-colors cursor-pointer ${
                mode === "add-node"
                  ? "border-primary bg-primary text-primary-foreground font-bold"
                  : "border-border text-muted-foreground hover:border-primary hover:text-primary"
              }`}
            >
              [ + NODE ]
            </button>
            <button
              onClick={() => setMode("connect")}
              className={`border px-2.5 py-1 uppercase transition-colors cursor-pointer ${
                mode === "connect"
                  ? "border-primary bg-primary text-primary-foreground font-bold"
                  : "border-border text-muted-foreground hover:border-primary hover:text-primary"
              }`}
            >
              [ ⇄ CONNECT ]
            </button>
          </div>

          {mode === "add-node" && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">TYPE:</span>
              {(["client", "router", "server"] as NodeKind[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setNodeKind(k)}
                  className={`border px-2 py-1 uppercase transition-colors cursor-pointer ${
                    nodeKind === k
                      ? "border-primary bg-primary text-primary-foreground font-bold"
                      : "border-border text-muted-foreground hover:border-primary hover:text-primary"
                  }`}
                >
                  [{k}]
                </button>
              ))}
            </div>
          )}

          {mode === "connect" && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">FROM:</span>
              <select
                value={connectFrom ?? ""}
                onChange={(e) => {
                  const next = e.target.value === "" ? null : Number(e.target.value);
                  setConnectFrom(next);
                  if (next !== null && connectTo === next) setConnectTo(null);
                }}
                className="border border-border bg-background px-2 py-1 text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              >
                <option value="">-</option>
                {nodeIds.map((id) => (
                  <option key={`from-${id}`} value={id}>N{id}</option>
                ))}
              </select>
              <span className="text-muted-foreground">TO:</span>
              <select
                value={connectTo ?? ""}
                onChange={(e) => setConnectTo(e.target.value === "" ? null : Number(e.target.value))}
                className="border border-border bg-background px-2 py-1 text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              >
                <option value="">-</option>
                {nodeIds
                  .filter((id) => id !== connectFrom)
                  .map((id) => (
                    <option key={`to-${id}`} value={id}>N{id}</option>
                  ))}
              </select>
              <button
                disabled={connectFrom === null || connectTo === null}
                onClick={() => {
                  if (connectFrom === null || connectTo === null) return;
                  setPendingLink({ from: connectFrom, to: connectTo });
                }}
                className="border border-primary bg-primary px-2.5 py-1 text-primary-foreground font-bold disabled:opacity-30 disabled:pointer-events-none"
              >
                [ CONFIG ]
              </button>
            </div>
          )}

          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => setCamera((prev) => clampView({ ...prev, w: prev.w * 1.15, h: prev.h * 1.15 }))}
              className="border border-border px-2 py-1 uppercase text-muted-foreground hover:border-primary hover:text-primary"
            >
              [ - ]
            </button>
            <button
              onClick={resetView}
              className="border border-border px-2 py-1 uppercase text-muted-foreground hover:border-primary hover:text-primary"
            >
              [ FIT ]
            </button>
            <button
              onClick={() => setCamera((prev) => clampView({ ...prev, w: prev.w * 0.87, h: prev.h * 0.87 }))}
              className="border border-border px-2 py-1 uppercase text-muted-foreground hover:border-primary hover:text-primary"
            >
              [ + ]
            </button>
          </div>
        </div>
      )}

      {/* SVG Canvas with clean grid background */}
      <div className="relative overflow-hidden bg-background">
        <svg
          ref={svgRef}
          viewBox={`${camera.x} ${camera.y} ${camera.w} ${camera.h}`}
          className={`h-auto w-full select-none ${!isRunning && mode === "add-node" ? "cursor-crosshair" : "cursor-default"}`}
          role="img"
          aria-label="Network topology diagram"
          onWheel={(e) => {
            if (isRunning) return;
            e.preventDefault();
            const factor = e.deltaY > 0 ? 1.12 : 0.9;
            zoomAt(e.clientX, e.clientY, factor);
          }}
          onPointerDown={(e) => {
            if (isRunning || mode === "add-node") return;
            const target = e.target as Element;
            if (target.tagName === "svg" || target.id === "radar-grid-bg") {
              setPanning({
                startClient: { x: e.clientX, y: e.clientY },
                startCamera: camera,
              });
            }
          }}
          onPointerMove={(e) => {
            if (isRunning) return;
            if (movingNode) {
              const p = toWorld(e);
              const movedDistance = Math.hypot(p.x - movingNode.down.x, p.y - movingNode.down.y);
              onSetNodePosition(movingNode.id, p);
              if (!movingNode.moved && movedDistance > 2) {
                setMovingNode((prev) => (prev ? { ...prev, moved: true } : prev));
              }
              return;
            }
            if (panning) {
              const svg = svgRef.current;
              if (!svg) return;
              const r = svg.getBoundingClientRect();
              const dxPx = e.clientX - panning.startClient.x;
              const dyPx = e.clientY - panning.startClient.y;
              const dx = (dxPx / r.width) * panning.startCamera.w;
              const dy = (dyPx / r.height) * panning.startCamera.h;
              setCamera(clampView({
                ...panning.startCamera,
                x: panning.startCamera.x - dx,
                y: panning.startCamera.y - dy,
              }));
            }
          }}
          onPointerUp={() => {
            setPanning(null);
            setMovingNode(null);
          }}
          onClick={(e) => {
            if (isRunning || mode !== "add-node") return;
            if ((e.target as Element).tagName !== "svg" && (e.target as Element).id !== "radar-grid-bg") return;
            setPendingNode({ at: toWorld(e) });
          }}
        >
          <defs>
            {/* Fine grid pattern */}
            <pattern id="topo-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path
                d="M 40 0 L 0 0 0 40"
                fill="none"
                stroke="var(--color-border)"
                strokeWidth="0.8"
                strokeOpacity="0.4"
              />
              <circle cx="0" cy="0" r="1" fill="var(--color-primary)" fillOpacity="0.3" />
            </pattern>

            {/* Major grid block */}
            <pattern id="topo-major" width="160" height="160" patternUnits="userSpaceOnUse">
              <rect width="160" height="160" fill="url(#topo-grid)" />
              <path
                d="M 160 0 L 0 0 0 160"
                fill="none"
                stroke="var(--color-border)"
                strokeWidth="1.2"
                strokeOpacity="0.3"
              />
            </pattern>

            {/* Arrowhead marker */}
            <marker
              id="term-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,1 L9,5 L0,9 L3,5 z" fill="var(--color-primary)" />
            </marker>

            <marker
              id="term-arrow-inactive"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,1 L9,5 L0,9 L3,5 z" fill="var(--color-destructive)" />
            </marker>
          </defs>

          {/* Grid Background */}
          <rect id="radar-grid-bg" width={VIEW_W} height={VIEW_H} fill="url(#topo-major)" />

          {/* Frame markers */}
          <text x={8} y={16} fill="var(--color-muted-foreground)" opacity={0.6} fontSize={9} className="font-mono">
            SYS_TOPOLOGY // V2
          </text>
          <text x={VIEW_W - 8} y={16} textAnchor="end" fill="var(--color-muted-foreground)" opacity={0.6} fontSize={9} className="font-mono">
            {!isRunning ? "[CONFIG_MODE]" : "[STREAMING]"}
          </text>

          {/* Topology Links */}
          {snapshot.links.map((l) => {
            const a = positionOf(l.from);
            const b = positionOf(l.to);
            const seg = trimSegment(a, b);
            const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const busy = l.current_packets > 0;
            const strokeColor = l.active
              ? (busy ? "var(--color-primary)" : "var(--color-border)")
              : "var(--color-destructive)";

            return (
              <g key={`${l.from}-${l.to}`}>
                {/* Visual link line */}
                <line
                  x1={seg.x1}
                  y1={seg.y1}
                  x2={seg.x2}
                  y2={seg.y2}
                  stroke={strokeColor}
                  strokeWidth={busy ? 2.5 : 1.5}
                  strokeDasharray={l.active ? undefined : "5 5"}
                  strokeOpacity={l.active ? (busy ? 1 : 0.6) : 0.4}
                  markerEnd={l.active ? "url(#term-arrow)" : "url(#term-arrow-inactive)"}
                />

                {/* Click target for toggling active in edit mode */}
                <line
                  x1={seg.x1}
                  y1={seg.y1}
                  x2={seg.x2}
                  y2={seg.y2}
                  stroke="transparent"
                  strokeWidth={20}
                  className={!isRunning && mode === "interact" ? "cursor-pointer" : ""}
                  onClick={(e) => {
                    if (isRunning || mode !== "interact") return;
                    e.stopPropagation();
                    onToggleLink(l.from, l.to, !l.active);
                  }}
                />

                {/* Link Telemetry Badge */}
                <g transform={`translate(${m.x}, ${m.y})`} pointerEvents="none">
                  <rect
                    x={-54}
                    y={-9}
                    width={108}
                    height={18}
                    fill="var(--color-card)"
                    stroke={l.active ? (busy ? "var(--color-primary)" : "var(--color-border)") : "var(--color-destructive)"}
                    strokeWidth={1}
                  />
                  <text
                    y={3}
                    textAnchor="middle"
                    fill={l.active ? (busy ? "var(--color-primary)" : "var(--color-muted-foreground)") : "var(--color-destructive)"}
                    className="font-mono text-[9px] font-bold"
                  >
                    {l.active
                      ? `LAT:${l.latency} CAP:${l.capacity} Q:${l.queue_len}`
                      : "[ SEVERED ]"}
                  </text>
                </g>
              </g>
            );
          })}

          {/* Topology Nodes */}
          {snapshot.nodes.map((n) => {
            const p = positionOf(n.id);
            const color = NODE_KIND_COLORS[n.node_type];
            const isDragging = movingNode?.id === n.id;

            return (
              <g
                key={n.id}
                className={!isRunning && mode !== "add-node" ? "cursor-pointer" : "cursor-default"}
                onPointerDown={(e) => {
                  if (isRunning || mode !== "interact") return;
                  e.stopPropagation();
                  setMovingNode({
                    id: n.id,
                    down: toWorld(e),
                    moved: false,
                  });
                }}
                onPointerUp={(e) => {
                  if (isRunning || mode !== "interact") return;
                  e.stopPropagation();
                  if (movingNode?.id === n.id && !movingNode.moved && n.node_type === "client") {
                    setDest(nodeIds.find((id) => id !== n.id) ?? null);
                    setPendingPacket({ from: n.id });
                  }
                  setMovingNode(null);
                }}
              >
                {/* Node Reticle outer crosshair ticks */}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={NODE_R + 6}
                  fill="none"
                  stroke={color}
                  strokeWidth={0.8}
                  strokeDasharray="4 8"
                  strokeOpacity={0.4}
                />

                {/* Node Body */}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={NODE_R}
                  fill="var(--color-card)"
                  stroke={isDragging ? "#ffffff" : color}
                  strokeWidth={isDragging ? 2.5 : 2}
                />

                {/* Corner reticle brackets */}
                <rect
                  x={p.x - NODE_R + 4}
                  y={p.y - NODE_R + 4}
                  width={(NODE_R - 4) * 2}
                  height={(NODE_R - 4) * 2}
                  fill="none"
                  stroke={color}
                  strokeWidth={0.6}
                  strokeOpacity={0.5}
                />

                {/* Node ID label */}
                <text
                  x={p.x}
                  y={p.y + 4}
                  textAnchor="middle"
                  fill={color}
                  className="font-mono text-xs font-bold"
                  pointerEvents="none"
                >
                  N{n.id}
                </text>

                {/* Node Kind Tag Below */}
                <g transform={`translate(${p.x}, ${p.y + NODE_R + 12})`} pointerEvents="none">
                  <rect
                    x={-34}
                    y={-8}
                    width={68}
                    height={16}
                    fill="var(--color-card)"
                    stroke={color}
                    strokeWidth={1}
                  />
                  <text
                    y={3.5}
                    textAnchor="middle"
                    fill={color}
                    className="font-mono text-[9px] font-bold tracking-wider"
                  >
                    {NODE_KIND_LABEL[n.node_type]}
                  </text>
                </g>
              </g>
            );
          })}

          {/* Smooth Sub-Tick Interpolated Packets (60fps continuous) */}
          {animPackets.map((pk) => {
            return (
              <g
                key={pk.id}
                transform={`translate(${pk.x}, ${pk.y}) scale(${pk.scale})`}
                opacity={pk.opacity}
                pointerEvents="none"
              >
                {/* Glow ring */}
                <circle r={11} fill="none" stroke={pk.color} strokeWidth={1.2} strokeOpacity={0.6} />

                {/* Ripple ring for delivered state */}
                {pk.state === "delivered" && (
                  <circle r={18} fill="none" stroke={pk.color} strokeWidth={1} strokeOpacity={0.4} className="animate-ping" />
                )}

                {/* Packet Core Diamond */}
                <rect
                  x={-5}
                  y={-5}
                  width={10}
                  height={10}
                  fill={pk.color}
                  transform="rotate(45)"
                />

                {/* Queued badge */}
                {pk.state === "queued" && (
                  <g transform="translate(0, -18)">
                    <rect x={-18} y={-7} width={36} height={14} fill="var(--color-card)" stroke="var(--color-secondary)" strokeWidth={1} />
                    <text y={3} textAnchor="middle" fill="var(--color-secondary)" className="font-mono text-[8px] font-bold">
                      QUEUED
                    </text>
                  </g>
                )}

                {/* Packet ID badge */}
                <text
                  y={-14}
                  x={12}
                  fill="var(--color-foreground)"
                  className="font-mono text-[9px] font-bold"
                >
                  #{pk.id}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Footer prompt */}
      <div className="border-t border-border bg-muted/20 px-3.5 py-2 font-mono text-[11px] text-muted-foreground flex items-center justify-between">
        <div>
          <span className="text-primary font-bold">&gt; </span>
          {!isRunning ? (
            mode === "add-node" ? (
              <span className="text-primary font-bold">[Click canvas: add node] · [Mouse wheel: zoom]</span>
            ) : mode === "connect" ? (
              <span className="text-primary font-bold">[Select FROM/TO above, then configure link] · [Drag background: pan]</span>
            ) : (
              <span className="text-primary font-bold">[Drag node: move] · [Drag background: pan] · [Mouse wheel: zoom] · [Click client: spawn packet]</span>
            )
          ) : (
            <span>
              Running: topology editing is locked · Tick delay: {tickMs}ms ({Math.round(1000 / tickMs)} T/S)
            </span>
          )}
        </div>
      </div>

      {/* Dialog: Add Node */}
      <Dialog open={pendingNode !== null} onOpenChange={(o) => !o && setPendingNode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ADD NODE</DialogTitle>
            <DialogDescription>
              Select node type at coordinates ({pendingNode?.at.x}, {pendingNode?.at.y}).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground block">
              NODE TYPE:
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["client", "router", "server"] as NodeKind[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setNodeKind(k)}
                  className={`border px-3 py-2 font-mono text-xs uppercase font-bold transition-colors cursor-pointer ${
                    nodeKind === k
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-foreground hover:border-primary hover:text-primary"
                  }`}
                >
                  [{k}]
                </button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <button
              onClick={() => setPendingNode(null)}
              className="border border-border bg-card px-3.5 py-1.5 font-mono text-xs uppercase text-muted-foreground hover:bg-muted cursor-pointer"
            >
              [ CANCEL ]
            </button>
            <button
              onClick={() => {
                if (pendingNode) onAddNode(nodeKind, pendingNode.at);
                setPendingNode(null);
              }}
              className="border border-primary bg-primary px-3.5 py-1.5 font-mono text-xs uppercase font-bold text-primary-foreground hover:opacity-90 cursor-pointer"
            >
              [ ADD NODE ]
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Add Link */}
      <Dialog open={pendingLink !== null} onOpenChange={(o) => !o && setPendingLink(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              CONNECT LINK [N{pendingLink?.from} &gt;&gt; N{pendingLink?.to}]
            </DialogTitle>
            <DialogDescription>
              Set propagation latency, capacity, and queue buffer limit.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-3 py-2">
            {(
              [
                ["LATENCY (TICKS)", latency, setLatency, 1],
                ["CAPACITY (PKTS)", capacity, setCapacity, 1],
                ["QUEUE LIMIT", queueSize, setQueueSize, 0],
              ] as const
            ).map(([label, value, set, min]) => (
              <label key={label} className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground block">
                {label}
                <input
                  type="number"
                  min={min}
                  value={value}
                  onChange={(e) => set(Math.max(min, Number(e.target.value)))}
                  className="mt-1.5 w-full border border-border bg-background px-2 py-1.5 font-mono text-sm text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                />
              </label>
            ))}
          </div>
          <DialogFooter>
            <button
              onClick={() => setPendingLink(null)}
              className="border border-border bg-card px-3.5 py-1.5 font-mono text-xs uppercase text-muted-foreground hover:bg-muted cursor-pointer"
            >
              [ CANCEL ]
            </button>
            <button
              onClick={() => {
                if (pendingLink)
                  onAddLink(pendingLink.from, pendingLink.to, latency, capacity, queueSize);
                setPendingLink(null);
              }}
              className="border border-primary bg-primary px-3.5 py-1.5 font-mono text-xs uppercase font-bold text-primary-foreground hover:opacity-90 cursor-pointer"
            >
              [ ADD LINK ]
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Spawn Packet */}
      <Dialog open={pendingPacket !== null} onOpenChange={(o) => !o && setPendingPacket(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>SPAWN PACKET [FROM: N{pendingPacket?.from}]</DialogTitle>
            <DialogDescription>
              Select destination node.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground block mb-2">
              DESTINATION:
            </label>
            <div className="flex flex-wrap gap-2">
              {nodeIds
                .filter((id) => id !== pendingPacket?.from)
                .map((id) => (
                  <button
                    key={id}
                    onClick={() => setDest(id)}
                    className={`border px-3 py-1.5 font-mono text-xs font-bold uppercase transition-colors cursor-pointer ${
                      dest === id
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-foreground hover:border-primary hover:text-primary"
                    }`}
                  >
                    [ NODE {id} ]
                  </button>
                ))}
            </div>
          </div>
          <DialogFooter>
            <button
              onClick={() => setPendingPacket(null)}
              className="border border-border bg-card px-3.5 py-1.5 font-mono text-xs uppercase text-muted-foreground hover:bg-muted cursor-pointer"
            >
              [ CANCEL ]
            </button>
            <button
              disabled={dest === null}
              onClick={() => {
                if (pendingPacket && dest !== null) onSpawnPacket(pendingPacket.from, dest);
                setPendingPacket(null);
              }}
              className="border border-primary bg-primary px-3.5 py-1.5 font-mono text-xs uppercase font-bold text-primary-foreground hover:opacity-90 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
            >
              [ SPAWN PACKET ]
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
