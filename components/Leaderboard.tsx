"use client";
import { useEffect, useState } from "react";
import { loadLeaderboard, type LeaderRow } from "@/lib/roadmap";
import { Icon } from "./Icon";

// Tutor-group totals (leaderboard() never exposes individual names or scores). Polls every 5 s.
export function Leaderboard({ guildId }: { guildId: number }) {
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = () =>
      loadLeaderboard(guildId).then(
        (r) => {
          if (!alive) return;
          setRows([...r].sort((a, b) => b.total_points - a.total_points));
          setError(null);
        },
        (e: Error) => alive && setError(e.message),
      );
    poll();
    const timer = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [guildId]);

  if (!rows) return error ? <p className="error">{error}</p> : <p className="hint">Loading the leaderboard…</p>;
  if (rows.length === 0) return <p className="hint">No tutor groups yet. They will appear here once the captain adds them.</p>;
  const top = Math.max(1, ...rows.map((r) => r.total_points));
  return (
    <>
      <ol className="leaders">
        {rows.map((r, i) => (
          <li key={r.group_id} className={i === 0 && r.total_points > 0 ? "first" : undefined}>
            <span className="rank" aria-label={`Place ${i + 1}`}>
              {i === 0 && r.total_points > 0 ? <Icon name="crown" size={18} /> : i + 1}
            </span>
            <span className="name">{r.group_name}</span>
            <strong>{r.total_points}p</strong>
            <span className="bar" style={{ width: `${(r.total_points / top) * 100}%` }} />
          </li>
        ))}
      </ol>
      {error && <p className="error">Can&apos;t update the leaderboard right now. Trying again…</p>}
    </>
  );
}
