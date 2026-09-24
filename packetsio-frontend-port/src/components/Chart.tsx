import { useEffect, useRef } from "react";
import { controller as C, type History } from "../sim/controller.ts";
import { withAlpha } from "../render/palette.ts";

const POINTS = 90;

/** Scrolling area chart; redraws every frame so it glides between ticks. */
export function Chart({ series, color, minMax = 1 }: { series: keyof History; color: string; minMax?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = ref.current!;
    const ctx = el.getContext("2d")!;
    let raf = 0;
    let yMax = minMax;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (el.width !== Math.round(w * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const data = C.history[series].slice(-POINTS - 1);
      const target = Math.max(minMax, ...data) * 1.25;
      yMax += (target - yMax) * 0.08;

      // gridlines
      ctx.strokeStyle = "rgba(148,163,184,0.08)";
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = Math.round((h * i) / 4) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      if (data.length < 2) return;

      const step = w / (POINTS - 1);
      const a = C.playing ? C.alpha(now) : 1;
      const shift = (1 - a) * step;
      const n = data.length;
      const xs = (i: number) => w - (n - 1 - i) * step + shift;
      const ys = (v: number) => h - 3 - (v / yMax) * (h - 8);

      ctx.beginPath();
      ctx.moveTo(xs(0), ys(data[0]));
      for (let i = 1; i < n; i++) {
        const x0 = xs(i - 1);
        const x1 = xs(i);
        const cx = (x0 + x1) / 2;
        ctx.bezierCurveTo(cx, ys(data[i - 1]), cx, ys(data[i]), x1, ys(data[i]));
      }
      ctx.save();
      ctx.lineTo(xs(n - 1), h);
      ctx.lineTo(xs(0), h);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, withAlpha(color, 0.32));
      g.addColorStop(1, withAlpha(color, 0));
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();

      ctx.beginPath();
      ctx.moveTo(xs(0), ys(data[0]));
      for (let i = 1; i < n; i++) {
        const x0 = xs(i - 1);
        const x1 = xs(i);
        const cx = (x0 + x1) / 2;
        ctx.bezierCurveTo(cx, ys(data[i - 1]), cx, ys(data[i]), x1, ys(data[i]));
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.stroke();

      const lx = Math.min(w - 4, xs(n - 1));
      const ly = ys(data[n - 1]);
      ctx.beginPath();
      ctx.arc(lx, ly, 6, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(color, 0.18);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(lx, ly, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [series, color, minMax]);

  return <canvas ref={ref} className="chart" />;
}
