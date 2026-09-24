import { SPEEDS } from "../sim/controller.ts";
import { CutIcon, FitIcon, PauseIcon, PlayIcon, ResetIcon, StepIcon, ZapIcon } from "./Icons.tsx";
import { useSim } from "./useSim.ts";

export function ControlDock({ onFit }: { onFit: () => void }) {
  const C = useSim();
  const s = C.snap;
  return (
    <div className="dock">
      <div className="dock-tick">
        <span className="label-sm">Tick</span>
        <span className="dock-tick-num">{String(s.tick).padStart(4, "0")}</span>
      </div>
      <div className="dock-sep" />
      <button className="dock-btn" onClick={() => C.reset()} title="Reset scenario (R)">
        <ResetIcon />
      </button>
      <button className="dock-play" data-playing={C.playing} onClick={() => C.toggle()} title="Play / pause (Space)">
        <span className="dock-play-icon" data-show={!C.playing}>
          <PlayIcon width={18} height={18} />
        </span>
        <span className="dock-play-icon" data-show={C.playing}>
          <PauseIcon width={18} height={18} />
        </span>
      </button>
      <button className="dock-btn" onClick={() => C.manualStep()} title="Step one tick (→)">
        <StepIcon />
      </button>
      <div className="dock-sep" />
      <div className="speed" role="radiogroup" aria-label="Ticks per second">
        {SPEEDS.map((v, i) => (
          <button
            key={v}
            className="speed-btn"
            data-active={i === C.speedIndex}
            onClick={() => C.setSpeed(i)}
            role="radio"
            aria-checked={i === C.speedIndex}
          >
            {v}
          </button>
        ))}
        <span className="speed-unit">tick/s</span>
      </div>
      <div className="dock-sep" />
      <button className="dock-action" onClick={() => C.burst(10)} title="Send 10 packets at once (B)">
        <ZapIcon /> Burst
      </button>
      <button className="dock-action danger" onClick={() => C.chaos()} title="Cut the busiest backbone link (X)">
        <CutIcon /> Chaos
      </button>
      <button className="dock-btn" onClick={onFit} title="Fit view (F)">
        <FitIcon />
      </button>
    </div>
  );
}
