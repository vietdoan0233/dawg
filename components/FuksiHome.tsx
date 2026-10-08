"use client";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { chime } from "@/lib/fx";
import { loadActivity, loadLeaderboard, pointsLabel, useRoadmap, type ActivityRow, type Category, type LeaderRow, type OpenNode, type Roadmap } from "@/lib/roadmap";
import type { Me } from "@/lib/useMe";
import { Icon } from "./Icon";
import { LeaderRows, Leaderboard } from "./Leaderboard";
import { MyCode } from "./MyCode";
import { NodeSheet, nodeStatus } from "./NodeSheet";
import { SkillTree } from "./SkillTree";

// The fuksi's app (SDD §11.2): "/" is the home page, "/?cat=<id>" the skill tree flown to that category.
// The URL holds the view, so the phone's Back button goes from the tree to home. Native history calls: Next syncs
// useSearchParams with them and, unlike router.push, they make no server round trip.
export function FuksiHome({ me, bar }: { me: Me; bar: ReactNode }) {
  const { map, error, news, refresh } = useRoadmap(me.guildId, true);
  const params = useSearchParams();
  const inTree = params.has("cat");
  const catId = Number(params.get("cat")) || null; // "/?cat" = the tree without a category
  const [focus, setFocus] = useState<{ id: number; n: number } | null>(catId ? { id: catId, n: 0 } : null);
  const [inView, setInView] = useState<number | null>(catId); // the category the tree shows (rail highlight)
  const [seenCat, setSeenCat] = useState(catId);
  const fromHome = useRef(false); // opened from home: "Home" goes back instead of stacking history
  const [selectedId, setSelectedId] = useState<number | null>(null); // info card
  const [openId, setOpenId] = useState<number | null>(null); // submit sheet
  const [panel, setPanel] = useState<"qr" | "ranks" | null>(null);
  const [sent, setSent] = useState(0); // bumps per submission: replays the "sent" toast
  const [seenLevel, setSeenLevel] = useState(0);

  // the URL changed (a tap, Back or Forward): fly the tree to that category
  if (catId !== seenCat) {
    setSeenCat(catId);
    if (catId) {
      setFocus((f) => ({ id: catId, n: (f?.n ?? 0) + 1 }));
      setInView(catId);
    }
  }

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
  const selected = inTree ? find(selectedId) : undefined;
  const selectedCat = catOf(selected);
  const away = news && !news.lit.length ? news.fresh.length : 0; // approved while the fuksi was away
  const levelUp = news?.tier && news.n !== seenLevel ? news.tier : null;

  const openTree = (id: number | null) => {
    chime("tap");
    fromHome.current = true;
    history.pushState(null, "", id ? `/?cat=${id}` : "/?cat");
  };
  const pickCat = (id: number) => {
    chime("tap");
    if (id === catId) setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 })); // same URL: fly back to it anyway
    setInView(id);
    history.replaceState(null, "", `/?cat=${id}`);
  };
  const goHome = () => {
    chime("tap");
    setSelectedId(null);
    if (fromHome.current) history.back();
    else history.replaceState(null, "", "/"); // opened straight from a link: nothing to go back to
    fromHome.current = false;
  };

  return (
    <div className="screen fuksi">
      {bar}
      {inTree ? (
        <div className="tree-view">
          <nav className="rail" aria-label="Categories">
            <button type="button" className="rail-item" onClick={goHome}>
              <Icon name="home" size={22} />
              <span className="rail-name">Home</span>
            </button>
            {map.categories.map((c) => {
              const { pct, done } = progress(map, c);
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`rail-item cat${done ? " done" : ""}`}
                  aria-current={inView === c.id || undefined}
                  style={{ "--c": c.color, "--pct": `${pct}%` } as CSSProperties}
                  onClick={() => pickCat(c.id)}
                >
                  <Icon name={c.icon} size={22} />
                  <span className="rail-name">{c.name}</span>
                  <span className="rail-pts">{c.min_points ? `${c.points}/${c.min_points}p` : `${c.points}p`}</span>
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
            onCategoryInView={setInView}
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
        </div>
      ) : (
        <HomeView me={me} map={map} onOpen={openTree} onBoard={() => setPanel("ranks")} />
      )}

      {selected && selectedCat && !open && (
        <NodeInfo key={selected.id} node={selected} cat={selectedCat} onClose={() => setSelectedId(null)} onSubmit={() => setOpenId(selected.id)} />
      )}

      <div className="dock" role="group" aria-label="Quick actions">
        <button type="button" onClick={() => setPanel("qr")}>
          <Icon name="qr" size={22} />
          <span>My QR</span>
        </button>
        {inTree ? (
          <button type="button" onClick={goHome}>
            <Icon name="home" size={22} />
            <span>Home</span>
          </button>
        ) : (
          <button type="button" onClick={() => openTree(null)}>
            <Icon name="map" size={22} />
            <span>Tree</span>
          </button>
        )}
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
              <h3 className="section-title">Leaderboard</h3>
              <Leaderboard guildId={me.guildId} meId={me.memberId} />
            </>
          )}
        </Panel>
      )}
    </div>
  );
}

