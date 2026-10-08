"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { readableOn } from "@/lib/icons";
import { pointsLabel, type Category, type Node, type OpenNode, type Roadmap } from "@/lib/roadmap";
import { Icon } from "./Icon";

type View = { x: number; y: number; k: number }; // screen = world * k + (x, y)
type Pt = { x: number; y: number };
type Placed = { key: string; node: Node; cat: Category; x: number; y: number };
type State = "locked" | "open" | "pending" | "lit";

const MIN_K = 0.2;
const MAX_K = 2.2;
const DRAG_PX = 5; // below this a press is a click, above it a pan
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));
export const nodeKey = (n: Node, catId: number, j: number) => (n.locked ? `lock-${catId}-${j}` : `n${n.id}`);

// Radial skill tree: the hub is "you", each category is one branch, nodes in map (id) order outward.
// The schema has no node positions or prerequisites, so the layout is computed and every open node is claimable.
function layoutTree(map: Roadmap) {
  const K = Math.max(1, map.categories.length);
  const placed: Placed[] = [];
  const ends = new Map<number, Pt>();
  map.categories.forEach((cat, k) => {
    const a = -Math.PI / 2 + (k * 2 * Math.PI) / K;
    const [cx, cy, px, py] = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a)];
    const nodes = map.nodes.filter((n) => n.category_id === cat.id);
    nodes.forEach((node, j) => {
      const r = 200 + j * 92;
      const w = j === 0 ? 0 : (j % 2 ? 1 : -1) * 62; // two-lane zig-zag: keeps long branches compact and readable
      placed.push({ key: nodeKey(node, cat.id, j), node, cat, x: cx * r + px * w, y: cy * r + py * w });
    });
    const r = 200 + nodes.length * 92 + 40;
    ends.set(cat.id, { x: cx * r, y: cy * r });
  });
  return { placed, ends };
}

