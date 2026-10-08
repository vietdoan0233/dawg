"use client";
import { use } from "react";
import { ProjectorBoard } from "@/components/ProjectorBoard";
import { TopBar } from "@/components/TopBar";
import { useMe } from "@/lib/useMe";

export default function BoardPage({ params }: { params: Promise<{ guild: string }> }) {
  const guildId = Number(use(params).guild);
  const { loading, me, error } = useMe(guildId);

  return (
    <div className="screen projector">
      <TopBar me={me} />
      {loading && <div className="center-msg"><p className="loading-rune">Loading the board…</p></div>}
      {!loading && !me && <div className="center-msg"><p className={error ? "error" : undefined}>{error ?? "Log in on the home page first, then reload this page to show the board."}</p></div>}
      {me && Number.isInteger(guildId) && me.guildId === guildId && <ProjectorBoard guildId={guildId} guildName={me.guildName} />}
      {me && me.guildId !== guildId && <div className="center-msg"><p className="error">You&apos;re not a member of this guild. Log in with an account from this guild to show its board.</p></div>}
    </div>
  );
}
