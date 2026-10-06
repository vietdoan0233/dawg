"use client";
import { useState } from "react";
import { db } from "@/lib/supabase";
import { friendly, pointsLabel, type OpenNode } from "@/lib/roadmap";
import type { Me } from "@/lib/useMe";

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

export function SubmitSheet({ me, node, onClose, onDone }: { me: Me; node: OpenNode; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      let path: string | undefined;
      let sha: string | undefined;
      if (photo) {
        // the one direct client write (ARCHITECTURE-SIMPLE.md rule 1): into the caller's own <guild>/<member>/ folder
        // ponytail: the hash is computed on the phone, so the duplicate check trusts it; slice 4 moves it server-side.
        // crypto.subtle needs https or localhost: on plain-http LAN this throws and shows the error below.
        sha = hex(await crypto.subtle.digest("SHA-256", await photo.arrayBuffer()));
        path = `${me.guildId}/${me.memberId}/${crypto.randomUUID()}`;
        const up = await db().storage.from("proofs").upload(path, photo, { contentType: photo.type });
        if (up.error) return setError(up.error.message);
      }
      const { error } = await db().rpc("submit_task", {
        p_task_id: node.id,
        p_note: note.trim() || undefined,
        p_photo_path: path,
        p_photo_sha256: sha,
      });
      if (error) setError(friendly(error.message));
      else onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={node.title} onClick={(e) => e.stopPropagation()}>
        <h3>{node.title}</h3>
        <p className="pts">
          {pointsLabel(node)} · reviewed by {node.reviewer}
        </p>
        {node.description && <p>{node.description}</p>}
        <label>
          {node.requires_note ? "Event name" : "Note (optional)"}
          <textarea value={note} maxLength={500} rows={3} onChange={(e) => setNote(e.target.value)} />
        </label>
        <label>
          {node.requires_photo ? "Photo proof" : "Photo (optional)"}
          <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </label>
        <p className="hint">Never upload transcripts or ID documents.</p>
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || (node.requires_photo && !photo) || (node.requires_note && !note.trim())}
            onClick={() => void submit()}
          >
            {busy ? "Sending…" : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}