export function SkillTree({
  map,
  personal,
  hub,
  burst,
  glow,
  focusCat,
  selectedId,
  onSelect,
  onSubmit,
  fit = false,
}: {
  map: Roadmap;
  personal: boolean; // false = projector: the guild's map without anyone's progress
  hub: ReactNode;
  burst?: Set<string>; // node keys that just unlocked
  glow?: { ids: number[]; n: number } | null; // newly approved nodes: their lines draw on as neon, one by one
  focusCat?: { id: number; n: number } | null; // fly to a branch (n changes per request)
  selectedId?: number | null;
  onSelect?: (n: OpenNode) => void; // one tap: what to do
  onSubmit?: (n: OpenNode) => void; // double tap: straight to the submit sheet
  fit?: boolean; // start zoomed out to show the whole tree
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  // The view lives in a ref and is written straight to the DOM once per frame: panning and zooming never
  // re-render React, which is what keeps big trees smooth.
  const view = useRef<View | null>(null);
  const frame = useRef(0);
  const settle = useRef(0);
  const pointers = useRef(new Map<number, Pt>());
  const drag = useRef<{ start: Pt; last: Pt; panning: boolean } | null>(null);
  const pinch = useRef<{ d0: number; mid0: Pt; view0: View } | null>(null);
  const swallowClick = useRef(false);
  const lastTap = useRef<{ id: number; at: number } | null>(null);

  const { placed, ends } = useMemo(() => layoutTree(map), [map]);

  const stateOf = (n: Node): State => (n.locked ? "locked" : !personal || n.status === "dim" ? "open" : n.status);

  const paint = useCallback(() => {
    frame.current = 0;
    const [v, w, vp] = [view.current, world.current, viewport.current];
    if (!v || !w || !vp) return;
    w.style.transform = `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.k})`;
    w.style.visibility = "visible";
    vp.classList.toggle("far", v.k < 0.55);
  }, []);

  // "moving" promotes the world to its own GPU layer while it moves; dropping it afterwards re-renders crisp text
  const apply = useCallback(
    (v: View, now = false) => {
      view.current = v;
      world.current?.classList.add("moving");
      window.clearTimeout(settle.current);
      settle.current = window.setTimeout(() => world.current?.classList.remove("moving", "flying"), 700);
      if (now) paint();
      else frame.current ||= requestAnimationFrame(paint);
    },
    [paint],
  );
  useEffect(() => () => {
    cancelAnimationFrame(frame.current);
    window.clearTimeout(settle.current);
  }, []);

  const glide = () => world.current?.classList.add("flying"); // the next apply eases instead of jumping

  const flyTo = useCallback(
    (p: Pt, k: number) => {
      const r = viewport.current?.getBoundingClientRect();
      if (!r) return;
      world.current?.classList.add("flying");
      apply({ k, x: r.width / 2 - p.x * k, y: r.height / 2 - p.y * k }, true);
    },
    [apply],
  );

  const home = useCallback(
    (animate: boolean) => {
      const r = viewport.current?.getBoundingClientRect();
      if (!r) return;
      let k = Math.min(1, Math.max(0.5, Math.min(r.width, r.height) / 720));
      let c: Pt = { x: 0, y: 0 };
      if (fit) {
        // fit the whole map's bounding box (branches differ in length, so it is not centred on the hub)
        const pts = [...placed, ...ends.values()];
        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.y);
        const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        k = clampK(Math.min(r.width / (x1 - x0 + 240), r.height / (y1 - y0 + 160)));
        c = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
      }
      if (animate) flyTo(c, k);
      else apply({ k, x: r.width / 2 - c.x * k, y: r.height / 2 - c.y * k }, true);
    },
    [placed, ends, fit, flyTo, apply],
  );

  // first paint centred on the hub (layout effect: no flash at 0,0). Only once: the 5 s poll hands in a new
  // map each time and must not yank the view back while someone is exploring.
  useLayoutEffect(() => {
    if (!view.current) home(false);
  }, [home]);

  useEffect(() => {
    if (!focusCat) return;
    const branch = placed.filter((p) => p.cat.id === focusCat.id);
    if (!branch.length) return;
    const mid = branch[Math.min(branch.length - 1, 2)]; // the near end: what a fuksi is most likely working on
    flyTo(mid, 0.95);
  }, [focusCat, placed, flyTo]);

  const zoomAt = useCallback(
    (p: Pt, factor: number) => {
      const v = view.current;
      if (!v) return;
      const k = clampK(v.k * factor);
      apply({ k, x: p.x - ((p.x - v.x) * k) / v.k, y: p.y - ((p.y - v.y) * k) / v.k });
    },
    [apply],
  );

  // wheel needs a non-passive listener to stop the page scrolling; ctrl+wheel is the trackpad pinch
  useEffect(() => {
    const el = viewport.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(local(el, e), Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const down = (e: PointerEvent<HTMLDivElement>) => {
    const p = local(e.currentTarget, e);
    pointers.current.set(e.pointerId, p);
    swallowClick.current = false;
    world.current?.classList.remove("flying"); // grabbing mid-flight: follow the finger, not the easing
    if (pointers.current.size === 1) drag.current = { start: p, last: p, panning: false };
    if (pointers.current.size === 2 && view.current) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view0: view.current };
      swallowClick.current = true;
    }
  };

  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e.currentTarget, e);
    pointers.current.set(e.pointerId, p);
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const { d0, mid0, view0 } = pinch.current;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const k = clampK((view0.k * Math.hypot(a.x - b.x, a.y - b.y)) / d0);
      // keep the world point that was under the first midpoint under the fingers
      const wx = (mid0.x - view0.x) / view0.k;
      const wy = (mid0.y - view0.y) / view0.k;
      apply({ k, x: mid.x - wx * k, y: mid.y - wy * k });
      return;
    }
    const d = drag.current;
    if (!d) return;
    if (!d.panning && Math.hypot(p.x - d.start.x, p.y - d.start.y) > DRAG_PX) {
      d.panning = true;
      swallowClick.current = true;
      // capture only once it is a pan, otherwise the click would retarget away from the node button
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (d.panning) {
      const dx = p.x - d.last.x;
      const dy = p.y - d.last.y;
      const v = view.current;
      if (v) apply({ ...v, x: v.x + dx, y: v.y + dy });
    }
    d.last = p;
  };

  const up = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) drag.current = null;
  };

  // a keyboard user tabbing to an off-screen node: bring it into view
  const revealIfHidden = (p: Placed) => {
    const r = viewport.current?.getBoundingClientRect();
    const v = view.current;
    if (!r || !v) return;
    const sx = p.x * v.k + v.x;
    const sy = p.y * v.k + v.y;
    if (sx < 60 || sy < 60 || sx > r.width - 60 || sy > r.height - 60) flyTo(p, v.k);
  };

  // newly approved nodes, in map order (branch by branch, outward from the hub): the n-th one's line draws
  // on after n steps, so a fuksi coming back sees their progress light up line by line
  const order = new Map(
    placed
      .filter((p) => !p.node.locked && glow?.ids.includes(p.node.id))
      .map((p, i) => [p.key, i] as const),
  );
  const step = Math.min(0.5, 6 / Math.max(1, order.size)); // seconds between lines; the whole show stays under ~6 s

  // edges: hub -> first node -> next node, per branch; the line into a node is neon once that node is approved
  const edges = map.categories.flatMap((cat) => {
    const branch = placed.filter((p) => p.cat.id === cat.id);
    return branch.map((p, j) => {
      const from = j === 0 ? { x: 0, y: 0 } : branch[j - 1];
      const lit = personal && stateOf(p.node) === "lit";
      const bend = 0.12; // a slight curve: reads as a drawn path, not a chart
      const d = `M${from.x} ${from.y} Q${(from.x + p.x) / 2 + (p.y - from.y) * bend} ${(from.y + p.y) / 2 - (p.x - from.x) * bend} ${p.x} ${p.y}`;
      return { key: `e-${p.key}`, d, lit, color: cat.color, i: order.get(p.key) };
    });
  });

  return (
    <div className="tree-shell">
      <div
        ref={viewport}
        className="tree-viewport"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        // overflow:hidden still scrolls on focus(); our transform owns the position
        onScroll={(e) => e.currentTarget.scrollTo(0, 0)}
      >
        <div ref={world} className="tree-world">
          <svg className="tree-edges" aria-hidden="true">
            {edges.map((e) => (
              <path key={e.key} className="base" d={e.d} style={{ "--c": e.color } as CSSProperties} />
            ))}
            {/* neon tubes on top; a fresh one re-mounts per glow round (key) so its draw-on animation replays */}
            {edges.map(
              (e) =>
                e.lit && (
                  <path
                    key={e.i === undefined ? `${e.key}-lit` : `${e.key}-lit-${glow?.n}`}
                    className={e.i === undefined ? "neon" : "neon draw"}
                    d={e.d}
                    pathLength={1}
                    style={{ "--c": e.color, "--delay": `${(e.i ?? 0) * step}s` } as CSSProperties}
                  />
                ),
            )}
          </svg>

          {map.categories.map((cat) => {
            const end = ends.get(cat.id)!;
            return (
              <div key={cat.id} className="tree-banner" style={{ left: end.x, top: end.y, "--c": cat.color } as CSSProperties} aria-hidden="true">
                <Icon name={cat.icon} size={22} />
                <span>{cat.name}</span>
                {personal && <b>{cat.min_points ? `${cat.points}/${cat.min_points}p` : `${cat.points}p`}</b>}
              </div>
            );
          })}

          <div className="tree-hub">{hub}</div>

          {placed.map((p) => (
            <SkillNode
              key={p.key}
              p={p}
              state={stateOf(p.node)}
              personal={personal}
              burst={burst?.has(p.key) ?? false}
              delay={order.has(p.key) ? `${order.get(p.key)! * step + 0.55}s` : undefined}
              glowN={glow?.n}
              selected={!p.node.locked && p.node.id === selectedId}
              onFocus={() => revealIfHidden(p)}
              onClick={() => {
                if (swallowClick.current || p.node.locked) return;
                // our own double-tap detection: dblclick is unreliable on touch screens
                const now = performance.now();
                const double = lastTap.current?.id === p.node.id && now - lastTap.current.at < 350;
                lastTap.current = double ? null : { id: p.node.id, at: now };
                if (double) onSubmit?.(p.node);
                else onSelect?.(p.node);
              }}
            />
          ))}
        </div>
      </div>

      <div className="tree-controls" role="group" aria-label="Map controls">
        <button type="button" aria-label="Zoom in" onClick={() => {
            glide();
            zoomAt(centerOf(viewport.current), 1.25);
          }}>
          <Icon name="plus" />
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => {
            glide();
            zoomAt(centerOf(viewport.current), 0.8);
          }}>
          <Icon name="minus" />
        </button>
        <button type="button" aria-label="Back to the centre of the tree" onClick={() => home(true)}>
          <Icon name="target" />
        </button>
      </div>
    </div>
  );
}

