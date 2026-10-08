// Photo job (SDD §5 retention, slice 4), run every 10 min by pg_cron (0007_photo_checkin_hardening.sql):
// 1. hash: SHA-256 of each new stored photo, so the duplicate flag never trusts a hash the phone sent;
// 2. purge: photos older than 30 days and unreferenced uploads leave storage (purge_photos() clears photo_path first).
// Hash before purge, so a photo is hashed before it can be deleted.
// Secret: PURGE_PHOTOS_SECRET (`supabase secrets set`), the same value as the Vault secret purge_photos_secret.
// verify_jwt is off for this function (config.toml): the caller is pg_cron, authenticated by that secret.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const BATCH = 50; // photos hashed per run (≤10 MB each, well inside the 60 s pg_net timeout); the rest wait 10 minutes
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

Deno.serve(async (req) => {
  const secret = Deno.env.get("PURGE_PHOTOS_SECRET");
  if (!secret || req.headers.get("Authorization") !== `Bearer ${secret}`) return reply(401, { error: "unauthorized" });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const proofs = admin.storage.from("proofs");

  // newest first: the ones reviewers are about to see, and a row whose download keeps failing can't starve them
  const todo = await admin.from("submissions").select("id, photo_path")
    .is("photo_sha256", null).not("photo_path", "is", null).order("id", { ascending: false }).limit(BATCH);
  if (todo.error) return reply(500, { error: "todo", detail: todo.error.message });
  let hashed = 0;
  for (const s of todo.data) {
    const file = await proofs.download(s.photo_path!);
    if (file.error) {
      console.error("purge-photos download", s.id, file.error.message);
      continue;
    }
    const sha = hex(await crypto.subtle.digest("SHA-256", await file.data.arrayBuffer()));
    // only if the row still points at the file that was hashed
    const set = await admin.from("submissions").update({ photo_sha256: sha }).eq("id", s.id).eq("photo_path", s.photo_path!);
    if (set.error) return reply(500, { error: "hash", detail: set.error.message });
    hashed++;
  }

  const due = await admin.rpc("purge_photos");
  if (due.error) return reply(500, { error: "purge", detail: due.error.message });
  if (due.data.length) {
    const removed = await proofs.remove(due.data);
    if (removed.error) return reply(500, { error: "remove", detail: removed.error.message });
  }
  return reply(200, { hashed, purged: due.data.length });
});
