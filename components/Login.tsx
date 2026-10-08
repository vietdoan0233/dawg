"use client";
import { useState } from "react";
import { db } from "@/lib/supabase";

// Email 6-digit code (OTP). Only @aalto.fi can create an account: the auth hook in 0003_auth.sql enforces it,
// the check here only gives a faster message.
export function Login() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const e = email.trim().toLowerCase();
    if (!e.endsWith("@aalto.fi")) return setError("Please use your @aalto.fi email address.");
    setBusy(true);
    setError(null);
    const { error } = await db().auth.signInWithOtp({ email: e });
    setBusy(false);
    if (error)
      setError(
        /rate limit|security purposes/i.test(error.message)
          ? "Too many codes requested. Please wait a minute and try again."
          : `We couldn't send the code. Check your email address and try again. (${error.message})`,
      );
    else setSent(true);
  };

  // success fires onAuthStateChange, which every page already listens to
  const verify = async () => {
    setBusy(true);
    setError(null);
    const { error } = await db().auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error)
      setError(
        /expired|invalid/i.test(error.message)
          ? "That code is wrong or has expired. Check the email or send a new code."
          : `We couldn't log you in. Please try again. (${error.message})`,
      );
  };

  return (
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault();
        void (sent ? verify() : send());
      }}
    >
      <h2>Log in</h2>
      <label>
        Your Aalto email
        <input type="email" autoComplete="email" required disabled={sent} placeholder="firstname.lastname@aalto.fi" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      {sent && (
        <label>
          Enter the 6-digit code we sent to your email
          <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
      )}
      {sent && !error && <p className="hint">Check your inbox (and spam folder) for the code.</p>}
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? (sent ? "Checking…" : "Sending…") : sent ? "Log in" : "Send login code"}
        </button>
        {sent && (
          <button
            type="button"
            onClick={() => {
              setSent(false);
              setCode("");
            }}
          >
            Use another email
          </button>
        )}
      </div>
    </form>
  );
}
