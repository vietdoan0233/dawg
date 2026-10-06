"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { db } from "@/lib/supabase";

// The fuksi's personal QR. The organizer scans it at an event (there is no event QR).
export function MyCode({ guildId }: { guildId: number }) {
  const [img, setImg] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || code) return;
    db()
      .rpc("my_code", { p_guild_id: guildId })
      .then(({ data, error }) => (error || !data ? setError(error?.message ?? "No code yet.") : setCode(data)));
  }, [open, code, guildId]);

  useEffect(() => {
    if (code) QRCode.toDataURL(code, { width: 280, margin: 2 }).then(setImg, (e: Error) => setError(e.message));
  }, [code]);

  // the old code stops working at once (rotate_my_code)
  const rotate = async () => {
    const { data, error } = await db().rpc("rotate_my_code", { p_guild_id: guildId });
    if (error || !data) return setError(error?.message ?? "Could not make a new code.");
    setCode(data);
  };

  return (
    <section className="mycode">
      <button type="button" className="primary" onClick={() => setOpen(!open)}>
        {open ? "Hide my QR" : "Show my QR"}
      </button>
      {open && error && <p className="error">{error}</p>}
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL, nothing to optimise */}
      {open && img && <img src={img} alt="My check-in QR code" width={280} height={280} />}
      {open && code && <p className="hint">Code: <code>{code}</code></p>}
      {open && code && (
        <button type="button" onClick={() => void rotate()}>
          Lost your phone or shared the code? Make a new one
        </button>
      )}
    </section>
  );
}
