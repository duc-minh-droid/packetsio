# packetsio web UI

Vite + React 19 + TypeScript front end for the packetsio engine. See the [main README](../README.md).

```bash
npm ci
npm run dev      # http://localhost:5173
npm run build    # -> dist/ (static, deploy anywhere)
```

- `src/sim/engine.ts` loads `src/wasm/packetsio_bg.wasm` (built by `../scripts/build-wasm.sh`). There is no
  JavaScript fallback engine: if the wasm fails to load the UI shows an error.
- `src/sim/controller.ts` owns the playback clock and calls `step()` / `snapshot()`.
- `src/render/renderer.ts` draws the topology on a canvas every animation frame.
- `src/sim/scenarios.ts` holds the preset topologies and traffic flows.
