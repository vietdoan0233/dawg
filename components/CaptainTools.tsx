"use client";
import { useCallback, useEffect, useState } from "react";
import { db } from "@/lib/supabase";
import { guessTarget, parseCsv, toCsv, type Target } from "@/lib/csv";
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
      <p className="hint">
        Share a link in your fuksi group chat. Anyone who opens it and logs in with an @aalto.fi email joins your guild as a fuksi.
      </p>
      <button type="button" className="primary" onClick={() => void call(db().rpc("create_invite", { p_guild_id: guildId }))}>
        Create invite link
      </button>
      {invites.length === 0 && !error && <p className="hint">No active links. Create one to invite people.</p>}
      {error && <p className="error">{error}</p>}
      <ul className="queue">
        {invites.map((i) => (
          <li key={i.code} className="row">
            <code className="grow">{link(i.code)}</code>
            <span className="hint">
              Used {i.used_count} of {i.max_uses} · expires {new Date(i.expires_at).toLocaleDateString()}
            </span>
            <button type="button" onClick={() => void navigator.clipboard.writeText(link(i.code))}>
              Copy link
            </button>
            <button type="button" onClick={() => void call(db().rpc("revoke_invite", { p_code: i.code }))}>
              Disable link
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Row = { id: number; display_name: string; role: Role };
const ROLES: Role[] = ["fuksi", "tutor", "organizer", "captain"];
const ROLE_LABEL: Record<Role, string> = { fuksi: "Fuksi", tutor: "Tutor", organizer: "Organizer", captain: "Captain" };

export function RolesPanel({ me }: { me: Me }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    db()
      .from("members")
      .select("id, display_name, role")
      .eq("guild_id", me.guildId)
      .order("display_name")
      .then(({ data, error }) => (error ? setError(error.message) : setRows(data as Row[])));
  }, [me.guildId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const save = async (r: Row, role: Role) => {
    setError(null);
    const { error } = await db().rpc("set_role", { p_member_id: r.id, p_role: role });
    if (error) setError(friendly(error.message));
    reload();
  };

  return (
    <section className="panel">
      <h2>Members and roles</h2>
      <p className="hint">
        Tutors review proofs from every fuksi in the guild, organizers check people in at events, and captains manage the guild.
        Changes save immediately.
      </p>
      {error && <p className="error">{error}</p>}
      <ul className="queue">
        {rows.map((r) => (
          <li key={r.id} className="row">
            <span className="grow">{r.display_name}</span>
            {r.id === me.memberId ? (
              <span className="hint">{ROLE_LABEL[r.role]} (you)</span>
            ) : (
              <select aria-label={`Role of ${r.display_name}`} value={r.role} onChange={(e) => void save(r, e.target.value as Role)}>
                {ROLES.map((x) => (
                  <option key={x} value={x}>
                    {ROLE_LABEL[x]}
                  </option>
                ))}
              </select>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

const MAX_ROWS = 2000;
// PostgREST returns at most 1000 rows per request (config.toml max_rows): fetch page by page.
async function everyRow<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}
const download = (name: string, text: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
};

// Roster import (email, name, opening points per category) and results export, both in the browser.
// Only column headers ever leave it, for AI mapping (map-columns); the rows go straight to import_apply.
export function ImportExportPanel({ guildId }: { guildId: number }) {
  const [categories, setCategories] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][] | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    db()
      .from("categories")
      .select("name")
      .eq("guild_id", guildId)
      .order("id")
      .then(({ data, error }) => (error ? setError(error.message) : setCategories(data.map((c) => c.name))));
  }, [guildId]);

  const pick = async (file: File) => {
    setError(null);
    setNote(null);
    if (file.size > 1_000_000) return setError("This file is larger than 1 MB. Save only the sheet with your fuksi list as CSV and try again.");
    const parsed = parseCsv(await file.text());
    if (parsed.length < 2) return setError("This file needs a row of column names followed by at least one person.");
    if (parsed.length - 1 > MAX_ROWS) return setError(`You can import up to ${MAX_ROWS} people at a time. Split the file and import it in parts.`);
    if (parsed[0].some((h) => h.includes("@"))) return setError("The first row should contain column names (like \"Email\" or \"Name\"), not a person.");
    setBusy(true);
    const guesses = parsed[0].map((h) => guessTarget(h, categories));
    const unknown = parsed[0].filter((_, i) => !guesses[i]);
    let ai: Record<string, Target> = {};
    if (unknown.length) {
      const { data } = await db().functions.invoke<{ mapping: Record<string, Target> }>("map-columns", {
        body: { guild_id: guildId, headers: unknown, categories },
      });
      if (data) ai = data.mapping;
      else setNote("Automatic suggestions aren't available right now. Please choose the remaining columns yourself.");
    }
    setBusy(false);
    setRows(parsed);
    setTargets(parsed[0].map((h, i) => guesses[i] ?? ai[h] ?? "skip"));
  };

  const apply = async () => {
    if (!rows) return;
    setError(null);
    setNote(null);
    const col = (t: Target) => targets.indexOf(t);
    if (targets.filter((t) => t === "email").length !== 1) return setError("Choose exactly one column as \"Email address\".");
    const people = rows.slice(1);
    const members = people.map((r) => ({
      email: r[col("email")],
      display_name: col("name") >= 0 ? r[col("name")] : "",
    }));
    const adjustments: { email: string; category_name: string; points: number }[] = [];
    for (const [n, r] of people.entries())
      for (const [i, t] of targets.entries()) {
        if (!t.startsWith("category:") || !r[i]) continue;
        const points = Number(r[i]);
        if (!Number.isInteger(points)) return setError(`Row ${n + 2}: "${r[i]}" in the column "${rows[0][i]}" should be a whole number of points.`);
        adjustments.push({ email: r[col("email")], category_name: t.slice("category:".length), points });
      }
    setBusy(true);
    const { data, error } = await db().rpc("import_apply", {
      p_guild_id: guildId,
      p_categories: [],
      p_tasks: [],
      p_tiers: [],
      p_rules: [],
      p_members: members,
      p_adjustments: adjustments,
    });
    setBusy(false);
    if (error) return setError(friendly(error.message));
    const done = data as { members: number; adjustments: number };
    setNote(
      `Done! Added ${done.members} ${done.members === 1 ? "person" : "people"} and ${done.adjustments} starting point ${done.adjustments === 1 ? "balance" : "balances"}. Next, send them an invite link from the People tab so they can log in.`,
    );
    setRows(null);
  };

  const exportCsv = async () => {
    setError(null);
    setBusy(true);
    const c = db();
    // progress/member_tier have no guild_id; rows of the caller's other guilds are dropped by the member lookup below
    const all = Promise.all([
      everyRow((a, b) => c.from("members").select("id, display_name, role").eq("guild_id", guildId).order("display_name").order("id").range(a, b)),
      everyRow((a, b) => c.from("categories").select("id, name").eq("guild_id", guildId).order("id").range(a, b)),
      everyRow((a, b) => c.from("tiers").select("id, name").eq("guild_id", guildId).order("id").range(a, b)),
      everyRow((a, b) => c.from("progress").select("member_id, category_id, points").order("member_id").order("category_id").range(a, b)),
      everyRow((a, b) => c.from("member_tier").select("member_id, tier_id").order("member_id").range(a, b)),
    ]);
    let data: Awaited<typeof all>;
    try {
      data = await all;
    } catch (e) {
      return setError((e as Error).message);
    } finally {
      setBusy(false);
    }
    const [m, cats, t, p, mt] = data;
    const pts = new Map(p.map((r) => [`${r.member_id}:${r.category_id}`, r.points ?? 0]));
    const tierOf = new Map(mt.map((r) => [r.member_id, t.find((x) => x.id === r.tier_id)?.name ?? ""]));
    const header = ["Name", "Role", ...cats.map((x) => x.name), "Total points", "Level"];
    const body = m.map((x) => {
      const per = cats.map((cat) => pts.get(`${x.id}:${cat.id}`) ?? 0);
      const total = per.reduce((a, b) => a + b, 0);
      return [x.display_name, x.role, ...per, total, tierOf.get(x.id) ?? ""];
    });
    download(`fuksipisteet-${new Date().toISOString().slice(0, 10)}.csv`, toCsv([header, ...body]));
  };

  return (
    <>
      <section className="panel">
        <h2>Add people from a spreadsheet</h2>
        {!rows && (
          <>
            <p className="hint">Already tracking fuksis in Excel or Google Sheets? Bring them in instead of adding everyone by hand.</p>
            <ol className="hint">
              <li>Save your sheet as a CSV file (in Excel: File → Save As → CSV).</li>
              <li>Choose the file below. Nothing is saved until you press Import.</li>
              <li>Tell us what each column contains, then press Import.</li>
            </ol>
            <p className="hint">
              One row per person with at least an @aalto.fi email address. Columns with points they have already earned become
              their starting points. Importing the same file again won&apos;t create duplicates. Everyone is added as a fuksi;
              give staff roles under People.
            </p>
            <label className="row">
              {busy ? "Reading the file…" : "Choose a CSV file"}
              <input type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => e.target.files?.[0] && void pick(e.target.files[0])} />
            </label>
          </>
        )}
        {rows && (
          <>
            <p className="hint">
              Found <strong>{rows.length - 1} {rows.length - 1 === 1 ? "person" : "people"}</strong>. For each column in your file,
              choose what it contains. We filled in what we could recognise; please check before importing.
            </p>
            <ul className="queue">
              {rows[0].map((h, i) => (
                <li key={i} className="row">
                  <span className="grow">
                    {h} <span className="hint">Example: {rows[1][i] || "(empty)"}</span>
                  </span>
                  <select
                    aria-label={`What the column "${h}" contains`}
                    value={targets[i]}
                    onChange={(e) => setTargets(targets.map((t, j) => (j === i ? (e.target.value as Target) : t)))}
                  >
                    <option value="skip">Don&apos;t import this column</option>
                    <option value="email">Email address</option>
                    <option value="name">Full name</option>
                    {categories.map((c) => (
                      <option key={c} value={`category:${c}`}>
                        Starting points: {c}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
            <div className="row">
              <button type="button" className="primary" disabled={busy} onClick={() => void apply()}>
                {busy ? "Importing…" : `Import ${rows.length - 1} ${rows.length - 1 === 1 ? "person" : "people"}`}
              </button>
              <button type="button" disabled={busy} onClick={() => setRows(null)}>
                Cancel
              </button>
            </div>
          </>
        )}
        {note && <p className="hint">{note}</p>}
        {error && <p className="error">{error}</p>}
      </section>

      <section className="panel">
        <h2>Download results</h2>
        <p className="hint">A spreadsheet of every member with their points per category, total points and level. Opens in Excel or Google Sheets.</p>
        <button type="button" className="primary" disabled={busy} onClick={() => void exportCsv()}>
          Download spreadsheet
        </button>
      </section>
    </>
  );
}
