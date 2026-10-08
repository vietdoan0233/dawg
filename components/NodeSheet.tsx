"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { chime } from "@/lib/fx";
import { friendly, pointsLabel, type Category, type OpenNode } from "@/lib/roadmap";
import { db } from "@/lib/supabase";
import type { Me } from "@/lib/useMe";
import { Icon } from "./Icon";

export const nodeStatus = (node: OpenNode) =>
  (node.approved >= node.max_repeats
    ? "Completed"
    : node.pending > 0
      ? "Waiting for review"
      : node.approved > 0
        ? `Done ${node.approved}× · you can do it again`
        : "Not done yet") +
  (node.max_repeats > 1 ? ` · ${node.approved}/${node.max_repeats}` : "") +
  (node.reviewer === "tutor" ? " · checked by your tutor" : " · checked by the captain");

// SDD: redraw the photo on a canvas as a JPEG, longest side ≤1600 px. The canvas copies only pixels,
// so EXIF (GPS, device, time) never leaves the phone. Orientation is applied before it is dropped.
async function reencode(file: File): Promise<Blob> {
  const img = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => {
    throw new Error("Could not read this photo. Try a JPEG, PNG or WebP.");
  });
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#fff"; // JPEG has no alpha: transparent PNG/WebP areas would turn black
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
  img.close();
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.85));
  if (!blob) throw new Error("Could not read this photo. Try another one.");
  return blob;
}

// Node details + the evidence form in one sheet. Photo and note are optional unless the node itself
// requires them (tasks.requires_photo / requires_note, enforced again by submit_task). Submit is never
// greyed out: a missing required field is explained next to that field instead.
export function NodeSheet({ me, node, cat, onClose, onSent }: { me: Me; node: OpenNode; cat: Category; onClose: () => void; onSent: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field?: "note" | "photo"; text: string } | null>(null);

  // native <dialog>: showModal() gives the focus trap, Esc and an inert background for free
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  // revoke each preview URL once it is replaced or the sheet closes
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const canSubmit = node.approved + node.pending < node.max_repeats;

  const submit = async () => {
    if (busy) return; // the button stays enabled, so ignore a double tap while sending
    if (node.requires_note && !note.trim()) return setError({ field: "note", text: "Write the event name so your reviewer knows which event it was." });
    if (node.requires_photo && !photo) return setError({ field: "photo", text: "This task needs a photo." });
    setBusy(true);
    setError(null);
    try {
      let path: string | undefined;
      if (photo) {
        // the one direct client write (ARCHITECTURE-SIMPLE.md rule 1): into the caller's own <guild>/<member>/ folder.
        // No hash from the phone: the purge-photos job hashes the stored file for the duplicate flag.
        path = `${me.guildId}/${me.memberId}/${crypto.randomUUID()}`;
        const jpeg = await reencode(photo).catch((e: Error) => e);
        if (jpeg instanceof Error) return setError({ field: "photo", text: jpeg.message });
        const up = await db().storage.from("proofs").upload(path, jpeg, { contentType: "image/jpeg" });
        if (up.error) return setError({ field: "photo", text: up.error.message });
      }
      const { error } = await db().rpc("submit_task", {
        p_task_id: node.id,
        p_note: note.trim() || undefined,
        p_photo_path: path,
      });
      if (error) return setError({ text: friendly(error.message) });
      chime("send");
      onSent();
    } catch (e) {
      setError({ text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="node-title"
      style={{ "--c": cat.color } as CSSProperties}
      onCancel={(e) => {
        e.preventDefault(); // Esc: close through React state so the parent unmounts us
        if (!busy) onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()} // backdrop click
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <header className="sheet-head">
          <span className="track-chip">
            <Icon name={cat.icon} size={16} /> {cat.name}
          </span>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose} disabled={busy}>
            <Icon name="x" />
          </button>
        </header>

        <div className="sheet-title">
          <h2 id="node-title">{node.title}</h2>
          <p className="reward">
            <Icon name="sparkle" size={18} /> {pointsLabel(node)}
          </p>
        </div>

        <p className={`status-line${node.pending ? " wait" : node.approved ? " done" : ""}`}>{nodeStatus(node)}</p>
        {node.description && <p className="desc">{node.description}</p>}

        {canSubmit && (
          <>
            <label className="field">
              <span>
                {node.requires_note ? "Event name" : "Note for your reviewer"} {!node.requires_note && <em>optional</em>}
              </span>
              <textarea
                value={note}
                maxLength={500}
                rows={3}
                placeholder={node.requires_note ? "Which event did you go to?" : "What did you do? A short story helps your reviewer."}
                aria-invalid={error?.field === "note"}
                onChange={(e) => setNote(e.target.value)}
              />
              {error?.field === "note" && (
                <span className="error" role="alert">
                  {error.text}
                </span>
              )}
            </label>

            <label className={`drop${preview ? " has" : ""}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
              {preview ? <img src={preview} alt="" /> : <Icon name="camera" size={28} />}
              <span>
                {photo ? photo.name : "Add a photo"} {!node.requires_photo && !photo && <em>optional</em>}
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-invalid={error?.field === "photo"}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  setPhoto(file);
                  setPreview(file && URL.createObjectURL(file));
                }}
              />
            </label>
            {error?.field === "photo" && (
              <p className="error" role="alert">
                {error.text}
              </p>
            )}
            <p className="hint">Don&apos;t upload transcripts, ID cards or other personal documents.</p>
          </>
        )}

        {error && !error.field && (
          <p className="error" role="alert">
            {error.text}
          </p>
        )}

        <div className="sheet-actions">
          {canSubmit ? (
            <button type="submit" className="primary big" aria-busy={busy}>
              <Icon name="send" /> {busy ? "Sending…" : "Submit proof"}
            </button>
          ) : (
            <button type="button" className="big" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}
