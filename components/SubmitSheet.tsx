"use client";
import { useState } from "react";
import { db } from "@/lib/supabase";
import { friendly, pointsLabel, type OpenNode } from "@/lib/roadmap";

export function SubmitSheet({ node, onClose, onDone }: { node: OpenNode; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const { error } = await db().rpc("submit_task", { p_task_id: node.id, p_note: note.trim() || undefined });
    setBusy(false);
    if (error) setError(friendly(error.message));
    else onDone();
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
        {node.requires_photo && <p className="hint">This node needs a photo. Photo capture arrives in slice 4.</p>}
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={busy || node.requires_photo} onClick={() => void submit()}>
            {busy ? "Sending…" : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}
