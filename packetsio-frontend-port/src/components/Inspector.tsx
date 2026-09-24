import type { ReactNode } from "react";
import type { SnapLink } from "../sim/types.ts";
import { linkKey } from "../sim/types.ts";
import { NODE_COLOR, packetColor } from "../render/palette.ts";
import { ClientIcon, CloseIcon, CutIcon, LinkIcon, PacketIcon, RouterIcon, ServerIcon, ZapIcon } from "./Icons.tsx";
import { useSim } from "./useSim.ts";

const KIND_ICON = { client: ClientIcon, router: RouterIcon, server: ServerIcon };

const STATE_LABEL: Record<string, string> = {
  ready: "At node",
  travelling: "On the wire",
  queued: "Queued",
  delivered: "Delivered",
  dropped: "Dropped",
};
const REASON: Record<string, string> = {
  queue_full: "Tail drop: the outgoing queue was full",
  ttl_expired: "TTL reached zero (routing loop?)",
  no_route: "No route to the destination",
  link_down: "The link went down while it was on it",
};
const PROTO: Record<string, string> = {
  udp: "UDP data",
  icmp_echo_request: "ICMP echo request",
  icmp_echo_reply: "ICMP echo reply",
  arp_request: "ARP request",
  arp_reply: "ARP reply",
  ospf_lsa: "OSPF LSA",
};

function Row({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="kv">
      <span>{k}</span>
      <span className={mono ? "mono" : undefined}>{v}</span>
    </div>
  );
}

function Meter({ value, max, tone }: { value: number; max: number; tone?: "warn" | "bad" }) {
  const f = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <span className="meter" data-tone={f >= 1 ? "bad" : f > 0.5 ? "warn" : tone}>
      <span style={{ width: `${f * 100}%` }} />
    </span>
  );
}

function Header({ icon, color, title, sub }: { icon: ReactNode; color: string; title: string; sub: string }) {
  const C = useSim();
  return (
    <div className="insp-head">
      <span className="insp-icon" style={{ color, borderColor: color }}>
        {icon}
      </span>
      <div className="insp-title">
        <div>{title}</div>
        <div className="insp-sub">{sub}</div>
      </div>
      <button className="icon-btn sm" onClick={() => C.select(null)} aria-label="Close inspector">
        <CloseIcon />
      </button>
    </div>
  );
}

function Direction({ l }: { l: SnapLink }) {
  const C = useSim();
  return (
    <div className="dir">
      <div className="dir-title">
        {C.name(l.from)} <span className="arrow">→</span> {C.name(l.to)}
        {!l.active && <span className="tag bad">down</span>}
      </div>
      <div className="dir-grid">
        <span>queue</span>
        <Meter value={l.queue_len} max={l.max_queue_size} />
        <span className="mono">
          {l.queue_len}/{l.max_queue_size}
        </span>
        <span>in transit</span>
        <Meter value={l.current_packets} max={l.capacity} />
        <span className="mono">
          {l.current_packets}/{l.capacity}
        </span>
      </div>
      <div className="dir-stats mono">
        <span>fwd {l.forwarded}</span>
        <span className={l.dropped ? "bad" : ""}>drop {l.dropped}</span>
        <span>loss {(l.packet_loss_rate * 100).toFixed(0)}%</span>
        <span>wait {l.queue_delay.toFixed(1)}t</span>
      </div>
    </div>
  );
}

