"use client";
import Link from "next/link";
import { DemoSwitcher } from "@/components/DemoSwitcher";
import { GuildSwitcher } from "@/components/GuildSwitcher";
import { MyCode } from "@/components/MyCode";
import { RevealPanel } from "@/components/RevealPanel";
import { ReviewQueue } from "@/components/ReviewQueue";
import { RoadmapCards } from "@/components/RoadmapCards";
import { Scanner } from "@/components/Scanner";
import { db } from "@/lib/supabase";
import { useMe } from "@/lib/useMe";

export default function Home() {
  const { loading, me, guilds, error, selectGuild } = useMe();

  return (
    <main>
      <header className="top">
        <h1>Fuksipisteet</h1>
        {me && (
          <p className="who">
            {me.name} · {me.role} · {me.guildName}
          </p>
        )}
        <DemoSwitcher current={me?.name} />
        {me && <GuildSwitcher guilds={guilds} current={me.guildId} onSelect={selectGuild} />}
        {me && (
          <div className="row">
            <Link href={`/board/${me.guildId}`}>Projector</Link>
            <button type="button" onClick={() => void db().auth.signOut()}>
              Log out
            </button>
          </div>
        )}
      </header>

      {loading && <p>Loading…</p>}
      {!loading && !me && (
        <p className={error ? "error" : undefined}>
          {error ?? (process.env.NEXT_PUBLIC_DEMO === "1" ? "Choose a demo user to start." : "Sign-in arrives in slice 2.")}
        </p>
      )}
      {/* key: remount per member, so switching users never shows the previous member's data */}
      {me?.role === "fuksi" && (
        <div key={me.memberId}>
          <MyCode guildId={me.guildId} />
          <RoadmapCards me={me} />
        </div>
      )}
      {me && me.role !== "fuksi" && (
        <div key={me.memberId} className="staff">
          {me.role === "captain" && <RevealPanel guildId={me.guildId} />}
          {me.role !== "organizer" && <ReviewQueue me={me} />}
          <Scanner guildId={me.guildId} memberId={me.memberId} />
        </div>
      )}
    </main>
  );
}
