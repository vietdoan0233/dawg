"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { effectiveStatus, type TreeNode, type TreeStatus } from "@/lib/skillTree";
import { SubmitEvidenceModal } from "./SubmitEvidenceModal";

type View = { x: number; y: number; k: number }; // screen = world * k + (x, y)
type Pt = { x: number; y: number };

const MIN_K = 0.4;
const MAX_K = 2.5;
// start zoom: close enough that only the start node's neighbours show, scaled down on narrow phones
const startK = (width: number) => Math.min(1.15, Math.max(0.75, width / 560));
const DRAG_PX = 5; // below this a press is a click, above it a pan
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));

// Pan/zoom without a library: pointer events cover mouse, touch and pen; two pointers = pinch.
// ponytail: no inertia or animated fly-to; add when the real map is big enough to need it.
export function SkillTree({ nodes, onSubmit }: { nodes: TreeNode[]; onSubmit: (id: string, text: string, file: File | null) => Promise<void> }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);

  const pointers = useRef(new Map<number, Pt>());
  const drag = useRef<{ start: Pt; last: Pt; panning: boolean } | null>(null);
  const pinch = useRef<{ d0: number; mid0: Pt; view0: View } | null>(null);
  const swallowClick = useRef(false);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const status = useMemo(() => new Map(nodes.map((n) => [n.id, effectiveStatus(n, byId)])), [nodes, byId]);
  const start = nodes.find((n) => n.parents.length === 0) ?? nodes[0];

  const centerOn = useCallback((p: Pt, zoom?: number) => {
    const r = viewport.current?.getBoundingClientRect();
    if (!r) return;
    const k = zoom ?? startK(r.width);
    setView({ k, x: r.width / 2 - p.x * k, y: r.height / 2 - p.y * k });
  }, []);

  // first paint centred on the start node (layout effect: no flash at 0,0)
  useLayoutEffect(() => centerOn(start.position), [centerOn, start.position]);

  const zoomAt = useCallback((p: Pt, factor: number) => {
    setView((v) => {
      if (!v) return v;
      const k = clampK(v.k * factor);
      return { k, x: p.x - ((p.x - v.x) * k) / v.k, y: p.y - ((p.y - v.y) * k) / v.k };
    });
  }, []);

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
    if (pointers.current.size === 1) drag.current = { start: p, last: p, panning: false };
    if (pointers.current.size === 2 && view) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view0: view };
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
      setView({ k, x: mid.x - wx * k, y: mid.y - wy * k });
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
      setView((v) => v && { ...v, x: v.x + dx, y: v.y + dy });
    }
    d.last = p;
  };

  const up = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) drag.current = null;
  };

  // a keyboard user tabbing to an off-screen node: bring it into view
  const revealIfHidden = (n: TreeNode) => {
    const r = viewport.current?.getBoundingClientRect();
    if (!r || !view) return;
    const sx = n.position.x * view.k + view.x;
    const sy = n.position.y * view.k + view.y;
    if (sx < 40 || sy < 40 || sx > r.width - 40 || sy > r.height - 40) centerOn(n.position, view.k);
  };

  const open = selected ? byId.get(selected) : undefined;
  const openStatus = open && status.get(open.id);
  const modalNode = submitting ? byId.get(submitting) : undefined;

  return (
    <div className="tree-shell">
      <div
        ref={viewport}
        className={`tree-viewport${view && view.k < 0.75 ? " far" : ""}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        // overflow:hidden still scrolls on focus(); our transform owns the position
        onScroll={(e) => e.currentTarget.scrollTo(0, 0)}
      >
        <div className="tree-world" style={view ? { transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` } : { visibility: "hidden" }}>
          <svg className="tree-edges" aria-hidden="true">
            {nodes.flatMap((n) =>
              n.parents.flatMap((pid) => {
                const p = byId.get(pid);
                if (!p) return [];
                const s = status.get(n.id);
                const cls = s === "completed" ? "done" : p.status === "completed" && s !== "locked" ? "open" : "";
                return [<line key={`${pid}-${n.id}`} className={cls} x1={p.position.x} y1={p.position.y} x2={n.position.x} y2={n.position.y} style={{ "--c": n.color } as CSSProperties} />];
              }),
            )}
          </svg>
          {nodes.map((n) => (
            <SkillNode
              key={n.id}
              node={n}
              status={status.get(n.id)!}
              selected={n.id === selected}
              onFocus={() => revealIfHidden(n)}
              onSelect={() => !swallowClick.current && setSelected(n.id)}
              onSubmit={() => !swallowClick.current && setSubmitting(n.id)}
            />
          ))}
        </div>
      </div>

      <div className="tree-controls" role="group" aria-label="Map view">
        <button type="button" aria-label="Zoom in" onClick={() => zoomAt(centerOf(viewport.current), 1.25)}>
          +
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomAt(centerOf(viewport.current), 0.8)}>
          −
        </button>
        <button type="button" onClick={() => centerOn(start.position)}>
          Back to start
        </button>
      </div>

      {open && openStatus && <TaskPanel node={open} status={openStatus} onClose={() => setSelected(null)} onSubmit={() => setSubmitting(open.id)} />}

      {modalNode && (
        <SubmitEvidenceModal
          node={modalNode}
          onCancel={() => setSubmitting(null)}
          onSubmit={async (text, file) => {
            await onSubmit(modalNode.id, text, file);
            setSubmitting(null);
            setSelected(modalNode.id);
          }}
        />
      )}
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

