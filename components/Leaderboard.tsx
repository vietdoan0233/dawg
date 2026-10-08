"use client";
import { useEffect, useState } from "react";
import { loadLeaderboard, type LeaderRow } from "@/lib/roadmap";
import { Icon } from "./Icon";

// Every fuksi of the guild, by rank (ties share a rank). Polls every 5 s. ponytail: minimal v4 swap; lane C adds modes, MVP, FLIP.
export function Leaderboard({ guildId, meId }: { guildId: number; meId?: number }) {
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = () =>
      loadLeaderboard(guildId).then(
        (r) => {
          if (!alive) return;
          setRows(r); // already ordered by rank, name
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
  if (rows.length === 0) return <p className="hint">No fuksis yet. They will appear here once they join.</p>;
  return (
    <>
      <LeaderRows rows={rows} meId={meId} />
      {error && <p className="error">Can&apos;t update the leaderboard right now. Trying again…</p>}
    </>
  );
}

// The rows themselves; the home preview passes a slice (top 3 + you), rows in `gap` start after skipped rows (drawn as a divider).
export function LeaderRows({ rows, meId, gap, top = Math.max(1, ...rows.map((r) => r.total)) }: { rows: LeaderRow[]; meId?: number; gap?: Set<number>; top?: number }) {
  return (
    <ol className="leaders">
      {rows.map((r) => (
        <li
          key={r.member_id}
          className={[r.rank === 1 && r.total > 0 && "first", r.member_id === meId && "me", gap?.has(r.member_id) && "gap"].filter(Boolean).join(" ") || undefined}
          aria-current={r.member_id === meId || undefined}
        >
          <span className="rank" aria-label={`Place ${r.rank}`}>
            {r.rank === 1 && r.total > 0 ? <Icon name="crown" size={18} /> : r.rank}
          </span>
          <span className="name">{r.member_id === meId ? `${r.display_name} (you)` : r.display_name}</span>
          <strong>{r.total}p</strong>
          <span className="bar" style={{ width: `${(r.total / top) * 100}%` }} />
        </li>
      ))}
    </ol>
  );
}
