"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import type { Me } from "@/lib/useMe";
import { InvitePanel, RolesPanel, ImportExportPanel } from "./CaptainTools";
import { Icon } from "./Icon";
import { Leaderboard } from "./Leaderboard";
import { RevealPanel } from "./RevealPanel";
import { ReviewQueue } from "./ReviewQueue";
import { Scanner } from "./Scanner";

type Tab = { id: string; label: string; icon: string; show: boolean; body: () => ReactNode };

// Tutors review, organizers scan, captains do both plus reveals, invites and roles. One tab at a time.
export function StaffHome({ me, bar }: { me: Me; bar: ReactNode }) {
  const tabs: Tab[] = [
    { id: "review", label: "Review", icon: "inbox", show: me.role !== "organizer", body: () => <ReviewQueue me={me} /> },
    { id: "scan", label: "Check-in", icon: "scan", show: true, body: () => <Scanner guildId={me.guildId} memberId={me.memberId} /> },
    { id: "ranks", label: "Ranks", icon: "trophy", show: true, body: () => <Leaderboard guildId={me.guildId} /> },
    { id: "secrets", label: "Secrets", icon: "keyhole", show: me.role === "captain", body: () => <RevealPanel guildId={me.guildId} /> },
    {
      id: "people",
      label: "People",
      icon: "users",
      show: me.role === "captain",
      body: () => (
        <>
          <InvitePanel guildId={me.guildId} />
          <RolesPanel me={me} />
        </>
      ),
    },
    {
      id: "import-export",
      label: "Import/Export",
      icon: "download",
      show: me.role === "captain",
      body: () => <ImportExportPanel guildId={me.guildId} />,
    },
  ].filter((t) => t.show);
  const [tab, setTab] = useState(tabs[0].id);
  const current = tabs.find((t) => t.id === tab) ?? tabs[0];

  return (
    <div className="screen staff">
      {bar}
      <nav className="tabs" role="tablist" aria-label="Staff tools">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={t.id === current.id} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} />
            <span>{t.label}</span>
          </button>
        ))}
        <Link className="tab-link" href={`/board/${me.guildId}`}>
          <Icon name="map" />
          <span>Projector</span>
        </Link>
      </nav>
      {/* key: remount per tab so the page-in animation replays */}
      <main key={current.id} className="staff-main" role="tabpanel" aria-label={current.label}>
        {current.body()}
      </main>
    </div>
  );
}
