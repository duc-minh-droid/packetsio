interface Props {
  ready: boolean;
  finished: boolean;
  playing: boolean;
  speed: number;
  onStep: () => void;
  onTogglePlay: () => void;
  onReset: () => void;
  onSpeedChange: (v: number) => void;
}

export function PlaybackControls({
  ready,
  finished,
  playing,
  speed,
  onStep,
  onTogglePlay,
  onReset,
  onSpeedChange,
}: Props) {
  const disabled = !ready || finished;
  const speedPresets = [0.5, 1, 2, 4, 8, 16];
  const delayMs = Math.round(1000 / Math.max(0.1, speed));

  return (
    <div className="border border-border bg-card p-3">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between border-b border-border pb-2 text-[11px]">
        <div className="flex items-center gap-2 font-mono text-muted-foreground">
          <span className="text-primary font-bold">&gt;</span>
          <span className="uppercase tracking-widest text-primary font-bold">
            PLAYBACK CONTROLS
          </span>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px]">
          <span className="text-muted-foreground">STATUS:</span>
          {finished ? (
            <span className="bg-destructive/15 border border-destructive px-1.5 py-0.5 text-destructive font-bold glow-red">
              [FINISHED]
            </span>
          ) : playing ? (
            <span className="bg-primary/15 border border-primary px-1.5 py-0.5 text-primary font-bold glow-green animate-pulse">
              [RUNNING]
            </span>
          ) : ready ? (
            <span className="bg-secondary/15 border border-secondary px-1.5 py-0.5 text-secondary font-bold glow-amber">
              [PAUSED]
            </span>
          ) : (
            <span className="border border-muted-foreground px-1.5 py-0.5 text-muted-foreground">
              [READY]
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* PLAY / PAUSE */}
          <button
            onClick={onTogglePlay}
            disabled={disabled}
            className={`border px-3.5 py-1.5 font-mono text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer ${
              playing
                ? "border-secondary bg-secondary text-secondary-foreground hover:opacity-90"
                : "border-primary bg-primary text-primary-foreground hover:opacity-90"
            }`}
          >
            {playing ? "[ ⏸ PAUSE ]" : "[ ▶ PLAY ]"}
          </button>

          {/* STEP */}
          <button
            onClick={onStep}
            disabled={disabled || playing}
            className="border border-primary bg-card px-3.5 py-1.5 font-mono text-xs font-bold uppercase tracking-wider text-primary transition-all hover:bg-primary hover:text-primary-foreground disabled:border-border disabled:text-muted-foreground/40 disabled:pointer-events-none cursor-pointer"
          >
            [ ⏭ STEP ]
          </button>

          {/* RESET */}
          <button
            onClick={onReset}
            className="border border-border bg-card px-3.5 py-1.5 font-mono text-xs font-bold uppercase tracking-wider text-muted-foreground transition-all hover:border-destructive hover:bg-destructive hover:text-destructive-foreground cursor-pointer"
          >
            [ ↺ RESET ]
          </button>
        </div>

        {/* Speed / Delay Control Slider */}
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-2 sm:border-t-0 sm:pt-0">
          <div className="flex flex-col gap-0.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <span>SPEED:</span>
              <span className="text-primary font-bold tabular-nums glow-green min-w-[5ch]">
                {speed < 1 ? speed.toFixed(1) : Math.round(speed)} TICK/S
              </span>
            </div>
            <span className="text-[9px] text-muted-foreground/70">
              ({delayMs}ms delay)
            </span>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="speed"
              type="range"
              min={0.2}
              max={16}
              step={0.1}
              value={speed}
              onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
              className="w-32 sm:w-40 cursor-pointer accent-primary"
              aria-label="Simulation speed in ticks per second"
            />
          </div>

          {/* Preset buttons */}
          <div className="hidden items-center gap-1 md:flex">
            {speedPresets.map((p) => (
              <button
                key={p}
                onClick={() => onSpeedChange(p)}
                className={`border px-1.5 py-0.5 font-mono text-[10px] uppercase transition-colors cursor-pointer ${
                  Math.abs(speed - p) < 0.05
                    ? "border-primary bg-primary text-primary-foreground font-bold"
                    : "border-border text-muted-foreground hover:border-primary hover:text-primary"
                }`}
              >
                {p}x
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
