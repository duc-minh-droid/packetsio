import type { Simulation } from "./engine.ts";
import type { NodeKind, RoutingMode } from "./types.ts";

/**
 * Scenarios are just configuration: they call the engine's topology and
 * traffic-generator APIs. Positions are presentation-only (the engine has no
 * notion of coordinates).
 */

export interface ScenarioNode {
  id: number;
  kind: NodeKind;
  x: number;
  y: number;
  label: string;
}

/** [a, b, latency, bandwidth, capacity, queue] - added in both directions */
export type ScenarioLink = [number, number, number, number, number, number];

export interface ScenarioFlow {
  src: number;
  dst: number;
  interval: number;
  burst: number;
  start?: number;
  stop?: number;
}

export interface Scenario {
  id: string;
  name: string;
  tagline: string;
  description: string;
  routing: RoutingMode;
  nodes: ScenarioNode[];
  links: ScenarioLink[];
  flows: ScenarioFlow[];
  /** Links that start administratively down */
  down?: Array<[number, number]>;
  /** Use the engine's built-in `load_default_topology()` */
  builtin?: boolean;
  tip: string;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "twin",
    name: "Twin Paths",
    tagline: "Short & thin vs long & fat",
    description:
      "Two hosts stream to one server. The top path is quicker but narrow; the bottom one is slower with more bandwidth. Plain OSPF piles everything onto the short path.",
    routing: "ospf",
    nodes: [
      { id: 0, kind: "client", x: 90, y: 250, label: "Host A" },
      { id: 1, kind: "client", x: 90, y: 510, label: "Host B" },
      { id: 2, kind: "router", x: 330, y: 380, label: "Edge" },
      { id: 3, kind: "router", x: 600, y: 190, label: "R-Top" },
      { id: 4, kind: "router", x: 600, y: 570, label: "R-Low" },
      { id: 5, kind: "router", x: 870, y: 380, label: "Core" },
      { id: 6, kind: "server", x: 1110, y: 380, label: "Server" },
    ],
    links: [
      [0, 2, 1, 2, 4, 6],
      [1, 2, 1, 2, 4, 6],
      [2, 3, 2, 1, 2, 5],
      [3, 5, 2, 1, 2, 5],
      [2, 4, 3, 2, 6, 8],
      [4, 5, 3, 2, 6, 8],
      [5, 6, 1, 3, 6, 8],
    ],
    flows: [
      { src: 0, dst: 6, interval: 1, burst: 1 },
      { src: 1, dst: 6, interval: 2, burst: 1, start: 3 },
    ],
    tip: "Queues build on R-Top. Switch routing to Adaptive and watch traffic spill onto the lower path.",
  },
  {
    id: "bottleneck",
    name: "Last Mile",
    tagline: "Four hosts, one thin uplink",
    description:
      "An access router aggregates four hosts onto a single narrow uplink. Its queue fills, latency climbs, then the tail drops start.",
    routing: "ospf",
    nodes: [
      { id: 0, kind: "client", x: 90, y: 130, label: "Host 1" },
      { id: 1, kind: "client", x: 90, y: 300, label: "Host 2" },
      { id: 2, kind: "client", x: 90, y: 470, label: "Host 3" },
      { id: 3, kind: "client", x: 90, y: 640, label: "Host 4" },
      { id: 4, kind: "router", x: 380, y: 385, label: "Access" },
      { id: 5, kind: "router", x: 760, y: 385, label: "ISP Core" },
      { id: 6, kind: "server", x: 1100, y: 230, label: "CDN" },
      { id: 7, kind: "server", x: 1100, y: 540, label: "API" },
    ],
    links: [
      [0, 4, 1, 2, 4, 6],
      [1, 4, 1, 2, 4, 6],
      [2, 4, 1, 2, 4, 6],
      [3, 4, 1, 2, 4, 6],
      [4, 5, 3, 1, 3, 6],
      [5, 6, 1, 2, 4, 6],
      [5, 7, 1, 2, 4, 6],
    ],
    flows: [
      { src: 0, dst: 6, interval: 3, burst: 1 },
      { src: 1, dst: 7, interval: 4, burst: 1, start: 1 },
      { src: 2, dst: 6, interval: 3, burst: 1, start: 2 },
      { src: 3, dst: 7, interval: 10, burst: 4, start: 12 },
    ],
    tip: "Click the Access → ISP Core link to see its queue and loss rate. No routing mode can help here: there is only one way out.",
  },
  {
    id: "mesh",
    name: "Backbone Mesh",
    tagline: "Cross traffic and failover",
    description:
      "Seven routers in a partial mesh with traffic flowing both ways. Cut a busy link and the link-state protocol reroutes around it on the next tick.",
    routing: "ospf",
    nodes: [
      { id: 0, kind: "client", x: 80, y: 190, label: "Office" },
      { id: 1, kind: "client", x: 80, y: 570, label: "Campus" },
      { id: 2, kind: "router", x: 320, y: 170, label: "NYC" },
      { id: 3, kind: "router", x: 320, y: 590, label: "ATL" },
      { id: 4, kind: "router", x: 590, y: 90, label: "CHI" },
      { id: 5, kind: "router", x: 600, y: 380, label: "STL" },
      { id: 6, kind: "router", x: 590, y: 670, label: "DAL" },
      { id: 7, kind: "router", x: 870, y: 190, label: "DEN" },
      { id: 8, kind: "router", x: 870, y: 570, label: "PHX" },
      { id: 9, kind: "server", x: 1120, y: 190, label: "Cloud West" },
      { id: 10, kind: "server", x: 1120, y: 570, label: "Cloud South" },
    ],
    links: [
      [0, 2, 1, 3, 6, 8],
      [1, 3, 1, 3, 6, 8],
      [2, 4, 2, 2, 4, 6],
      [2, 5, 2, 2, 4, 6],
      [3, 5, 2, 2, 4, 6],
      [3, 6, 2, 2, 4, 6],
      [2, 3, 3, 1, 2, 4],
      [4, 7, 3, 2, 4, 6],
      [5, 7, 2, 1, 3, 5],
      [5, 8, 2, 1, 3, 5],
      [6, 8, 3, 2, 4, 6],
      [4, 5, 2, 1, 2, 4],
      [5, 6, 2, 1, 2, 4],
      [7, 9, 1, 3, 6, 8],
      [8, 10, 1, 3, 6, 8],
      [7, 8, 3, 1, 2, 4],
    ],
    flows: [
      { src: 0, dst: 9, interval: 2, burst: 1 },
      { src: 1, dst: 10, interval: 2, burst: 1, start: 1 },
      { src: 0, dst: 10, interval: 3, burst: 1, start: 2 },
      { src: 1, dst: 9, interval: 3, burst: 1, start: 3 },
      { src: 9, dst: 1, interval: 4, burst: 1, start: 5 },
    ],
    tip: "Click STL → DEN and hit “Cut link”. In-flight packets are lost, queued ones are rerouted.",
  },
  {
    id: "ring",
    name: "RIP Ring",
    tagline: "Distance-vector convergence",
    description:
      "Six routers in a ring running RIP. Routes spread one hop per update round, so early packets wait for the network to converge.",
    routing: "rip",
    nodes: [
      { id: 0, kind: "router", x: 600, y: 120, label: "RA" },
      { id: 1, kind: "router", x: 830, y: 250, label: "RB" },
      { id: 2, kind: "router", x: 830, y: 510, label: "RC" },
      { id: 3, kind: "router", x: 600, y: 640, label: "RD" },
      { id: 4, kind: "router", x: 370, y: 510, label: "RE" },
      { id: 5, kind: "router", x: 370, y: 250, label: "RF" },
      { id: 6, kind: "client", x: 130, y: 250, label: "Host West" },
      { id: 7, kind: "server", x: 1070, y: 510, label: "Server East" },
      { id: 8, kind: "client", x: 1070, y: 250, label: "Host East" },
      { id: 9, kind: "server", x: 130, y: 510, label: "Server West" },
    ],
    links: [
      [0, 1, 2, 2, 3, 5],
      [1, 2, 2, 2, 3, 5],
      [2, 3, 2, 2, 3, 5],
      [3, 4, 2, 2, 3, 5],
      [4, 5, 2, 2, 3, 5],
      [5, 0, 2, 2, 3, 5],
      [6, 5, 1, 2, 4, 6],
      [7, 2, 1, 2, 4, 6],
      [8, 1, 1, 2, 4, 6],
      [9, 4, 1, 2, 4, 6],
    ],
    flows: [
      { src: 6, dst: 7, interval: 2, burst: 1 },
      { src: 8, dst: 9, interval: 2, burst: 1, start: 1 },
    ],
    tip: "Watch the routing table of Host West fill in over the first few ticks. Cut a ring link and RIP takes several rounds to recover.",
  },
  {
    id: "ping",
    name: "Hello, Ping",
    tagline: "The engine's built-in demo",
    description:
      "The four-node network from load_default_topology(): one ICMP echo request goes out, the server answers with an echo reply.",
    routing: "ospf",
    builtin: true,
    nodes: [
      { id: 0, kind: "client", x: 200, y: 380, label: "Client" },
      { id: 1, kind: "router", x: 600, y: 180, label: "R1" },
      { id: 3, kind: "router", x: 600, y: 580, label: "R3" },
      { id: 2, kind: "server", x: 1000, y: 380, label: "Server" },
    ],
    links: [],
    flows: [],
    tip: "The lower path starts down. Select the Client → R3 link and bring it up, then press Burst.",
  },
];

export function buildScenario(sim: Simulation, s: Scenario) {
  sim.set_routing_protocol(s.routing);
  if (s.builtin) {
    sim.load_default_topology();
  } else {
    for (const n of s.nodes) sim.add_node(n.id, n.kind);
    for (const [a, b, lat, bw, cap, q] of s.links) sim.add_duplex_link(a, b, lat, bw, cap, q);
    for (const [a, b] of s.down ?? []) sim.set_link_active(a, b, false);
    for (const f of s.flows) sim.add_flow(f.src, f.dst, f.interval, f.burst, f.start ?? 0, f.stop ?? 0);
  }
  sim.refresh_routes();
}
