"use client";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { chime } from "@/lib/fx";
import { pointsLabel, useRoadmap, type Category, type OpenNode, type Roadmap } from "@/lib/roadmap";
import type { Me } from "@/lib/useMe";
import { Icon } from "./Icon";
import { Leaderboard } from "./Leaderboard";
import { MyCode } from "./MyCode";
import { NodeSheet, nodeStatus } from "./NodeSheet";
import { SkillTree } from "./SkillTree";

// The fuksi's home: their own skill tree, the level hub, track shortcuts, and the QR / leaderboard sheets.
export function FuksiHome({ me, bar }: { me: Me; bar: ReactNode }) {
  const { map, error, news, refresh } = useRoadmap(me.guildId, true);
  const [selectedId, setSelectedId] = useState<number | null>(null); // info card
  const [openId, setOpenId] = useState<number | null>(null); // submit sheet
  const [panel, setPanel] = useState<"qr" | "ranks" | null>(null);
  const [focus, setFocus] = useState<{ id: number; n: number } | null>(null);
  const [sent, setSent] = useState(0); // bumps per submission: replays the "sent" toast
  const [seenLevel, setSeenLevel] = useState(0);

  // celebrate what changed: approvals (also ones made while the fuksi was away) draw their lines on as neon,
  // reveals unlock keyholes
  const burst = useMemo(() => new Set((news?.revealed ?? []).map((id) => `n${id}`)), [news]);
  const glow = useMemo(() => (news?.fresh.length ? { ids: news.fresh, n: news.n } : null), [news]);
  useEffect(() => {
    if (news) chime(news.tier ? "level" : "lit");
  }, [news]);

  if (!map) {
    return (
      <div className="screen">
        {bar}
        <div className="center-msg">{error ? <p className="error">{error}</p> : <p className="loading-rune">Loading your skill tree…</p>}</div>
      </div>
    );
  }

  const find = (id: number | null) => (id === null ? undefined : map.nodes.find((n): n is OpenNode => !n.locked && n.id === id));
  const catOf = (n?: OpenNode) => n && map.categories.find((c) => c.id === n.category_id);
  const open = find(openId);
  const openCat = catOf(open);
  const selected = find(selectedId);
  const selectedCat = catOf(selected);
  const away = news && !news.lit.length ? news.fresh.length : 0; // approved while the fuksi was away
  const levelUp = news?.tier && news.n !== seenLevel ? news.tier : null;

  return (
    <div className="screen fuksi">
      {bar}
      <nav className="tracks" aria-label="Tracks">
        {map.categories.map((c) => {
          const pct = c.min_points ? Math.min(100, (c.points / c.min_points) * 100) : c.points > 0 ? 100 : 0;
          const done = c.min_points ? c.points >= c.min_points : c.points > 0;
          return (
            <button
              key={c.id}
              type="button"
              className={`track${done ? " done" : ""}`}
              style={{ "--c": c.color, "--pct": `${pct}%` } as CSSProperties}
              onClick={() => {
                chime("tap");
                setFocus((f) => ({ id: c.id, n: (f?.n ?? 0) + 1 }));
              }}
            >
              <Icon name={c.icon} size={18} />
              <span className="track-name">{c.name}</span>
              <span className="track-pts">{c.min_points ? `${c.points}/${c.min_points}` : c.points}p</span>
            </button>
          );
        })}
      </nav>

      <SkillTree
        map={map}
        personal
        burst={burst}
        focusCat={focus}
        glow={glow}
        selectedId={selectedId}
        hub={<Hub map={map} />}
        onSelect={(n) => {
          chime("tap");
          setSelectedId(n.id);
        }}
        onSubmit={(n) => {
          chime("tap");
          setSelectedId(n.id);
          setOpenId(n.id);
        }}
      />

      {selected && selectedCat && !open && (
        <NodeInfo key={selected.id} node={selected} cat={selectedCat} onClose={() => setSelectedId(null)} onSubmit={() => setOpenId(selected.id)} />
      )}

      <div className="dock" role="toolbar" aria-label="Quick actions">
        <button type="button" onClick={() => setPanel("qr")}>
          <Icon name="qr" size={22} />
          <span>My QR</span>
        </button>
        <button type="button" onClick={() => setPanel("ranks")}>
          <Icon name="trophy" size={22} />
          <span>Leaderboard</span>
        </button>
      </div>

      {/* toasts replay by key; CSS fades them out, so no timers to clean up */}
      <div className="toasts" aria-live="polite">
        {sent > 0 && (
          <p key={`s${sent}`} className="toast">
            <Icon name="send" size={18} /> Sent! The task lights up once it&apos;s approved.
          </p>
        )}
        {news && news.lit.length > 0 && (
          <p key={`l${news.n}`} className="toast good">
            <Icon name="sparkle" size={18} /> {news.lit.map((n) => n.title).join(", ")} approved!
          </p>
        )}
        {away > 0 && (
          <p key={`a${news!.n}`} className="toast good">
            <Icon name="sparkle" size={18} /> {away === 1 ? "1 task was" : `${away} tasks were`} approved while you were away!
          </p>
        )}
        {news && news.revealed.length > 0 && (
          <p key={`r${news.n}`} className="toast secret">
            <Icon name="keyhole" size={18} /> A secret task has been revealed!
          </p>
        )}
      </div>

      {levelUp && (
        <button type="button" className="levelup" onClick={() => setSeenLevel(news!.n)} aria-label={`Level up: ${levelUp}. Tap to continue.`}>
          <span className="levelup-card">
            <Icon name="crown" size={56} />
            <span className="levelup-kicker">Level up</span>
            <strong>{levelUp}</strong>
            <span className="hint">Tap to continue</span>
          </span>
        </button>
      )}

      {open && openCat && (
        <NodeSheet
          me={me}
          node={open}
          cat={openCat}
          onClose={() => setOpenId(null)}
          onSent={() => {
            setOpenId(null);
            setSent((s) => s + 1);
            refresh();
          }}
        />
      )}

      {panel && (
        <Panel title={panel === "qr" ? "My check-in QR" : "Levels & leaderboard"} onClose={() => setPanel(null)}>
          {panel === "qr" ? (
            <>
              <p className="hint">Show this code to the organizer at the event. The task lights up as soon as they scan it.</p>
              <MyCode guildId={me.guildId} />
            </>
          ) : (
            <>
              <Levels map={map} />
              <h3 className="section-title">Tutor groups</h3>
              <Leaderboard guildId={me.guildId} />
            </>
          )}
        </Panel>
      )}
    </div>
  );
}

