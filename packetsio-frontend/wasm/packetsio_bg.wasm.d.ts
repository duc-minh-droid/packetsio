/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export const __wbg_simulation_free: (a: number, b: number) => void;
export const simulation_add_link: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
export const simulation_add_node: (a: number, b: number, c: number, d: number) => void;
export const simulation_average_latency: (a: number) => number;
export const simulation_current_tick: (a: number) => number;
export const simulation_delivered: (a: number) => number;
export const simulation_delivery_rate: (a: number) => number;
export const simulation_dropped: (a: number) => number;
export const simulation_is_finished: (a: number) => number;
export const simulation_load_default_topology: (a: number) => void;
export const simulation_max_queue_size: (a: number) => number;
export const simulation_new: () => number;
export const simulation_set_link_active: (a: number, b: number, c: number, d: number) => number;
export const simulation_snapshot: (a: number) => [number, number];
export const simulation_spawn_packet: (a: number, b: number, c: number) => number;
export const simulation_step: (a: number) => void;
export const simulation_throughput: (a: number) => number;
export const simulation_total_packets: (a: number) => number;
export const __wbindgen_externrefs: WebAssembly.Table;
export const __wbindgen_malloc: (a: number, b: number) => number;
export const __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
export const __wbindgen_free: (a: number, b: number, c: number) => void;
export const __wbindgen_start: () => void;
