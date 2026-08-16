/* tslint:disable */
/* eslint-disable */

export class Simulation {
    free(): void;
    [Symbol.dispose](): void;
    add_link(from: number, to: number, latency: number, capacity: number, max_queue_size: number): void;
    add_node(id: number, kind: string): void;
    average_latency(): number;
    current_tick(): number;
    delivered(): number;
    delivery_rate(): number;
    dropped(): number;
    is_finished(): boolean;
    /**
     * Wipes the current topology and loads the original 4-node demo
     * network. Handy for a "Reset to demo" button.
     */
    load_default_topology(): void;
    max_queue_size(): number;
    /**
     * Starts with an empty topology. Build it up with add_node /
     * add_link / spawn_packet, or call load_default_topology() for
     * the demo network.
     */
    constructor();
    /**
     * Returns true if a matching link was found and toggled.
     */
    set_link_active(from: number, to: number, active: boolean): boolean;
    snapshot(): string;
    /**
     * Adds a new packet travelling from -> to. Returns its unique id.
     */
    spawn_packet(from: number, to: number): number;
    step(): void;
    throughput(): number;
    total_packets(): number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_simulation_free: (a: number, b: number) => void;
    readonly simulation_add_link: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly simulation_add_node: (a: number, b: number, c: number, d: number) => void;
    readonly simulation_average_latency: (a: number) => number;
    readonly simulation_current_tick: (a: number) => number;
    readonly simulation_delivered: (a: number) => number;
    readonly simulation_delivery_rate: (a: number) => number;
    readonly simulation_dropped: (a: number) => number;
    readonly simulation_is_finished: (a: number) => number;
    readonly simulation_load_default_topology: (a: number) => void;
    readonly simulation_max_queue_size: (a: number) => number;
    readonly simulation_new: () => number;
    readonly simulation_set_link_active: (a: number, b: number, c: number, d: number) => number;
    readonly simulation_snapshot: (a: number) => [number, number];
    readonly simulation_spawn_packet: (a: number, b: number, c: number) => number;
    readonly simulation_step: (a: number) => void;
    readonly simulation_throughput: (a: number) => number;
    readonly simulation_total_packets: (a: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
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
