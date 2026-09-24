import type { History } from "../sim/controller.ts";
import { Chart } from "./Chart.tsx";
import { useSim } from "./useSim.ts";

const CARDS: Array<{ key: keyof History; label: string; unit: string; color: string; digits: number; min: number }> = [
  { key: "throughput", label: "Throughput", unit: "pkt/tick", color: "#38bdf8", digits: 2, min: 1 },
  { key: "latency", label: "Latency", unit: "ticks", color: "#a78bfa", digits: 1, min: 4 },
  { key: "dropRate", label: "Drop rate", unit: "%", color: "#fb7185", digits: 0, min: 10 },
  { key: "queue", label: "Queued", unit: "pkts", color: "#fbbf24", digits: 0, min: 4 },
];

export function MetricsPanel() {
  const C = useSim();
  const m = C.snap.metrics;
  const finished = m.delivered + m.dropped;
  const rate = finished ? (m.delivered / finished) * 100 : 0;
  return (
    <section className="panel metrics">
      <div className="panel-head">
        <h2>Live metrics</h2>
        <span className="pill" data-live={C.playing}>
          <span className="pill-dot" />
          {C.playing ? "running" : C.snap.finished ? "finished" : "paused"}
        </span>
      </div>
      <div className="totals">
        <div>
          <span className="t-num">{m.total_packets}</span>
          <span className="t-lbl">sent</span>
        </div>
        <div>
          <span className="t-num ok">{m.delivered}</span>
          <span className="t-lbl">delivered</span>
        </div>
        <div>
          <span className="t-num bad">{m.dropped}</span>
          <span className="t-lbl">dropped</span>
        </div>
        <div>
          <span className="t-num">{C.snap.stats.live}</span>
          <span className="t-lbl">in network</span>
        </div>
      </div>
      <div className="delivery">
        <div className="delivery-bar">
          <span style={{ width: `${rate}%` }} />
        </div>
        <span className="delivery-lbl">{finished ? `${rate.toFixed(1)}% delivered` : "no packets finished yet"}</span>
      </div>
      <div className="cards">
        {CARDS.map((c) => {
          const h = C.history[c.key];
          const v = h.length ? h[h.length - 1] : 0;
          return (
            <div className="card" key={c.key} style={{ ["--accent" as string]: c.color }}>
              <div className="card-head">
                <span className="card-lbl">{c.label}</span>
                <span className="card-val">
                  {v.toFixed(c.digits)}
                  <small>{c.unit}</small>
                </span>
              </div>
              <Chart series={c.key} color={c.color} minMax={c.min} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
