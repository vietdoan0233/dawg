"use client";
import { useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { isMuted, setMuted, subscribeMuted } from "@/lib/fx";
import { db } from "@/lib/supabase";
import type { GuildRef, Me } from "@/lib/useMe";
import { DemoSwitcher } from "./DemoSwitcher";
import { GuildSwitcher } from "./GuildSwitcher";
import { Icon } from "./Icon";

export function TopBar({ me, guilds, onGuild, children }: { me: Me | null; guilds?: GuildRef[]; onGuild?: (id: number) => void; children?: ReactNode }) {
  const muted = useSyncExternalStore(subscribeMuted, isMuted, () => false);
  return (
    <header className="topbar">
      <Link href="/" className="brand">
        <Icon name="crown" size={22} />
        <span>Fuksipisteet</span>
      </Link>
      {me && (
        <span className="who">
          <span className="guild">{me.guildName}</span>
          <b>{me.name}</b>
          <span className="role">{me.role}</span>
        </span>
      )}
      <div className="topbar-actions">
        {children}
        {me && guilds && onGuild && <GuildSwitcher guilds={guilds} current={me.guildId} onSelect={onGuild} />}
        {me && <DemoSwitcher compact current={me.name} />}
        <button type="button" className="icon-btn" aria-label={muted ? "Turn sounds on" : "Mute sounds"} aria-pressed={muted} onClick={() => setMuted(!muted)}>
          <Icon name={muted ? "mute" : "sound"} />
        </button>
        {me && (
          <button type="button" className="icon-btn" aria-label="Log out" onClick={() => void db().auth.signOut()}>
            <Icon name="logout" />
          </button>
        )}
      </div>
    </header>
  );
}
