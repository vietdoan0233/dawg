"use client";
import { useMemo } from "react";
import { useRoadmap } from "@/lib/roadmap";
import { Icon } from "./Icon";
import { Leaderboard } from "./Leaderboard";
import { SkillTree } from "./SkillTree";

// Projector: the guild's map without anyone's progress (keyholes stay locked until the captain reveals them)
// plus the live tutor-group leaderboard. Log the projector in as a fuksi: staff accounts see secrets unlocked.
export function ProjectorBoard({ guildId, guildName }: { guildId: number; guildName: string }) {
  const { map, error, news } = useRoadmap(guildId);
  const burst = useMemo(() => new Set((news?.revealed ?? []).map((id) => `n${id}`)), [news]);

  if (!map) return <div className="center-msg">{error ? <p className="error">{error}</p> : <p className="loading-rune">Loading the map…</p>}</div>;

  const secrets = map.nodes.filter((n) => n.locked).length;
  return (
    <div className="board">
      <SkillTree
        map={map}
        personal={false}
        fit
        burst={burst}
        hub={
          <div className="hub guild-hub">
            <Icon name="shield" size={40} />
            <span className="hub-tier">{guildName}</span>
            <span className="hub-next">{secrets ? `${secrets} secret task${secrets > 1 ? "s" : ""} left` : "All secrets revealed"}</span>
          </div>
        }
      />
      <aside className="board-side">
        <h2>
          <Icon name="trophy" /> Group leaderboard <span className="live">Live</span>
        </h2>
        <Leaderboard guildId={guildId} />
        {news && news.revealed.length > 0 && (
          <p key={news.n} className="toast secret">
            <Icon name="keyhole" size={18} /> A secret task has been revealed!
          </p>
        )}
      </aside>
    </div>
  );
}
