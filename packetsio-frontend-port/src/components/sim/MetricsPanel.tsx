import type { Metrics } from "@/sim/types.ts";

interface Props {
  metrics: Metrics;
}

function makeAsciiBar(percent: number, length = 10): string {
  const p = Math.max(0, Math.min(1, percent));
  const filled = Math.round(p * length);
  const empty = length - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
}

function StatRow({
  code,
  label,
  value,
  subvalue,
  bar,
  status,
}: {
  code: string;
  label: string;
  value: string;
  subvalue?: string;
  bar?: string;
  status?: "ok" | "warn" | "err" | "info";
}) {
  const statusColor =
    status === "err"
      ? "text-destructive glow-red"
      : status === "warn"
        ? "text-secondary glow-amber"
        : status === "info"
          ? "text-chart-4 glow-cyan"
          : "text-primary glow-green";

  return (
    <div className="flex flex-col justify-between border-b border-border p-3 transition-colors hover:bg-muted/40 sm:border-r sm:[&:nth-child(2n)]:border-r-0 last:border-b-0">
      <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
        <span className="tracking-wider">
          <span className="text-primary/60">&gt; </span>
          {code}
        </span>
        <span className="uppercase tracking-widest">{label}</span>
      </div>

      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        <div className={`font-mono text-lg font-bold tabular-nums tracking-tight ${statusColor}`}>
          {value}
        </div>
        {bar && <div className="font-mono text-xs text-primary/80 tabular-nums">{bar}</div>}
      </div>

      {subvalue && (
        <div className="mt-1 font-mono text-[10px] text-muted-foreground tracking-wide">
          {subvalue}
        </div>
      )}
    </div>
  );
}

export function MetricsPanel({ metrics }: Props) {
  const inFlight = Math.max(0, metrics.totalPackets - metrics.delivered - metrics.dropped);

  return (
    <div className="border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border bg-muted/20 px-3.5 py-2">
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="text-primary font-bold">&gt;</span>
          <h2 className="uppercase tracking-widest text-primary font-bold">
            LIVE METRICS
          </h2>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px]">
          <span
            className={`border px-1.5 py-0.5 font-bold ${
              metrics.finished
                ? "border-primary bg-primary/15 text-primary glow-green"
                : inFlight > 0
                  ? "border-secondary bg-secondary/15 text-secondary glow-amber animate-pulse"
                  : "border-border text-muted-foreground"
            }`}
          >
            {metrics.finished ? "[RESOLVED]" : inFlight > 0 ? "[IN FLIGHT]" : "[IDLE]"}
          </span>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2">
        <StatRow
          code="SYS.TICK"
          label="TICK COUNT"
          value={`#${String(metrics.tick).padStart(5, "0")}`}
          subvalue={`In-flight: ${inFlight} packet(s)`}
          status="info"
        />

        <StatRow
          code="NET.DELV"
          label="DELIVERY RATE"
          value={`${(metrics.deliveryRate * 100).toFixed(1)}%`}
          bar={makeAsciiBar(metrics.deliveryRate, 8)}
          subvalue={`${metrics.delivered} of ${metrics.totalPackets} delivered`}
          status={metrics.deliveryRate >= 0.9 ? "ok" : metrics.deliveryRate > 0.5 ? "warn" : "info"}
        />

        <StatRow
          code="NET.DROP"
          label="PACKETS LOST"
          value={String(metrics.dropped)}
          subvalue={metrics.dropped > 0 ? `Loss: ${((metrics.dropped / (metrics.totalPackets || 1)) * 100).toFixed(1)}%` : "0 packet loss"}
          status={metrics.dropped > 0 ? "err" : "ok"}
        />

        <StatRow
          code="NET.TPUT"
          label="THROUGHPUT"
          value={`${metrics.throughput.toFixed(3)}`}
          subvalue="pkts / tick"
          status="info"
        />

        <StatRow
          code="NET.LATENCY"
          label="AVG LATENCY"
          value={`${metrics.averageLatency.toFixed(2)}`}
          subvalue="ticks per packet"
          status="info"
        />

        <StatRow
          code="NET.Q_MAX"
          label="MAX QUEUE"
          value={String(metrics.maxQueueSize)}
          subvalue="buffer peak depth"
          status={metrics.maxQueueSize > 3 ? "warn" : "ok"}
        />
      </div>
    </div>
  );
}
