"use client";
import { useCallback, useEffect, useState } from "react";
import { db } from "@/lib/supabase";
import { friendly } from "@/lib/roadmap";
import type { Me } from "@/lib/useMe";

type Item = { id: number; who: string; title: string; note: string | null; min: number; max: number };

// Tutor / captain queue: the pending submissions RLS lets the caller see. Points default to the node's min.
export function ReviewQueue({ me }: { me: Me }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = useCallback(async (): Promise<Item[]> => {
    const client = db();
    // scoped to the active guild: a person can hold different roles in different guilds
    const subs = await client
      .from("submissions")
      .select("id, task_id, member_id, note")
      .eq("guild_id", me.guildId)
      .eq("status", "pending")
      .order("created_at");
    if (subs.error) throw new Error(subs.error.message);
    const [tasks, members] = await Promise.all([
      client.from("tasks").select("id, title, points_min, points_max, reviewer").eq("guild_id", me.guildId),
      client.from("members").select("id, display_name").eq("guild_id", me.guildId),
    ]);
    if (tasks.error) throw new Error(tasks.error.message);
    if (members.error) throw new Error(members.error.message);
    const task = new Map(tasks.data.map((t) => [t.id, t]));
    const name = new Map(members.data.map((m) => [m.id, m.display_name]));
    return subs.data.flatMap((s) => {
      const t = task.get(s.task_id);
      // tutors review tutor-reviewed nodes only; captain-reviewed ones belong to the captain
      if (!t || (t.reviewer === "captain" && me.role !== "captain")) return [];
      return [{ id: s.id, who: name.get(s.member_id) ?? "?", title: t.title, note: s.note, min: t.points_min, max: t.points_max }];
    });
  }, [me.guildId, me.role]);

  const reload = useCallback(() => {
    fetchItems().then(setItems, (e: Error) => setError(e.message));
  }, [fetchItems]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (error) return <p className="error">{error}</p>;
  if (!items) return <p>Loading the queue…</p>;
  if (items.length === 0) return <p>Nothing waiting for review.</p>;
  return (
    <ul className="queue">
      {items.map((item) => (
        <QueueRow key={item.id} item={item} onChanged={reload} />
      ))}
    </ul>
  );
}

function QueueRow({ item, onChanged }: { item: Item; onChanged: () => void }) {
  const [points, setPoints] = useState(item.min);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const review = async (approve: boolean) => {
    setBusy(true);
    setError(null);
    const { data, error } = await db().rpc("review_submissions", {
      p_ids: [item.id],
      p_approve: approve,
      p_points: approve ? points : undefined,
      p_reason: approve && points > item.min ? reason : undefined,
    });
    setBusy(false);
    if (error) return setError(friendly(error.message));
    if (data[0]?.result === "limit_reached") return setError(friendly("limit_reached"));
    onChanged();
  };

  return (
    <li className="queue-item">
      <div>
        <strong>{item.title}</strong> · {item.who}
        {item.note && <p className="note">“{item.note}”</p>}
      </div>
      {item.max > item.min && (
        <div className="stepper">
          <label>
            Points
            <input type="number" min={item.min} max={item.max} value={points} onChange={(e) => setPoints(Number(e.target.value))} />
          </label>
          {points > item.min && (
            <input placeholder="Reason (required)" aria-label="Reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="button" disabled={busy} onClick={() => void review(false)}>
          ❌ Reject
        </button>
        <button type="button" className="primary" disabled={busy} onClick={() => void review(true)}>
          ✅ Approve {points}p
        </button>
      </div>
    </li>
  );
}
