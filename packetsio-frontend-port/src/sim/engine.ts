import init, { Simulation } from "../wasm/packetsio.js";
import wasmUrl from "../wasm/packetsio_bg.wasm?url";

export { Simulation };

let ready: Promise<void> | null = null;

/** Instantiate the Rust engine once. There is deliberately no JS fallback. */
export function loadEngine(): Promise<void> {
  if (!ready) {
    ready = init({ module_or_path: wasmUrl }).then(() => undefined);
  }
  return ready;
}
