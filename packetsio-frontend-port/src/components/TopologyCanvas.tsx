import { useEffect, useRef } from "react";
import { controller as C } from "../sim/controller.ts";
import { Renderer, type Hit } from "../render/renderer.ts";

export function TopologyCanvas() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current!;
    const box = wrap.current!;
    const r = new Renderer(el, C);
    const ro = new ResizeObserver(() => r.resize(box.clientWidth, box.clientHeight));
    ro.observe(box);
    r.resize(box.clientWidth, box.clientHeight);

    type Drag =
      | { kind: "node"; id: number; start: { x: number; y: number }; moved: boolean; hit: Hit }
      | { kind: "pan"; sx: number; sy: number; ox: number; oy: number; moved: boolean; hit: Hit | null };
    let drag: Drag | null = null;

    const local = (e: PointerEvent | WheelEvent) => {
      const b = el.getBoundingClientRect();
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    };

    const down = (e: PointerEvent) => {
      const m = local(e);
      const hit = r.hitTest(m.x, m.y);
      el.setPointerCapture(e.pointerId);
      if (hit?.kind === "node") drag = { kind: "node", id: hit.id, start: m, moved: false, hit };
      else drag = { kind: "pan", sx: m.x, sy: m.y, ox: r.cam.ox, oy: r.cam.oy, moved: false, hit };
    };
    const move = (e: PointerEvent) => {
      const m = local(e);
      r.setMouse(m);
      if (!drag) {
        r.hover = r.hitTest(m.x, m.y);
        el.style.cursor = r.hover ? "pointer" : "grab";
        return;
      }
      if (drag.kind === "node") {
        if (Math.hypot(m.x - drag.start.x, m.y - drag.start.y) > 3) drag.moved = true;
        if (drag.moved) {
          C.moveNode(drag.id, r.toWorld(m.x, m.y));
          el.style.cursor = "grabbing";
        }
      } else {
        if (Math.hypot(m.x - drag.sx, m.y - drag.sy) > 3) drag.moved = true;
        if (drag.moved) {
          r.cam.ox = drag.ox + (m.x - drag.sx);
          r.cam.oy = drag.oy + (m.y - drag.sy);
          el.style.cursor = "grabbing";
        }
      }
    };
    const up = () => {
      if (drag && !drag.moved) {
        const h = drag.hit;
        if (!h) C.select(null);
        else if (h.kind === "node") C.select({ kind: "node", id: h.id });
        else if (h.kind === "packet") C.select({ kind: "packet", id: h.id });
        else C.select({ kind: "link", a: h.a, b: h.b });
      }
      drag = null;
      el.style.cursor = r.hover ? "pointer" : "grab";
    };
    const leave = () => {
      r.hover = null;
      r.setMouse(null);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const m = local(e);
      r.zoomAt(m.x, m.y, Math.exp(-e.deltaY * 0.0015));
    };
    const dbl = () => r.fit();

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("dblclick", dbl);
    (window as unknown as { __renderer: Renderer }).__renderer = r;
    return () => {
      ro.disconnect();
      r.destroy();
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointerleave", leave);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("dblclick", dbl);
    };
  }, []);

  return (
    <div ref={wrap} className="stage">
      <canvas ref={canvas} className="stage-canvas" />
    </div>
  );
}
