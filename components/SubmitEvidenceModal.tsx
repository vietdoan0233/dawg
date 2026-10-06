"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { TreeNode } from "@/lib/skillTree";

// Native <dialog>: showModal() gives the focus trap, Esc-to-close and inert background for free.
export function SubmitEvidenceModal({
  node,
  onCancel,
  onSubmit,
}: {
  node: TreeNode;
  onCancel: () => void;
  onSubmit: (text: string, file: File | null) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(text.trim(), file);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={ref}
      className="tree-modal"
      aria-labelledby="evidence-title"
      style={{ "--c": node.color } as CSSProperties}
      onCancel={(e) => {
        e.preventDefault(); // Esc: close through React state so the parent unmounts us
        if (!busy) onCancel();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <header>
          <p className="tree-modal-kicker">Submit evidence to tutor</p>
          <h2 id="evidence-title">{node.title}</h2>
          <p className="tree-modal-reward">+{node.points}p when approved</p>
        </header>

        <label>
          What did you do? (required)
          <textarea required maxLength={500} rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="How you completed it, or something funny for your tutor" />
        </label>

        <label className="tree-drop">
          <span>{file ? file.name : "Add a photo, video or document (optional)"}</span>
          <input type="file" accept="image/*,video/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <p className="hint">Never upload transcripts or ID documents.</p>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="row tree-modal-actions">
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy || !text.trim()}>
            {busy ? "Sending…" : "Submit to tutor"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
