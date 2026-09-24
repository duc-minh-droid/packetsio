/* tslint:disable */
/* eslint-disable */

export class Simulation {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Convenience: the same link in both directions.
     */
    add_duplex_link(a: number, b: number, latency: number, bandwidth: number, capacity: number, max_queue_size: number): void;
    /**
     * Register a traffic generator. `stop` = 0 means it never stops.
     */
    add_flow(src: number, dst: number, interval: number, burst: number, start: number, stop: number): number;
    /**
     * Add (or reconfigure) a directed link.
     */
    add_link(from: number, to: number, latency: number, bandwidth: number, capacity: number, max_queue_size: number): void;
    add_node(id: number, kind: string): void;
    average_latency(): number;
    clear_flows(): void;
    current_tick(): number;
    delivered(): number;
    delivery_rate(): number;
    dropped(): number;
    is_finished(): boolean;
    /**
     * 0: client, 1: router, 2: server, 3: router. Two paths from client to
     * server: 0-1-2 (latency 5) and 0-3-2 (latency 3, starts disabled).
     */
    load_default_topology(): void;
    max_queue_size(): number;
    constructor();
    ping(from: number, target_ip: string): boolean;
    /**
     * Apply pending topology changes to routing tables now instead of at the
     * start of the next tick (so the UI can show routes before playing).
     */
    refresh_routes(): void;
    remove_flow(id: number): boolean;
    remove_link(from: number, to: number): boolean;
    routing_protocol(): string;
    /**
     * Run up to `n` ticks, stopping early if the simulation finishes.
     */
    run(n: number): number;
    /**
     * Bring a link up or down. Taking a link down drops what is on the wire
     * and sends queued packets back to the node to be rerouted.
     */
    set_link_active(from: number, to: number, active: boolean): boolean;
    /**
     * "rip", "ospf" or "adaptive". Routing tables are rebuilt from scratch.
     */
    set_routing_protocol(name: string): void;
    snapshot(): string;
    /**
     * Spawn `count` one-way packets at once. Returns the first id.
     */
    spawn_burst(from: number, to: number, count: number): number;
    spawn_packet(from: number, to: number): number;
    step(): void;
    throughput(): number;
    total_packets(): number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_simulation_free: (a: number, b: number) => void;
    readonly simulation_add_duplex_link: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly simulation_add_flow: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly simulation_add_link: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly simulation_add_node: (a: number, b: number, c: number, d: number) => void;
    readonly simulation_average_latency: (a: number) => number;
    readonly simulation_clear_flows: (a: number) => void;
    readonly simulation_current_tick: (a: number) => number;
    readonly simulation_delivered: (a: number) => number;
    readonly simulation_delivery_rate: (a: number) => number;
    readonly simulation_dropped: (a: number) => number;
    readonly simulation_is_finished: (a: number) => number;
    readonly simulation_load_default_topology: (a: number) => void;
    readonly simulation_max_queue_size: (a: number) => number;
    readonly simulation_new: () => number;
    readonly simulation_ping: (a: number, b: number, c: number, d: number) => number;
    readonly simulation_refresh_routes: (a: number) => void;
    readonly simulation_remove_flow: (a: number, b: number) => number;
    readonly simulation_remove_link: (a: number, b: number, c: number) => number;
    readonly simulation_routing_protocol: (a: number) => [number, number];
    readonly simulation_run: (a: number, b: number) => number;
    readonly simulation_set_link_active: (a: number, b: number, c: number, d: number) => number;
    readonly simulation_set_routing_protocol: (a: number, b: number, c: number) => void;
    readonly simulation_snapshot: (a: number) => [number, number];
    readonly simulation_spawn_burst: (a: number, b: number, c: number, d: number) => number;
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
