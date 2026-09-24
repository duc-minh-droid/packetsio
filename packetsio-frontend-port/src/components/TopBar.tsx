import { useEffect, useRef, useState } from "react";
import { SCENARIOS } from "../sim/scenarios.ts";
import type { RoutingMode } from "../sim/types.ts";
import { ChevronIcon, HelpIcon, Logo } from "./Icons.tsx";
import { useSim } from "./useSim.ts";

const MODES: Array<{ id: RoutingMode; label: string; hint: string }> = [
  { id: "ospf", label: "OSPF", hint: "Link-state, shortest latency" },
  { id: "adaptive", label: "Adaptive", hint: "Link-state + queue drain cost" },
  { id: "rip", label: "RIP", hint: "Distance vector, hop count" },
];

function ScenarioPicker() {
  const C = useSim();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, []);
  return (
    <div className="picker" ref={ref}>
      <button className="picker-btn" onClick={() => setOpen((o) => !o)} data-open={open}>
        <span className="picker-kicker">Scenario</span>
        <span className="picker-name">{C.scenario.name}</span>
        <ChevronIcon className="picker-chev" />
      </button>
      <div className="picker-pop" data-open={open}>
        {SCENARIOS.map((s, i) => (
          <button
            key={s.id}
            className="scenario-card"
            data-active={s.id === C.scenario.id}
            onClick={() => {
              C.load(s.id);
              setOpen(false);
            }}
          >
            <span className="scenario-key">{i + 1}</span>
            <span className="scenario-text">
              <span className="scenario-name">{s.name}</span>
              <span className="scenario-tag">{s.tagline}</span>
            </span>
            <span className="scenario-meta">
              {s.nodes.length} nodes · {s.routing.toUpperCase()}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function RoutingSwitch() {
  const C = useSim();
  const idx = Math.max(0, MODES.findIndex((m) => m.id === C.snap.routing));
  return (
    <div className="seg" role="radiogroup" aria-label="Routing protocol">
      <span className="seg-thumb" style={{ transform: `translateX(${idx * 100}%)` }} />
      {MODES.map((m) => (
        <button
          key={m.id}
          role="radio"
          aria-checked={m.id === C.snap.routing}
          className="seg-btn"
          data-active={m.id === C.snap.routing}
          title={m.hint}
          onClick={() => C.setRouting(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

export function TopBar({ onHelp }: { onHelp: () => void }) {
  const C = useSim();
  return (
    <header className="topbar">
      <div className="brand">
        <Logo />
        <div>
          <div className="brand-name">packetsio</div>
          <div className="brand-sub">tick-based network simulator</div>
        </div>
      </div>
      <ScenarioPicker />
      <div className="topbar-group">
        <span className="label-sm">Routing</span>
        <RoutingSwitch />
      </div>
      <div className="topbar-right">
        <span className="engine-badge" title="The simulation runs in the Rust engine compiled to WebAssembly">
          <span className="dot" data-ok={C.ready} />
          Rust · WASM engine
        </span>
        <button className="icon-btn" onClick={onHelp} aria-label="Help">
          <HelpIcon />
        </button>
      </div>
    </header>
  );
}
