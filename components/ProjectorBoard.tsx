"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { loadLeaderboard, loadRoadmap, type LeaderRow, type Roadmap } from "@/lib/roadmap";
import { iconGlyph } from "@/lib/icons";
import { NodeDot } from "./NodeDot";
import { Tiers } from "./Tiers";

const POLL_MS = 5000;

// Projector: the full 2D map plus the animated tutor-group leaderboard. Polls every 5 s, so an approval
// (or a later secret reveal) shows up on the next poll. The map shows the logged-in member's node states.
export function ProjectorBoard({ guildId }: { guildId: number }) {
  const [map, setMap] = useState<Roadmap | null>(null);
  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = () => {
      Promise.all([loadRoadmap(guildId), loadLeaderboard(guildId)]).then(
        ([m, r]) => {
          if (!alive) return;
          setMap(m);
          setRows(r);
          setError(null);
        },
        (e: Error) => alive && setError(e.message),
      );
    };
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [guildId]);

  if (error && !map) return <p className="error">{error}</p>;
  if (!map) return <p>Loading the map…</p>;

  const top = Math.max(1, ...rows.map((r) => r.total_points));
  return (
    <div className="board">
      <section className="board-map" aria-label="Guild map">
        {map.categories.map((c) => {
          const color = c.color;
          const nodes = map.nodes.filter((n) => n.category_id === c.id);
          return (
            <div key={c.id} className="lane" style={{ "--c": color } as CSSProperties}>
              <h2>
                <span aria-hidden>{iconGlyph(c.icon)}</span> {c.name}
                <span className="progress">{c.min_points ? `${c.points}/${c.min_points}p` : `${c.points}p`}</span>
              </h2>
              <div className="chain wrap">
                {nodes.map((n, j) => (
                  <NodeDot key={n.locked ? `lock-${j}` : n.id} node={n} color={color} />
                ))}
              </div>
            </div>
          );
        })}
      </section>
      <aside className="board-side">
        <Tiers map={map} />
        <h2>Tutor groups</h2>
        <ol className="leaders">
          {rows.map((r) => (
            <li key={r.group_id}>
              <span>{r.group_name}</span>
              <span className="bar" style={{ width: `${(r.total_points / top) * 100}%` }} />
              <strong>{r.total_points}p</strong>
            </li>
          ))}
        </ol>
        {error && <p className="error">Connection problem, retrying: {error}</p>}
      </aside>
    </div>
  );
}
