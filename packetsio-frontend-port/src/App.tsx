import { useEffect, useState } from "react";
import { controller as C } from "./sim/controller.ts";
import { SCENARIOS } from "./sim/scenarios.ts";
import type { Renderer } from "./render/renderer.ts";
import { TopBar } from "./components/TopBar.tsx";
import { TopologyCanvas } from "./components/TopologyCanvas.tsx";
import { ControlDock } from "./components/ControlDock.tsx";
import { MetricsPanel } from "./components/MetricsPanel.tsx";
import { Inspector } from "./components/Inspector.tsx";
import { EventFeed, Legend } from "./components/EventFeed.tsx";
import { Onboarding } from "./components/Onboarding.tsx";
import { PlayIcon } from "./components/Icons.tsx";
import { useSim } from "./components/useSim.ts";

const SEEN_KEY = "packetsio:onboarded";

function seenBefore() {
  try {
    return localStorage.getItem(SEEN_KEY) === "1" || new URLSearchParams(location.search).has("skipintro");
  } catch {
    return false;
  }
}

const fit = () => (window as unknown as { __renderer?: Renderer }).__renderer?.fit();

export default function App() {
  const sim = useSim();
  const [intro, setIntro] = useState(() => !seenBefore());

  useEffect(() => {
    C.init().then(() => {
      if (!seenBefore()) C.play(); // animate behind the welcome card
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
      if (e.key === " ") {
        e.preventDefault();
        C.toggle();
      } else if (e.key === "ArrowRight") C.manualStep();
      else if (e.key === "r" || e.key === "R") C.reset();
      else if (e.key === "b" || e.key === "B") C.burst(10);
      else if (e.key === "x" || e.key === "X") C.chaos();
      else if (e.key === "f" || e.key === "F") fit();
      else if (e.key === "Escape") {
        if (intro) close();
        else C.select(null);
      } else if (/^[1-9]$/.test(e.key) && SCENARIOS[+e.key - 1]) C.load(SCENARIOS[+e.key - 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const close = () => {
    setIntro(false);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* storage may be unavailable */
    }
  };

  const idle = sim.ready && !sim.playing && sim.snap.tick === 0;

  return (
    <div className="app">
      <TopBar onHelp={() => setIntro(true)} />
      <main className="main">
        <div className="stage-wrap">
          <TopologyCanvas />
          <EventFeed />
          <Legend />
          <div className="hint" data-show={idle && !intro}>
            <button className="hint-btn" onClick={() => C.play()}>
              <PlayIcon width={12} height={12} /> Press <kbd>Space</kbd> to start traffic
            </button>
          </div>
          {sim.error && <div className="error">Could not load the WebAssembly engine: {sim.error}</div>}
          <ControlDock onFit={fit} />
        </div>
        <aside className="side">
          <MetricsPanel />
          <Inspector />
        </aside>
      </main>
      <Onboarding open={intro} onClose={close} />
    </div>
  );
}
