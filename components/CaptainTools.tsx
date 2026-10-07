"use client";
import { useCallback, useEffect, useRef, useState } from "react";
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

export function ImportExportPanel({ guildId }: { guildId: number }) {
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<Record<string, unknown>[] | null>(null);
  const [importMapping, setImportMapping] = useState<Record<string, string> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [csvContent, setCsvContent] = useState<string | null>(null);

  const handleImportFile = async (file: File) => {
    setError(null);
    setImporting(true);
    try {
      const content = await file.text();
      setCsvContent(content);

      // Step 1: Get mapping preview
      const response = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guild_id: guildId, csv_content: content }),
      });
      const result = (await response.json()) as {
        status: string;
        preview?: Record<string, unknown>[];
        mapping?: Record<string, string>;
        message?: string;
      };
      if (result.status === "error") {
        setError(result.message || "Import failed");
      } else {
        setImportPreview(result.preview || []);
        setImportMapping(result.mapping || {});
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const handleApplyImport = async () => {
    if (!importMapping || !csvContent) return;
    setError(null);
    setImporting(true);
    try {
      // Step 2: Apply with confirmed mapping
      const response = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guild_id: guildId,
          csv_content: csvContent,
          mapping: importMapping,
          confirm: true,
        }),
      });
      const result = (await response.json()) as { status: string; message?: string };
      if (result.status === "error") {
        setError(result.message || "Import application failed");
      } else {
        setError("Import completed successfully!");
        setImportPreview(null);
        setImportMapping(null);
        setCsvContent(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import application failed");
    } finally {
      setImporting(false);
    }
  };

  const handleExport = async () => {
    setError(null);
    setExporting(true);
    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guild_id: guildId }),
      });
      const result = (await response.json()) as { status: string; csv?: string; message?: string };
      if (result.status === "error") {
        setError(result.message || "Export failed");
      } else if (result.csv) {
        // Download CSV
        const blob = new Blob([result.csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `export-${new Date().toISOString().split("T")[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <section className="panel">
        <h2>Import</h2>
        <p className="hint">Upload a CSV with categories, tasks, tiers, members, and opening balances.</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={(e) => e.target.files?.[0] && void handleImportFile(e.target.files[0])}
          disabled={importing}
          style={{ display: "none" }}
        />
        <button
          type="button"
          className="primary"
          onClick={() => fileInputRef.current?.click()}
          disabled={importing || !!importPreview}
        >
          {importing ? "Processing..." : "Choose CSV file"}
        </button>
        {error && <p className="error">{error}</p>}
        {importPreview && (
          <>
            <h3>Preview</h3>
            <p className="hint">Column mapping detected by AI. Review before applying.</p>
            <div style={{ overflowX: "auto", marginBottom: "1rem" }}>
              <table style={{ fontSize: "0.875rem" }}>
                <thead>
                  <tr>
                    {Object.keys(importPreview[0] || {}).map((k) => (
                      <th key={k}>{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {importPreview.map((row, i) => (
                    <tr key={i}>
                      {Object.values(row).map((v, j) => (
                        <td key={j}>{String(v)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details style={{ marginBottom: "1rem" }}>
              <summary>Detected column mapping</summary>
              <pre style={{ fontSize: "0.75rem", whiteSpace: "pre-wrap" }}>{JSON.stringify(importMapping, null, 2)}</pre>
            </details>
            <button type="button" className="primary" onClick={handleApplyImport} disabled={importing}>
              {importing ? "Applying..." : "Apply import"}
            </button>
            <button
              type="button"
              onClick={() => {
                setImportPreview(null);
                setImportMapping(null);
                setCsvContent(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            >
              Cancel
            </button>
          </>
        )}
      </section>

      <section className="panel">
        <h2>Export</h2>
        <p className="hint">Download current roster as member × category matrix with tiers.</p>
        <button type="button" className="primary" onClick={handleExport} disabled={exporting}>
          {exporting ? "Generating..." : "Download CSV"}
        </button>
      </section>
    </>
  );
}
