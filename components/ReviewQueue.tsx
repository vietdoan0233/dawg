"use client";
import { useCallback, useEffect, useState } from "react";
import { db } from "@/lib/supabase";
import { friendly } from "@/lib/roadmap";
import type { Me } from "@/lib/useMe";
import { chime } from "@/lib/fx";
import { Icon } from "./Icon";

type Item = { id: number; who: string; title: string; note: string | null; photo: string | null; dup: boolean; min: number; max: number };

// Tutor / captain queue: the pending submissions RLS lets the caller see. Points default to the node's min.
export function ReviewQueue({ me }: { me: Me }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchItems = useCallback(async (): Promise<Item[]> => {
    const client = db();
    // scoped to the active guild: a person can hold different roles in different guilds
    const subs = await client
      .from("submissions")
      .select("id, task_id, member_id, note, photo_path")
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
    // private bucket: short-lived signed links, readable only if the proofs policy lets the caller see them
    const paths = subs.data.flatMap((s) => (s.photo_path ? [s.photo_path] : []));
    const signed = paths.length ? await client.storage.from("proofs").createSignedUrls(paths, 3600) : { data: [] };
    const url = new Map((signed.data ?? []).map((x) => [x.path, x.signedUrl]));
    const task = new Map(tasks.data.map((t) => [t.id, t]));
    const name = new Map(members.data.map((m) => [m.id, m.display_name]));
    // same photo bytes as another submission in the guild (the server hashes a photo within ~10 min of upload)
    const dups = await client.rpc("duplicate_photos", { p_ids: subs.data.flatMap((s) => (s.photo_path ? [s.id] : [])) });
    if (dups.error) throw new Error(dups.error.message);
    const dup = new Set(dups.data);
    return subs.data.flatMap((s) => {
      const t = task.get(s.task_id);
      // tutors review tutor-reviewed nodes only; captain-reviewed ones belong to the captain
      if (!t || (t.reviewer === "captain" && me.role !== "captain")) return [];
      return [{ id: s.id, who: name.get(s.member_id) ?? "?", title: t.title, note: s.note, photo: (s.photo_path && url.get(s.photo_path)) || null, dup: dup.has(s.id), min: t.points_min, max: t.points_max }];
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
  if (items.length === 0)
    return (
      <div className="empty-state">
        <Icon name="inbox" size={40} />
        <p>Nothing waiting for review. Nice work!</p>
      </div>
    );

  // "Approve all" = each node's points_min (SDD §4); one bad row rolls the whole batch back
  const approveAll = async () => {
    setNotice(null);
    setBusy(true);
    // the RPC takes at most 200 ids; a row someone else reviewed meanwhile fails the batch, so reload and retry
    const { data, error } = await db().rpc("review_submissions", { p_ids: items.slice(0, 200).map((i) => i.id), p_approve: true });
    setBusy(false);
    const full = data?.filter((r) => r.result === "limit_reached").length ?? 0;
    if (error) setNotice(`${friendly(error.message)} The list was refreshed, try again.`);
    else if (full) setNotice(`${full} submission(s) skipped: ${friendly("limit_reached")}`);
    reload();
  };

  return (
    <>
      <div className="row">
        <h2 className="grow">Waiting for review ({items.length})</h2>
        <button type="button" disabled={busy} onClick={() => void approveAll()}>
          <Icon name="check" /> Approve all (min points)
        </button>
      </div>
      {notice && <p className="error">{notice}</p>}
      <ul className="queue">
        {items.map((item) => (
          <QueueRow key={item.id} item={item} onChanged={reload} />
        ))}
      </ul>
    </>
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
    if (approve) chime("lit");
    onChanged();
  };

  return (
    <li className="queue-item">
      <div>
        <strong>{item.title}</strong> · {item.who}
        {item.note && <p className="note">“{item.note}”</p>}
        {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL */}
        {item.photo && <img className="proof" src={item.photo} alt={`Proof photo from ${item.who}`} />}
        {item.dup && <p className="error">Same photo as another submission. Check before approving.</p>}
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
          <Icon name="x" /> Reject
        </button>
        <button type="button" className="primary" disabled={busy} onClick={() => void review(true)}>
          <Icon name="check" /> Approve {points}p
        </button>
      </div>
    </li>
  );
}
