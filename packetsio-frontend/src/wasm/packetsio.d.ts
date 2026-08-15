/* tslint:disable */
/* eslint-disable */

export class Simulation {
    free(): void;
    [Symbol.dispose](): void;
    average_latency(): number;
    current_tick(): number;
    delivered(): number;
    delivery_rate(): number;
    dropped(): number;
    is_finished(): boolean;
    max_queue_size(): number;
    constructor();
    step(): void;
    throughput(): number;
    total_packets(): number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_simulation_free: (a: number, b: number) => void;
    readonly simulation_average_latency: (a: number) => number;
    readonly simulation_current_tick: (a: number) => number;
    readonly simulation_delivered: (a: number) => number;
    readonly simulation_delivery_rate: (a: number) => number;
    readonly simulation_dropped: (a: number) => number;
    readonly simulation_is_finished: (a: number) => number;
    readonly simulation_max_queue_size: (a: number) => number;
    readonly simulation_new_default: () => number;
    readonly simulation_step: (a: number) => void;
    readonly simulation_throughput: (a: number) => number;
    readonly simulation_total_packets: (a: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
