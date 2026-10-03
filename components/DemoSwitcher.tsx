"use client";
import { useState } from "react";
import { db } from "@/lib/supabase";

// Demo project only: seeded users share one password (supabase/seed.sql). The pilot project has
// password sign-in disabled, so this cannot work there even if shipped.
const DEMO_PASSWORD = "demo-password";
const DEMO_USERS = [
  { label: "Fuksi 1 (Group A)", email: "demo.fuksi.1@demo.invalid" },
  { label: "Fuksi 2 (Group A)", email: "demo.fuksi.2@demo.invalid" },
  { label: "Fuksi 3 (Group B)", email: "demo.fuksi.3@demo.invalid" },
  { label: "Tutor A", email: "demo.tutor.a@demo.invalid" },
  { label: "Tutor B", email: "demo.tutor.b@demo.invalid" },
  { label: "Captain", email: "demo.captain@demo.invalid" },
];

export function DemoSwitcher({ current }: { current?: string }) {
  const [error, setError] = useState<string | null>(null);
  if (process.env.NEXT_PUBLIC_DEMO !== "1") return null;

  const logInAs = async (email: string) => {
    setError(null);
    const { error } = await db().auth.signInWithPassword({ email, password: DEMO_PASSWORD });
    if (error) setError(error.message);
  };

  return (
    <div className="demo">
      <label>
        Log in as
        <select value="" onChange={(e) => e.target.value && void logInAs(e.target.value)}>
          <option value="">{current ?? "choose a demo user…"}</option>
          {DEMO_USERS.map((u) => (
            <option key={u.email} value={u.email}>
              {u.label}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
