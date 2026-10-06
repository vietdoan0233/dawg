"use client";
import { useCallback, useEffect, useState } from "react";
import { db } from "@/lib/supabase";
import { friendly } from "@/lib/roadmap";

type Secret = { id: number; title: string };

// Captain: unrevealed keyholes. Reveal = update_task(reveal); phones and the projector unlock on their next poll.
export function RevealPanel({ guildId }: { guildId: number }) {
  const [secrets, setSecrets] = useState<Secret[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    db()
      .from("tasks")
      .select("id, title")
      .eq("guild_id", guildId)
      .eq("active", true)
      .gt("revealed_at", new Date().toISOString())
      .order("id")
      .then(({ data, error }) => (error ? setError(error.message) : setSecrets(data)));
  }, [guildId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const reveal = async (id: number) => {
    setError(null);
    const { error } = await db().rpc("update_task", { p_task_id: id, p_reveal: true });
    if (error) setError(friendly(error.message));
    reload();
  };

  if (!secrets?.length && !error) return null;
  return (
    <section className="panel">
      <h2>🔒 Secret nodes</h2>
      {error && <p className="error">{error}</p>}
      <ul className="queue">
        {secrets?.map((s) => (
          <li key={s.id} className="row">
            <span className="grow">{s.title}</span>
            <button type="button" className="primary" onClick={() => void reveal(s.id)}>
              Reveal
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
