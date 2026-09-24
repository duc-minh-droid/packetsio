import { SCENARIOS } from "../sim/scenarios.ts";
import { ClientIcon, Logo, RouterIcon, ServerIcon } from "./Icons.tsx";
import { useSim } from "./useSim.ts";

export function Onboarding({ open, onClose }: { open: boolean; onClose: () => void }) {
  const C = useSim();
  const start = (id: string) => {
    C.load(id);
    C.play();
    onClose();
  };
  return (
    <div className="onboard" data-open={open} aria-hidden={!open}>
      <div className="onboard-card" role="dialog" aria-modal="true" aria-label="Welcome to packetsio">
        <div className="onboard-top">
          <Logo size={40} />
          <div>
            <h1>packetsio</h1>
            <p>A packet-level network simulator. Every tick is computed by a Rust engine running as WebAssembly in this tab.</p>
          </div>
        </div>
        <ul className="onboard-points">
          <li>
            <span className="op-icons">
              <ClientIcon /> <RouterIcon /> <ServerIcon />
            </span>
            <div>
              <b>Hosts, routers, servers.</b> Links have latency, bandwidth, an in-flight capacity and a FIFO queue.
            </div>
          </li>
          <li>
            <span className="op-dot q" />
            <div>
              <b>Congestion is visible.</b> Queues stack up beside the link, links shift from cyan to amber to red, and
              full queues drop packets in a red burst.
            </div>
          </li>
          <li>
            <span className="op-dot r" />
            <div>
              <b>Three routing protocols.</b> OSPF-style shortest path, a congestion-aware variant, and RIP distance
              vector that converges one round at a time.
            </div>
          </li>
        </ul>
        <div className="onboard-scen">
          {SCENARIOS.slice(0, 4).map((s) => (
            <button key={s.id} className="os-card" onClick={() => start(s.id)}>
              <span className="os-name">{s.name}</span>
              <span className="os-tag">{s.tagline}</span>
            </button>
          ))}
        </div>
        <div className="onboard-foot">
          <div className="keys">
            <kbd>Space</kbd> play/pause <kbd>→</kbd> step <kbd>B</kbd> burst <kbd>X</kbd> chaos <kbd>1-5</kbd> scenarios
          </div>
          <button className="btn primary" onClick={() => start(C.scenario.id)}>
            Start simulation
          </button>
        </div>
      </div>
    </div>
  );
}