export function Inspector() {
  const C = useSim();
  const sel = C.selection;

  if (!sel) {
    return (
      <section className="panel inspector">
        <div className="panel-head">
          <h2>{C.scenario.name}</h2>
          <span className="label-sm">{C.scenario.tagline}</span>
        </div>
        <p className="insp-desc">{C.scenario.description}</p>
        <div className="tip">
          <span className="tip-lbl">Try this</span>
          {C.scenario.tip}
        </div>
        <div className="empty">
          <div className="empty-art" aria-hidden>
            <span />
            <span />
            <span />
          </div>
          Click a node, link or packet to inspect it. Drag nodes to rearrange; scroll to zoom.
        </div>
      </section>
    );
  }

  if (sel.kind === "node") {
    const n = C.snap.nodes.find((x) => x.id === sel.id);
    if (!n) return null;
    const Icon = KIND_ICON[n.node_type];
    const out = C.snap.links.filter((l) => l.from === n.id);
    const servers = C.snap.nodes.filter((x) => x.node_type === "server");
    return (
      <section className="panel inspector">
        <Header icon={<Icon />} color={NODE_COLOR[n.node_type]} title={C.name(n.id)} sub={`${n.node_type} · node ${n.id}`} />
        <div className="kv-block">
          <Row k="IP / mask" v={`${n.ip} /24`} mono />
          <Row k="MAC" v={n.mac} mono />
          <Row k="forwarded · received · dropped" v={`${n.forwarded} · ${n.received} · ${n.dropped}`} mono />
        </div>
        {n.node_type === "client" && servers.length > 0 && (
          <div className="insp-actions">
            <button className="btn" onClick={() => C.burst(10)}>
              <ZapIcon /> Burst 10
            </button>
            <button className="btn" onClick={() => C.ping(n.id, servers[0].id)}>
              ping {C.name(servers[0].id)}
            </button>
          </div>
        )}
        <h3>Routing table <span className="label-sm">{C.snap.routing.toUpperCase()}</span></h3>
        <div className="rt">
          <div className="rt-row rt-headrow">
            <span>destination</span>
            <span>next hop</span>
            <span>cost</span>
          </div>
          {n.routes.length === 0 && <div className="rt-empty">No routes yet. RIP learns them one round at a time.</div>}
          {n.routes.map((r) => (
            <div className="rt-row" key={r.destination}>
              <span>{C.name(r.destination)}</span>
              <span className="mono">→ {C.name(r.next_hop)}</span>
              <span className="mono">{r.cost}</span>
            </div>
          ))}
        </div>
        <h3>Outgoing queues</h3>
        <div className="queues">
          {out.map((l) => (
            <button
              className="q-row"
              key={l.to}
              onClick={() => C.select({ kind: "link", a: Math.min(l.from, l.to), b: Math.max(l.from, l.to) })}
            >
              <span>→ {C.name(l.to)}</span>
              <Meter value={l.queue_len} max={l.max_queue_size} />
              <span className="mono">
                {l.active ? `${l.queue_len}/${l.max_queue_size}` : "down"}
              </span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  if (sel.kind === "link") {
    const f = C.links.get(linkKey(sel.a, sel.b));
    const r = C.links.get(linkKey(sel.b, sel.a));
    const up = C.pairActive(sel.a, sel.b);
    const any = f ?? r;
    if (!any) return null;
    return (
      <section className="panel inspector">
        <Header
          icon={<LinkIcon />}
          color={up ? "#38bdf8" : "#fb7185"}
          title={`${C.name(sel.a)} ⇄ ${C.name(sel.b)}`}
          sub={`latency ${any.latency} ticks · ${any.bandwidth} pkt/tick · ${any.capacity} in flight`}
        />
        <div className="insp-actions">
          <button className={up ? "btn danger" : "btn ok"} onClick={() => C.setPairActive(sel.a, sel.b, !up)}>
            {up ? (
              <>
                <CutIcon /> Cut link
              </>
            ) : (
              <>
                <LinkIcon /> Restore link
              </>
            )}
          </button>
        </div>
        {f && <Direction l={f} />}
        {r && <Direction l={r} />}
        <p className="insp-note">
          Latency is propagation delay. Bandwidth limits how many packets may enter per tick, capacity how many can be
          on the wire at once; anything beyond waits in the FIFO queue, and a full queue tail-drops.
        </p>
      </section>
    );
  }

  const p = C.packets.get(sel.id) ?? C.packetCache.get(sel.id);
  if (!p) return null;
  const live = p.state !== "delivered" && p.state !== "dropped";
  const onLink = p.state === "travelling" || p.state === "queued";
  const future = live ? C.predictedPath(p).slice(onLink ? 0 : 1) : [];
  const color = packetColor(p);
  return (
    <section className="panel inspector">
      <Header icon={<PacketIcon />} color={color} title={`Packet #${p.id}`} sub={PROTO[p.protocol] ?? p.protocol} />
      <div className={`state-chip s-${p.state}`}>
        <span className="pill-dot" />
        {STATE_LABEL[p.state]}
        {p.state === "travelling" && p.to_node != null && (
          <span className="mono">
            {" "}
            {C.name(p.from_node)} → {C.name(p.to_node)} · {p.elapsed + 1}/{p.latency}
          </span>
        )}
        {p.state === "queued" && p.to_node != null && (
          <span className="mono"> #{(p.queue_pos ?? 0) + 1} for {C.name(p.to_node)}</span>
        )}
      </div>
      {p.drop_reason && <div className="drop-reason">{REASON[p.drop_reason]}</div>}
      <h3>Route</h3>
      <div className="route">
        {p.path.map((id, i) => (
          <span key={`p${i}`} className="hop done" style={{ borderColor: color }}>
            {C.name(id)}
          </span>
        ))}
        {future.map((id, i) => (
          <span key={`f${i}`} className="hop next">
            {C.name(id)}
          </span>
        ))}
      </div>
      <div className="kv-block" style={{ marginTop: 14 }}>
        <Row k="source" v={`${C.name(p.source)} · ${p.src_ip}`} mono />
        <Row k="destination" v={`${C.name(p.destination)} · ${p.dst_ip}`} mono />
        <Row k="age" v={`${p.age} ticks`} mono />
        <Row k="time queued" v={`${p.queued_ticks} ticks`} mono />
        <Row k="TTL" v={p.ttl} mono />
        {p.flow != null && <Row k="flow" v={`#${p.flow}`} mono />}
      </div>
      <p className="insp-note">
        Solid hops are where the packet has been. Dashed hops are the path the routers' current tables will send it —
        that can still change.
      </p>
    </section>
  );
}
