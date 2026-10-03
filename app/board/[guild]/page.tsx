"use client";
import { use } from "react";
import Link from "next/link";
import { DemoSwitcher } from "@/components/DemoSwitcher";
import { ProjectorBoard } from "@/components/ProjectorBoard";
import { useMe } from "@/lib/useMe";

export default function BoardPage({ params }: { params: Promise<{ guild: string }> }) {
  const guildId = Number(use(params).guild);
  const { loading, me, error } = useMe(guildId);

  return (
    <main className="wide">
      <header className="top">
        <h1>{me ? me.guildName : "Fuksipisteet"}</h1>
        <DemoSwitcher current={me?.name} />
        <Link href="/">Home</Link>
      </header>
      {loading && <p>Loading…</p>}
      {!loading && !me && <p className={error ? "error" : undefined}>{error ?? "Log in to show the board."}</p>}
      {me && Number.isInteger(guildId) && me.guildId === guildId && <ProjectorBoard guildId={guildId} />}
      {me && me.guildId !== guildId && <p className="error">This account is not a member of that guild.</p>}
    </main>
  );
}