const local = (el: HTMLElement, e: { clientX: number; clientY: number }): Pt => {
  const r = el.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};

const centerOf = (el: HTMLElement | null): Pt => {
  const r = el?.getBoundingClientRect();
  return { x: (r?.width ?? 0) / 2, y: (r?.height ?? 0) / 2 };
};

const SAY: Record<State, string> = { locked: "Secret task, locked", open: "Not done yet", pending: "Waiting for review", lit: "Completed" };

function SkillNode({
  p,
  state,
  personal,
  burst,
  delay,
  glowN,
  selected,
  onFocus,
  onClick,
}: {
  p: Placed;
  state: State;
  personal: boolean;
  burst: boolean;
  delay?: string; // set while this node's line is drawing on: it pops when the line arrives
  glowN?: number;
  selected: boolean;
  onFocus: () => void;
  onClick: () => void;
}) {
  const n = p.node;
  const style = { left: p.x, top: p.y, "--c": p.cat.color, "--on": readableOn(p.cat.color), "--delay": delay } as CSSProperties;
  if (n.locked) {
    return (
      <div className={`tree-node locked${burst ? " burst" : ""}`} style={style} role="img" aria-label="Secret task, locked until the captain reveals it">
        <span className="tree-dot">
          <Icon name="keyhole" size={26} />
        </span>
        <span className="tree-label">???</span>
      </div>
    );
  }
  const repeats = personal && n.max_repeats > 1;
  const body = (
    <>
      <span className="tree-dot">
        <Icon name={p.cat.icon} size={26} />
        {state === "lit" && (
          <span className="tree-badge done">
            <Icon name="check" size={14} />
          </span>
        )}
        {state === "pending" && (
          <span className="tree-badge wait">
            <Icon name="clock" size={14} />
          </span>
        )}
      </span>
      <span className="tree-label">{n.title}</span>
      <span className="tree-pts">{pointsLabel(n)}</span>
      {repeats && (
        <span className="tree-pips" aria-hidden="true">
          {Array.from({ length: n.max_repeats }, (_, i) => (
            <i key={i} className={i < n.approved ? "on" : i < n.approved + n.pending ? "half" : ""} />
          ))}
        </span>
      )}
    </>
  );
  const label = `${n.title}, ${pointsLabel(n)}, ${personal ? SAY[state] : p.cat.name}${repeats ? `, ${n.approved} of ${n.max_repeats} done` : ""}`;
  const cls = `tree-node ${state}${burst || delay ? " burst" : ""}${selected ? " selected" : ""}`;
  return personal ? (
    // key per glow round: re-mounting replays the pop when this node's line arrives
    <button key={delay ? `g${glowN}` : "n"} type="button" className={cls} style={style} aria-label={label} aria-pressed={selected} onFocus={onFocus} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={cls} style={style} role="img" aria-label={label}>
      {body}
    </div>
  );
}
