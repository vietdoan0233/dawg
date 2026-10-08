"use client";
import { useState } from "react";
import { db } from "@/lib/supabase";
import { Icon } from "./Icon";

// Demo project only: seeded users share one password (supabase/seed.sql). The pilot project has
// password sign-in disabled, so this cannot work there even if shipped.
const DEMO_PASSWORD = "demo-password";
const DEMO_USERS = [
  { label: "Fuksi 1", sub: "Complete tasks, earn points", icon: "star", email: "demo.fuksi.1@demo.invalid" },
  { label: "Fuksi 2", sub: "Complete tasks, earn points", icon: "star", email: "demo.fuksi.2@demo.invalid" },
  { label: "Fuksi 3", sub: "Complete tasks, earn points", icon: "star", email: "demo.fuksi.3@demo.invalid" },
  { label: "Tutor A", sub: "Approve fuksis' task proofs", icon: "inbox", email: "demo.tutor.a@demo.invalid" },
  { label: "Tutor B", sub: "Approve fuksis' task proofs", icon: "inbox", email: "demo.tutor.b@demo.invalid" },
  { label: "Organizer", sub: "Check people in at events", icon: "scan", email: "demo.organizer@demo.invalid" },
  { label: "Captain", sub: "Run the guild, reveal secret tasks", icon: "crown", email: "demo.captain@demo.invalid" },
];

export function DemoSwitcher({ current, compact = false }: { current?: string; compact?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (process.env.NEXT_PUBLIC_DEMO !== "1") return null;

  const logInAs = async (email: string) => {
    setError(null);
    setBusy(email);
    const { error } = await db().auth.signInWithPassword({ email, password: DEMO_PASSWORD });
    setBusy(null);
    if (error) setError(`Couldn't log in as this demo user. Please try again. (${error.message})`);
  };

  if (compact) {
    return (
      <select className="demo-compact" value="" aria-label="Switch to another demo user" onChange={(e) => e.target.value && void logInAs(e.target.value)}>
        <option value="">{current ? `Demo: ${current}` : "Switch user…"}</option>
        {DEMO_USERS.map((u) => (
          <option key={u.email} value={u.email}>
            {u.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <section className="characters" aria-label="Choose a demo user to try the app">
      <h2>Choose your character</h2>
      <div className="character-grid">
        {DEMO_USERS.map((u) => (
          <button key={u.email} type="button" className="character" aria-busy={busy === u.email} onClick={() => void logInAs(u.email)}>
            <Icon name={u.icon} size={28} />
            <strong>{u.label}</strong>
            <span>{u.sub}</span>
          </button>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