const LABEL: Record<TreeStatus, string> = { locked: "Locked", available: "Available", pending: "Waiting for tutor", completed: "Completed" };

// Click = details; double-click = straight to the submission modal (desktop shortcut only:
// touch has no reliable double-tap, so the panel's button is the real path).
function SkillNode({
  node,
  status,
  selected,
  onFocus,
  onSelect,
  onSubmit,
}: {
  node: TreeNode;
  status: TreeStatus;
  selected: boolean;
  onFocus: () => void;
  onSelect: () => void;
  onSubmit: () => void;
}) {
  return (
    <button
      type="button"
      className={`tree-node ${status}${selected ? " selected" : ""}`}
      style={{ left: node.position.x, top: node.position.y, "--c": node.color } as CSSProperties}
      disabled={status === "locked"}
      aria-label={`${node.title}, ${LABEL[status]}, ${node.points} points`}
      aria-pressed={selected}
      onFocus={onFocus}
      onClick={onSelect}
      onDoubleClick={() => status === "available" && onSubmit()}
    >
      <span className="tree-dot" aria-hidden="true">
        {status === "completed" && <CheckIcon />}
        {status === "locked" && <LockIcon />}
        {status === "pending" && <ClockIcon />}
      </span>
      <span className="tree-label" aria-hidden="true">
        {node.title}
      </span>
      <span className="tree-tip" aria-hidden="true">
        {node.title} · {node.points}p
      </span>
    </button>
  );
}

function TaskPanel({ node, status, onClose, onSubmit }: { node: TreeNode; status: TreeStatus; onClose: () => void; onSubmit: () => void }) {
  return (
    <aside className="tree-panel" aria-labelledby="task-title" style={{ "--c": node.color } as CSSProperties} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="row">
        <span className={`tree-chip ${status}`}>{LABEL[status]}</span>
        <button type="button" className="tree-close" aria-label="Close details" onClick={onClose}>
          ×
        </button>
      </div>
      <h2 id="task-title">{node.title}</h2>
      <p className="tree-lore">{node.lore}</p>
      <h3>What to do</h3>
      <p>{node.description}</p>
      <p className="tree-reward">
        Reward <strong>{node.points}p</strong>
      </p>
      {status === "available" && (
        <button type="button" className="primary" onClick={onSubmit}>
          Submit evidence
        </button>
      )}
      {status === "pending" && <p className="hint">Your tutor has it. The node lights up once they approve.</p>}
    </aside>
  );
}

const icon = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const CheckIcon = () => (
  <svg {...icon}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
const LockIcon = () => (
  <svg {...icon} strokeWidth={2}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);
const ClockIcon = () => (
  <svg {...icon} strokeWidth={2}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);