// How far a category is: points towards its minimum, or tasks done when it has no minimum.
function progress(map: Roadmap, c: Category) {
  const nodes = map.nodes.filter((n) => n.category_id === c.id);
  const lit = nodes.filter((n) => !n.locked && n.status === "lit").length;
  const pending = nodes.some((n) => !n.locked && n.pending > 0);
  const pct = c.min_points ? Math.min(100, (c.points / c.min_points) * 100) : nodes.length ? (lit / nodes.length) * 100 : 0;
  return { lit, total: nodes.length, pending, pct, done: c.min_points ? c.points >= c.min_points : false };
}

// The home page: the next goal, the categories (each opens the tree there), the leaderboard and what others did.
function HomeView({ me, map, onOpen, onBoard }: { me: Me; map: Roadmap; onOpen: (catId: number) => void; onBoard: () => void }) {
  const { rows, activity, offline } = useFeed(me.guildId);
  const next = map.next_tier; // computed in SQL: rendered as-is (SDD §11.2)
  const ownIdx = map.tiers.findIndex((t) => t.id === map.own_tier_id);
  const catById = (id: number) => map.categories.find((c) => c.id === id);

  const meIdx = rows?.findIndex((r) => r.member_id === me.memberId) ?? -1;
  const mine = rows?.[meIdx];
  const moved = mine ? mine.rank_week_ago - mine.rank : 0;
  // the top 3, then you with one neighbour on each side
  const pick = rows ? [...new Set([0, 1, 2, meIdx - 1, meIdx, meIdx + 1])].filter((i) => i >= 0 && i < rows.length).sort((a, b) => a - b) : [];
  const gap = new Set(pick.filter((i, k) => k > 0 && i - pick[k - 1] > 1).map((i) => rows![i].member_id));

  return (
    <main className="home">
      <div className="home-col">
        <section className="goal" aria-labelledby="goal-title">
          <Hub map={map} />
          <div className="goal-text">
            <h1 id="goal-title">{next ? `Next level: ${next.name}` : map.tiers.length ? "Max level" : "Your points"}</h1>
            <p>
              {!next
                ? map.tiers.length ? "You've reached the top level. Amazing work!" : "Complete tasks to earn points."
                : next.points_needed > 0
                  ? `Earn ${next.points_needed} more points to reach ${next.name}.`
                  : `You have enough points for ${next.name}. Finish the goals below to get there.`}
            </p>
            {next && (next.unmet.length > 0 || next.required_missing > 0) && (
              <ul className="chips" aria-label={`Still needed for ${next.name}`}>
                {next.unmet.map((u) => {
                  const c = catById(u.category_id);
                  return (
                    <li key={u.category_id} style={{ "--c": c?.color ?? "var(--gold)" } as CSSProperties}>
                      {c && <Icon name={c.icon} size={14} />} {c?.name} {u.have}/{u.need}p
                    </li>
                  );
                })}
                {next.required_missing > 0 && (
                  <li>
                    <Icon name="flag" size={14} /> {next.required_missing} must-do task{next.required_missing > 1 ? "s" : ""} left
                  </li>
                )}
              </ul>
            )}
            <ol className="ladder" aria-label="Levels">
              {map.tiers.map((t, i) => (
                <li key={t.id} className={i <= ownIdx ? "reached" : t.id === next?.tier_id ? "next" : undefined} aria-current={i === ownIdx ? "step" : undefined}>
                  {t.name}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="cats-title">
          <h2 className="section-title" id="cats-title">
            Categories
          </h2>
          <ul className="cat-grid">
            {map.categories.map((c) => {
              const p = progress(map, c);
              return (
                <li key={c.id}>
                  <button type="button" className={`cat-card${p.done ? " done" : ""}`} style={{ "--c": c.color, "--pct": `${p.pct}%` } as CSSProperties} onClick={() => onOpen(c.id)}>
                    <span className="cat-icon">
                      <Icon name={c.icon} size={22} />
                    </span>
                    <span className="cat-name">{c.name}</span>
                    <span className="cat-pts">{c.min_points ? `${c.points}/${c.min_points}p` : `${c.points}p`}</span>
                    <span className="cat-bar" aria-hidden="true" />
                    <span className="cat-sub">
                      {p.done ? (
                        <>
                          <Icon name="check" size={14} /> Done
                        </>
                      ) : (
                        `${p.lit}/${p.total} tasks done`
                      )}
                      {p.pending && <span className="cat-wait"> · waiting for approval</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

      </div>

      <div className="home-col">
        <ul className="stats" aria-label="Your week">
          <li>
            <b>{mine ? `#${mine.rank}` : "–"}</b>
            <span>
              on the leaderboard{moved > 0 && <i className="up"> ▲{moved}</i>}
            </span>
          </li>
          <li>
            <b>+{mine?.week_points ?? 0}p</b>
            <span>this week</span>
          </li>
        </ul>

        <section className="panel" aria-labelledby="board-title">
          <h2 id="board-title">
            <Icon name="trophy" /> Leaderboard
            {offline && rows && <span className="offline">Offline · showing the last update</span>}
          </h2>
          {!rows ? (
            <p className="hint">{offline ? "Can't load the leaderboard right now. Trying again…" : "Loading the leaderboard…"}</p>
          ) : rows.length ? (
            <LeaderRows rows={pick.map((i) => rows[i])} meId={me.memberId} gap={gap} top={Math.max(1, ...rows.map((r) => r.total))} />
          ) : (
            <p className="hint">No fuksis yet.</p>
          )}
          <button type="button" onClick={onBoard}>
            See full leaderboard
          </button>
        </section>

        <section className="panel" aria-labelledby="activity-title">
          <h2 id="activity-title">
            <Icon name="sparkle" /> Recent activity
          </h2>
          {activity?.length ? (
            <ul className="activity">
              {activity.map((a, i) => (
                <li key={i} style={{ "--c": catById(a.category_id)?.color ?? "var(--gold)" } as CSSProperties}>
                  {a.task_title ? (
                    <>
                      <b>{a.display_name}</b> · {a.task_title} <strong>+{a.points}p</strong>
                    </>
                  ) : (
                    <>
                      <b>{a.display_name}</b> unlocked a secret task
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">{activity ? "Nothing yet this week. Be the first!" : "Loading…"}</p>
          )}
        </section>
      </div>
    </main>
  );
}

// Leaderboard + activity on one 15 s tick (phones, SDD §11.3), paused while the tab is hidden. A failed poll keeps
// the last data and only flags "offline".
function useFeed(guildId: number) {
  const [feed, setFeed] = useState<{ rows: LeaderRow[] | null; activity: ActivityRow[] | null; offline: boolean }>({ rows: null, activity: null, offline: false });
  useEffect(() => {
    let alive = true;
    const poll = () => {
      if (document.hidden) return;
      Promise.all([loadLeaderboard(guildId), loadActivity(guildId, 10)]).then(
        ([rows, activity]) => alive && setFeed({ rows, activity, offline: false }),
        () => alive && setFeed((f) => ({ ...f, offline: true })),
      );
    };
    poll();
    const timer = setInterval(poll, 15000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [guildId]);
  return feed;
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

// Centre of the tree and the home goal card: total points, current level and a ring towards the next one.
// The next level comes from roadmap().next_tier as-is (no tier logic in the client).
function Hub({ map }: { map: Roadmap }) {
  const shown = useCountUp(map.total);
  const own = map.tiers.find((t) => t.id === map.own_tier_id);
  const next = map.next_tier;
  const from = own?.min_total ?? 0;
  const frac = next?.points_needed ? Math.max(0, map.total - from) / (map.total + next.points_needed - from) : 1;
  const C = 2 * Math.PI * 78;
  return (
    <div className="hub" role="img" aria-label={`${map.total} points${own ? `, ${own.name}` : ""}${next?.points_needed ? `, ${next.points_needed} points to ${next.name}` : ""}`}>
      <svg viewBox="0 0 180 180" aria-hidden="true">
        <circle cx="90" cy="90" r="78" className="hub-track" />
        <circle cx="90" cy="90" r="78" className="hub-ring" strokeDasharray={`${C * frac} ${C}`} transform="rotate(-90 90 90)" />
      </svg>
      <span className="hub-pts">{shown}</span>
      <span className="hub-unit">points</span>
      <span className="hub-tier">{own?.name ?? "Fuksi"}</span>
      <span className="hub-next">{!next ? "Max level" : next.points_needed ? `${next.points_needed}p to ${next.name}` : `Goals left for ${next.name}`}</span>
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
