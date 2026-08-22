# packetsio-frontend

A tick-by-tick visualizer for a Rust → WebAssembly network packet simulation,
built with **Vite + React 19 + TypeScript + Tailwind CSS v4**.

Drop this folder's contents onto your existing `packetsio-frontend` repo root
(overwrite `index.html`, `src/main.ts`, `tsconfig.json`, `package.json`, and
`../.gitignore`), then:

```bash
npm install
npm run dev
```

The dev server runs on **http://localhost:5173** (Vite default).

## What it does

- **Topology diagram** (SVG): renders the 4-node demo network (`Client → Router → Server`, with a second `Router` and a standby link). Click **edit topology** to add nodes, drag between nodes to add links, click a link to toggle it active/inactive, and click a client to spawn a packet.
- **Real packet animation**: after every `step()` the engine returns a `snapshot()` of every packet's `progress` (0.0 → 1.0) along its current link; each packet is interpolated along the link and tweened between ticks for smooth motion even at slow tick rates. `queued` packets sit at the from-node; `delivered`/`dropped` packets fade out.
- **Playback controls**: Step, Play/Pause, Reset (rebuilds the demo topology via `load_default_topology()`), and a speed slider (1–20 tick/s).
- **Live metrics dashboard**: tick, delivered, dropped, total packets, delivery rate, average latency, throughput, max queue size — refreshed after every step.
- **Event log**: scrollable, real per-tick packet-state transitions (SENT → TRAVELLING → QUEUED → DELIVERED / DROPPED) detected by diffing consecutive snapshots.

## Engine

The WASM engine (`src/wasm/packetsio.js` + `packetsio_bg.wasm`, produced by
`wasm-pack --target web`) exposes a `Simulation` class whose API includes
`add_node`, `add_link`, `set_link_active`, `spawn_packet`, `load_default_topology`,
`step`, `is_finished`, `snapshot()`, and the metrics getters. If the WASM module
fails to load, the app transparently falls back to a TypeScript stand-in engine so
the UI is always interactive. The header badge shows `engine: wasm` or
`engine: stand-in`.

To rebuild the engine from your Rust sources:

```bash
wasm-pack build --target web   # in the packetsio (Rust) repo
# copy the generated pkg/ files here as src/wasm/packetsio.* + packetsio_bg.*
```

## Layout

```
src/
  main.tsx                     React entry point (mounts <App/> into #app)
  App.tsx                      Console layout: header, controls, diagram, metrics, log
  style.css                    Tailwind v4 import + dark network-ops theme tokens
  sim/
    types.ts                   SimEngine / SimSnapshot / Metrics / LogEntry types
    topology.ts                Fixed 4-node demo + SVG coordinate math
    createSimulation.ts        WASM loader with TS fallback engine
  hooks/
    useSimulation.ts           playback loop, snapshot diffing, topology mutations, log
  components/
    ui/dialog.tsx              dependency-free modal (matches shadcn Dialog subset)
    sim/
      TopologyDiagram.tsx      SVG node/link graph + edit mode + packet animation
      PlaybackControls.tsx      Step / Play / Reset / speed
      MetricsPanel.tsx         live metrics grid
      EventLog.tsx              scrollable tick event log
  wasm/
    packetsio.js               wasm-pack --target web output
    packetsio_bg.wasm
    packetsio.d.ts
    packetsio_bg.wasm.d.ts
```

## Notes

- Node x/y positions are frontend-only state (the engine is coordinate-free).
- The code is structured so richer per-tick data (per-link queue depth, packet
  paths) can be dropped in by extending `SimSnapshot` and `useSimulation`'s
  diffing — no UI rewrite needed.
