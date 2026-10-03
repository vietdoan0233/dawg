"use client";
import type { GuildRef } from "@/lib/useMe";

// Only shown to people who belong to more than one guild.
export function GuildSwitcher({ guilds, current, onSelect }: { guilds: GuildRef[]; current: number; onSelect: (id: number) => void }) {
  if (guilds.length < 2) return null;
  return (
    <label className="guild-switch">
      Guild
      <select value={current} onChange={(e) => onSelect(Number(e.target.value))}>
        {guilds.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
    </label>
  );
}
