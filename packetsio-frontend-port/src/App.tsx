import { useEffect, useState } from "react";

import { EventLog } from "@/components/sim/EventLog.tsx";
import { MetricsPanel } from "@/components/sim/MetricsPanel.tsx";
import { PlaybackControls } from "@/components/sim/PlaybackControls.tsx";
import { TopologyDiagram } from "@/components/sim/TopologyDiagram.tsx";
import { useSimulation } from "@/hooks/useSimulation.ts";

export default function App() {
  const sim = useSimulation();
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [crtEnabled, setCrtEnabled] = useState(true);

  useEffect(() => {
    document.documentElement.classList.remove("dark", "light");
    document.documentElement.classList.add(theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  };

  return (
    <div className={theme}>
      <main className="relative min-h-screen bg-background text-foreground px-3 py-4 md:px-6 md:py-6 selection:bg-primary selection:text-primary-foreground">
        {/* CRT Scanline Overlay (Dark Mode only) */}
        {theme === "dark" && crtEnabled && (
          <div
            className="fixed inset-0 crt-overlay crt-vignette pointer-events-none z-50"
            aria-hidden="true"
          />
        )}

        <div className="mx-auto max-w-7xl space-y-3">
          {/* Header Bar */}
          <header className="border border-border bg-card p-3 sm:px-4 sm:py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="font-mono text-base sm:text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
                  <span className="text-primary font-bold">&gt;</span>
                  <span>packetsio</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    / network packet visualizer
                  </span>
                </h1>
              </div>

              {/* Action Toggles */}
              <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                <button
                  onClick={toggleTheme}
                  className="border border-border bg-card px-2.5 py-1.5 uppercase tracking-wider text-foreground hover:border-primary transition-colors cursor-pointer"
                  title="Toggle Light / Dark theme"
                >
                  {theme === "dark" ? "[ ☀️ LIGHT MODE ]" : "[ 🌙 DARK MODE ]"}
                </button>

                {theme === "dark" && (
                  <button
                    onClick={() => setCrtEnabled((v) => !v)}
                    className={`border px-2.5 py-1.5 uppercase tracking-wider transition-colors cursor-pointer ${
                      crtEnabled
                        ? "border-primary bg-primary/15 text-primary glow-green"
                        : "border-border text-muted-foreground hover:border-primary hover:text-primary"
                    }`}
                    title="Toggle CRT scanline overlay effect"
                  >
                    [ CRT: {crtEnabled ? "ON" : "OFF"} ]
                  </button>
                )}
              </div>
            </div>
          </header>

          {/* Playback Controls */}
          <PlaybackControls
            ready={sim.ready}
            finished={sim.metrics.finished}
            playing={sim.playing}
            speed={sim.speed}
            onStep={sim.step}
            onTogglePlay={() => sim.setPlaying((p) => !p)}
            onReset={sim.reset}
            onSpeedChange={sim.setSpeed}
          />

          {/* Central Panes: Topology + Metrics */}
          <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
            <TopologyDiagram
              snapshot={sim.snapshot}
              positionOf={sim.positionOf}
              tickMs={sim.tickMs}
              isRunning={sim.playing}
              onSetNodePosition={sim.setNodePosition}
              onAddNode={sim.addNode}
              onAddLink={sim.addLink}
              onToggleLink={sim.toggleLink}
              onSpawnPacket={sim.spawnPacket}
            />
            <MetricsPanel metrics={sim.metrics} />
          </div>

          {/* Bottom Pane: Event Log */}
          <div className="h-72">
            <EventLog log={sim.log} />
          </div>

          {/* Footer Bar */}
          <footer className="border border-border bg-card px-3.5 py-1.5 font-mono text-[10px] text-muted-foreground flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <span>packetsio · discrete-tick simulator</span>
              <span className="hidden sm:inline">Dijkstra shortest path</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 bg-primary animate-pulse" />
              <span className="text-primary font-bold uppercase">READY</span>
            </div>
          </footer>
        </div>
      </main>
    </div>
  );
}