// One tap on a node: what it is and what to do. Submitting is one more tap (or a double tap on the node).
function NodeInfo({ node, cat, onClose, onSubmit }: { node: OpenNode; cat: Category; onClose: () => void; onSubmit: () => void }) {
  const canSubmit = node.approved + node.pending < node.max_repeats;
  return (
    <aside className="info" style={{ "--c": cat.color } as CSSProperties} aria-labelledby="info-title" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <header className="sheet-head">
        <span className="track-chip">
          <Icon name={cat.icon} size={16} /> {cat.name}
        </span>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <Icon name="x" />
        </button>
      </header>
      <div className="sheet-title">
        <h2 id="info-title">{node.title}</h2>
        <p className="reward">
          <Icon name="sparkle" size={18} /> {pointsLabel(node)}
        </p>
      </div>
      <p className={`status-line${node.pending ? " wait" : node.approved ? " done" : ""}`}>{nodeStatus(node)}</p>
      <h3 className="section-title">What to do</h3>
      <p className="desc">{node.description ?? "Ask your tutor what counts for this task."}</p>
      {node.requires_note && <p className="hint">You&apos;ll need to write the event&apos;s name when you submit.</p>}
      {canSubmit ? (
        <>
          <button type="button" className="primary big" onClick={onSubmit}>
            <Icon name="send" /> Submit proof
          </button>
          <p className="hint">Tip: double-tap a task on the tree to submit it straight away.</p>
        </>
      ) : node.pending > 0 ? (
        <p className="status-line wait">
          <Icon name="clock" size={16} /> Submitted. The task lights up once it&apos;s approved.
        </p>
      ) : (
        <p className="status-line done">
          <Icon name="check" size={16} /> You&apos;ve completed this task.
        </p>
      )}
    </aside>
  );
}

// Centre of the tree: total points, current level and a ring towards the next one.
function Hub({ map }: { map: Roadmap }) {
  const shown = useCountUp(map.total);
  const own = map.tiers.find((t) => t.id === map.own_tier_id);
  const next = map.tiers.find((t) => t.min_total > map.total);
  const from = own?.min_total ?? 0;
  const frac = next ? (map.total - from) / (next.min_total - from) : 1;
  const C = 2 * Math.PI * 78;
  return (
    <div className="hub" aria-label={`${map.total} points${own ? `, ${own.name}` : ""}${next ? `, ${next.min_total - map.total} points to ${next.name}` : ""}`}>
      <svg viewBox="0 0 180 180" aria-hidden="true">
        <circle cx="90" cy="90" r="78" className="hub-track" />
        <circle cx="90" cy="90" r="78" className="hub-ring" strokeDasharray={`${C * frac} ${C}`} transform="rotate(-90 90 90)" />
      </svg>
      <span className="hub-pts">{shown}</span>
      <span className="hub-unit">points</span>
      <span className="hub-tier">{own?.name ?? "Fuksi"}</span>
      <span className="hub-next">{next ? `${next.min_total - map.total}p to ${next.name}` : "Max level"}</span>
    </div>
  );
}

function Levels({ map }: { map: Roadmap }) {
  return (
    <ol className="levels">
      {map.tiers.map((t) => (
        <li key={t.id} className={map.total >= t.min_total ? "reached" : undefined}>
          <Icon name={map.total >= t.min_total ? "check" : "lock"} size={16} />
          <span>{t.name}</span>
          <b>{t.min_total}p</b>
        </li>
      ))}
    </ol>
  );
}

function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="sheet-body">
        <header className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

// Points tick up instead of jumping (skipped when the user prefers reduced motion).
function useCountUp(target: number) {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    from.current = target;
    if (start === target || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = requestAnimationFrame(() => setShown(target));
      return () => cancelAnimationFrame(id);
    }
    const t0 = performance.now();
    let id = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 900);
      setShown(Math.round(start + (target - start) * (1 - (1 - k) ** 3)));
      if (k < 1) id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [target]);
  return shown;
}
