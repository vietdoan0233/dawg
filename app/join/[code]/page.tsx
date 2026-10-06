"use client";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Login } from "@/components/Login";
import { friendly } from "@/lib/roadmap";
import { db } from "@/lib/supabase";

// Invite link: log in with the aalto.fi code, then join_guild claims the roster row or makes a fuksi.
export default function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { data } = db().auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session);
      if (!session) return;
      // never await supabase calls inside this callback (auth lock); defer them
      setTimeout(() => {
        db()
          .rpc("join_guild", { p_code: code })
          .then(({ error }) => (error ? setError(friendly(error.message)) : router.replace("/")));
      }, 0);
    });
    return () => data.subscription.unsubscribe();
  }, [code, router]);

  return (
    <main>
      <header className="top">
        <h1>Join your guild</h1>
      </header>
      {signedIn === false && <Login />}
      {signedIn && !error && <p>Joining…</p>}
      {error && (
        <div className="panel">
          <p className="error">{error}</p>
          <button type="button" onClick={() => void db().auth.signOut().then(() => setError(null))}>
            Log out and use another email
          </button>
        </div>
      )}
    </main>
  );
}
