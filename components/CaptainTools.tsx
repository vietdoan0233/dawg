"use client";
import { useCallback, useEffect, useState } from "react";
import { db } from "@/lib/supabase";
import { friendly } from "@/lib/roadmap";
import type { Me, Role } from "@/lib/useMe";

type Invite = { code: string; max_uses: number; used_count: number; expires_at: string; revoked_at: string | null };

// Invite links only ever make fuksis (join_guild); roles change here, through set_role.
export function InvitePanel({ guildId }: { guildId: number }) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    db()
      .rpc("list_invites", { p_guild_id: guildId })
      .then(({ data, error }) => {
        if (error) return setError(friendly(error.message));
        // only links that still work
        setInvites(data.filter((i) => !i.revoked_at && Date.parse(i.expires_at) > Date.now() && i.used_count < i.max_uses));
      });
  }, [guildId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const call = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    setError(null);
    const { error } = await p;
    if (error) setError(friendly(error.message));
    reload();
  };

  const link = (code: string) => `${window.location.origin}/join/${code}`;

  return (
    <section className="panel">
      <h2>Invite links</h2>
      <p className="hint">Anyone with a link and an @aalto.fi email joins as a fuksi.</p>
      <button type="button" className="primary" onClick={() => void call(db().rpc("create_invite", { p_guild_id: guildId }))}>
        New invite link
      </button>
      {error && <p className="error">{error}</p>}
      <ul className="queue">
        {invites.map((i) => (
          <li key={i.code} className="row">
            <code className="grow">{link(i.code)}</code>
            <span className="hint">
              {i.used_count}/{i.max_uses} · until {new Date(i.expires_at).toLocaleDateString()}
            </span>
            <button type="button" onClick={() => void navigator.clipboard.writeText(link(i.code))}>
              Copy
            </button>
            <button type="button" onClick={() => void call(db().rpc("revoke_invite", { p_code: i.code }))}>
              Revoke
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Row = { id: number; display_name: string; role: Role; tutor_group_id: number | null };
const ROLES: Role[] = ["fuksi", "tutor", "organizer", "captain"];

export function RolesPanel({ me }: { me: Me }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [groups, setGroups] = useState<{ id: number; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    const client = db();
    Promise.all([
      client.from("members").select("id, display_name, role, tutor_group_id").eq("guild_id", me.guildId).order("display_name"),
      client.from("tutor_groups").select("id, name").eq("guild_id", me.guildId).order("name"),
    ]).then(([m, g]) => {
      if (m.error || g.error) return setError((m.error ?? g.error)!.message);
      setRows(m.data as Row[]);
      setGroups(g.data);
    });
  }, [me.guildId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const save = async (r: Row, role: Role, group: number | null) => {
    setError(null);
    const { error } = await db().rpc("set_role", { p_member_id: r.id, p_role: role, p_tutor_group_id: group ?? undefined });
    if (error) setError(friendly(error.message));
    reload();
  };

  return (
    <section className="panel">
      <h2>People & roles</h2>
      {error && <p className="error">{error}</p>}
      <ul className="queue">
        {rows.map((r) => (
          <li key={r.id} className="row">
            <span className="grow">{r.display_name}</span>
            {r.id === me.memberId ? (
              <span className="hint">{r.role} (you)</span>
            ) : (
              <>
                <select aria-label={`Role of ${r.display_name}`} value={r.role} onChange={(e) => void save(r, e.target.value as Role, r.tutor_group_id)}>
                  {ROLES.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
                <select
                  aria-label={`Tutor group of ${r.display_name}`}
                  value={r.tutor_group_id ?? ""}
                  onChange={(e) => void save(r, r.role, e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">no group</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
