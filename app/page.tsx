"use client";
import { DemoSwitcher } from "@/components/DemoSwitcher";
import { FuksiHome } from "@/components/FuksiHome";
import { Icon } from "@/components/Icon";
import { Login } from "@/components/Login";
import { StaffHome } from "@/components/StaffHome";
import { TopBar } from "@/components/TopBar";
import { db } from "@/lib/supabase";
import { useMe } from "@/lib/useMe";

export default function Home() {
  const { loading, me, guilds, error, selectGuild } = useMe();

  if (loading) {
    return (
      <div className="screen">
        <div className="center-msg">
          <p className="loading-rune">Loading…</p>
        </div>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="screen welcome">
        <TopBar me={null} />
        <main className="welcome-main">
          <div className="hero">
            <Icon name="crown" size={44} />
            <h1>Fuksipisteet</h1>
            <p>Your fuksi year as a skill tree. Go to events, light up nodes, climb to Teekkari.</p>
          </div>
          {error ? (
            <div className="panel">
              <p className="error">{error}</p>
              {/* logged in, but not (yet) in a guild: joining needs the captain's invite link */}
              {error.includes("not a member") && <p className="hint">Ask your guild captain for an invite link.</p>}
              <button type="button" onClick={() => void db().auth.signOut()}>
                Log out
              </button>
            </div>
          ) : process.env.NEXT_PUBLIC_DEMO === "1" ? (
            <DemoSwitcher />
          ) : (
            <Login />
          )}
        </main>
      </div>
    );
  }

  const bar = <TopBar me={me} guilds={guilds} onGuild={selectGuild} />;
  // key: remount per member, so switching users never shows the previous member's data
  return me.role === "fuksi" ? <FuksiHome key={me.memberId} me={me} bar={bar} /> : <StaffHome key={me.memberId} me={me} bar={bar} />;
}
