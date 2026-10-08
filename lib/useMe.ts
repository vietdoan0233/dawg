"use client";
import { useEffect, useState } from "react";
import { db } from "@/lib/supabase";
import { loadRoadmap } from "@/lib/roadmap";

export type Role = "fuksi" | "tutor" | "organizer" | "captain";
export type GuildRef = { id: number; name: string };
export type Me = { guildId: number; guildName: string; memberId: number; name: string; role: Role };
export type MeState = {
  loading: boolean;
  me: Me | null;
  guilds: GuildRef[]; // every guild the caller belongs to (current season)
  error: string | null;
  selectGuild: (id: number) => void;
};

async function fetchMe(wanted?: number): Promise<{ me: Me; guilds: GuildRef[] }> {
  const client = db();
  const list = await client.from("guilds").select("id, name").order("id");
  if (list.error) throw new Error(list.error.message);
  // app/page.tsx shows the invite hint when this message contains "not a member"
  if (list.data.length === 0) throw new Error("You're logged in, but you're not a member of any guild yet.");
  const guild = list.data.find((g) => g.id === wanted) ?? list.data[0];
  const map = await loadRoadmap(guild.id); // the caller's own member id comes from roadmap()
  const member = await client.from("members").select("id, display_name, role").eq("id", map.member_id).single();
  if (member.error) throw new Error(member.error.message);
  return {
    guilds: list.data,
    me: { guildId: guild.id, guildName: guild.name, memberId: member.data.id, name: member.data.display_name, role: member.data.role as Role },
  };
}

// Tracks the Supabase session and resolves the caller's member row in the active guild. A person may belong
// to several guilds: `wantedGuildId` (or selectGuild) picks one; otherwise the lowest id is used.
export function useMe(wantedGuildId?: number): MeState {
  const [choice, setChoice] = useState<number | undefined>(wantedGuildId);
  const [state, setState] = useState<Omit<MeState, "selectGuild">>({ loading: true, me: null, guilds: [], error: null });

  useEffect(() => {
    let latest = 0; // only the newest lookup may set state; older ones that resolve late are dropped
    // subscribing fires INITIAL_SESSION, so this also reloads whenever the chosen guild changes
    const { data } = db().auth.onAuthStateChange((_event, session) => {
      const run = ++latest;
      if (!session) {
        setState({ loading: false, me: null, guilds: [], error: null });
        return;
      }
      // never await supabase calls inside this callback (auth lock); defer them
      setTimeout(() => {
        fetchMe(choice).then(
          ({ me, guilds }) => run === latest && setState({ loading: false, me, guilds, error: null }),
          (e: Error) => run === latest && setState({ loading: false, me: null, guilds: [], error: e.message }),
        );
      }, 0);
    });
    return () => {
      latest = -1;
      data.subscription.unsubscribe();
    };
  }, [choice]);

  return { ...state, selectGuild: setChoice };
}
