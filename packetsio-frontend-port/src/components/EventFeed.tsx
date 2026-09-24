import { useState } from "react";
import { useSim } from "./useSim.ts";

export function EventFeed() {
  const C = useSim();
  const [open, setOpen] = useState(true);
  const items = C.log.slice(open ? -4 : -1).reverse();
  return (
    <div className="feed" data-open={open}>
      <button className="feed-head" onClick={() => setOpen((o) => !o)}>
        <span className="label-sm">Event log</span>
        <span className="feed-toggle">{open ? "hide" : "show"}</span>
      </button>
      <ol className="feed-list">
        {items.map((e) => (
          <li key={e.id} className={`feed-item t-${e.tone}`}>
            <span className="feed-tick mono">t{String(e.tick).padStart(3, "0")}</span>
            <span className="feed-bar" />
            <span className="feed-text">{e.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Legend() {
  return (
    <div className="legend">
      <div className="legend-row">
        <span className="legend-grad" />
        <span>idle</span>
        <span className="legend-mid">busy</span>
        <span>saturated</span>
      </div>
      <div className="legend-row keys">
        <span>
          <i className="sw q" /> queued
        </span>
        <span>
          <i className="sw drop" /> drop
        </span>
        <span>
          <i className="sw rt" /> route change
        </span>
      </div>
    </div>
  );
}
