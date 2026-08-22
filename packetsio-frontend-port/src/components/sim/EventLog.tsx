import { useEffect, useRef, useState } from "react";

import type { LogEntry, LogKind } from "@/sim/types.ts";

const kindBadges: Record<LogKind, { label: string; style: string }> = {
  tick: { label: "[ CLK ]", style: "text-muted-foreground border-border" },
  sent: { label: "[ TX+ ]", style: "text-primary border-primary/50 glow-green" },
  queued: { label: "[ BUF ]", style: "text-secondary border-secondary/50 glow-amber" },
  delivered: { label: "[ RX✓ ]", style: "text-chart-4 border-chart-4/50 glow-cyan" },
  dropped: { label: "[ DROP]", style: "text-destructive border-destructive/70 glow-red" },
  topology: { label: "[ TOPO]", style: "text-secondary border-secondary/50" },
  system: { label: "[ SYS ]", style: "text-primary border-primary/30" },
};

export function EventLog({ log }: { log: LogEntry[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<"ALL" | "PKT" | "TOPO" | "SYS">("ALL");
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll) {
      endRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
    }
  }, [log.length, autoScroll]);

  const filteredLog = log.filter((e) => {
    if (filter === "ALL") return true;
    if (filter === "PKT") return ["sent", "queued", "delivered", "dropped"].includes(e.kind);
    if (filter === "TOPO") return e.kind === "topology";
    if (filter === "SYS") return e.kind === "system" || e.kind === "tick";
    return true;
  });

  return (
    <div className="flex h-full min-h-0 flex-col border border-border bg-card select-none">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between border-b border-border bg-muted/20 px-3.5 py-2 text-xs">
        <div className="flex items-center gap-2 font-mono">
          <span className="text-primary font-bold">&gt;</span>
          <span className="font-mono text-xs uppercase tracking-widest text-primary font-bold">
            EVENT LOG
          </span>
          <span className="text-[10px] text-muted-foreground">
            ({log.length} events)
          </span>
        </div>

        {/* Filter controls + copy */}
        <div className="flex items-center gap-1.5 font-mono text-[10px]">
          {(["ALL", "PKT", "TOPO", "SYS"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`border px-1.5 py-0.5 uppercase transition-colors cursor-pointer ${
                filter === f
                  ? "border-primary bg-primary text-primary-foreground font-bold"
                  : "border-border text-muted-foreground hover:border-primary hover:text-primary"
              }`}
            >
              {f}
            </button>
          ))}
          <button
            onClick={() => setAutoScroll((v) => !v)}
            className={`border px-1.5 py-0.5 uppercase transition-colors cursor-pointer ${
              autoScroll
                ? "border-primary bg-primary/15 text-primary font-bold"
                : "border-border text-muted-foreground/50"
            }`}
            title="Toggle autoscroll to bottom"
          >
            [SCROLL: {autoScroll ? "ON" : "OFF"}]
          </button>
          <button
            onClick={() => {
              const text = filteredLog
                .map((e) => `t+${String(e.tick).padStart(4, "0")}  [${e.kind.toUpperCase().padEnd(8)}]  ${e.message}`)
                .join("\n");
              navigator.clipboard.writeText(text).catch(() => {});
            }}
            className="border border-border px-1.5 py-0.5 uppercase text-muted-foreground hover:border-primary hover:text-primary transition-colors cursor-pointer"
            title="Copy visible log to clipboard"
          >
            [COPY]
          </button>
        </div>
      </header>

      {/* Log console output — explicitly selectable so users can copy text */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3 font-mono text-[11px] select-text">
        {filteredLog.length === 0 ? (
          <div className="py-6 text-center text-muted-foreground">
            &gt; NO EVENT SIGNALS RECORDED
          </div>
        ) : (
          <div className="space-y-1">
            {filteredLog.map((e) => {
              const badge = kindBadges[e.kind] ?? {
                label: `[${e.kind}]`,
                style: "text-muted-foreground border-border",
              };
              return (
                <div
                  key={e.id}
                  className="flex items-start gap-2.5 px-1.5 py-0.5 leading-relaxed hover:bg-muted/40 border-l border-transparent hover:border-primary transition-colors"
                >
                  <span className="w-14 shrink-0 tabular-nums text-muted-foreground">
                    t+{String(e.tick).padStart(4, "0")}
                  </span>
                  <span
                    className={`w-14 shrink-0 border px-1 py-0 text-center text-[9px] font-bold uppercase tracking-wider ${badge.style}`}
                  >
                    {badge.label}
                  </span>
                  <span className="flex-1 text-foreground/90 break-all">{e.message}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Stream bottom line */}
        <div className="mt-3 flex items-center gap-1.5 border-t border-border/50 pt-2 text-[11px] text-muted-foreground select-none">
          <span className="text-primary font-bold">&gt;</span>
          <span>live signal stream</span>
          <span className="inline-block h-3.5 w-2 bg-primary animate-terminal-blink align-middle ml-1" />
        </div>

        <div ref={endRef} />
      </div>
    </div>
  );
}
