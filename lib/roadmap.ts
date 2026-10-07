import { useCallback, useEffect, useRef, useState } from "react";
import { db } from "@/lib/supabase";
import { diffRoadmap, litIds, type News } from "./news";

export type Category = { id: number; name: string; color: string; icon: string; points: number; min_points: number | null };
export type Tier = { id: number; name: string; min_total: number };
export type OpenNode = {
  locked: false;
  id: number;
  category_id: number;
  title: string;
  description: string | null;
  points_min: number;
  points_max: number;
  reviewer: "tutor" | "captain";
  max_repeats: number;
  required: boolean;
  requires_photo: boolean;
  requires_note: boolean;
  approved: number;
  pending: number;
  status: "dim" | "pending" | "lit";
};
export type LockedNode = { locked: true; category_id: number };
export type Node = OpenNode | LockedNode;
export type Roadmap = {
  member_id: number;
  total: number;
  own_tier_id: number | null;
  tiers: Tier[];
  categories: Category[];
  nodes: Node[];
};

export const pointsLabel = (n: Pick<OpenNode, "points_min" | "points_max">) =>
  n.points_min === n.points_max ? `${n.points_min}p` : `${n.points_min}–${n.points_max}p`;

export async function loadRoadmap(guildId: number): Promise<Roadmap> {
  const { data, error } = await db().rpc("roadmap", { p_guild_id: guildId });
  if (error) throw new Error(error.message);
  return data as unknown as Roadmap;
}

// Approved node ids this device already celebrated, per member. A convenience only: storage failures
// (private mode) just replay the neon lines on the next visit.
const SEEN = (memberId: number) => `fp-seen:${memberId}`;
function readSeen(memberId: number): number[] {
  try {
    return JSON.parse(localStorage.getItem(SEEN(memberId)) ?? "[]") as number[];
  } catch {
    return [];
  }
}
function writeSeen(memberId: number, ids: number[]) {
  try {
    localStorage.setItem(SEEN(memberId), JSON.stringify(ids));
  } catch {}
}

// Polls roadmap() every 5 s (same as the projector), so a check-in, approval or reveal shows without a reload.
// A failed poll only shows an error while there is no map yet; later polls keep the last good map.
// track = remember which approvals this device has shown (the fuksi's own map; off for the projector).
export function useRoadmap(guildId: number, track = false) {
  const [map, setMap] = useState<Roadmap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [news, setNews] = useState<News | null>(null);
  const prev = useRef<Roadmap | null>(null);
  const count = useRef(0);

  const refresh = useCallback(() => {
    loadRoadmap(guildId).then(
      (m) => {
        const p = prev.current;
        prev.current = m;
        setMap(m);
        setError(null);
        const d = diffRoadmap(p, m, ++count.current, track ? readSeen(m.member_id) : null);
        if (track) writeSeen(m.member_id, litIds(m));
        if (d) setNews(d);
      },
      (e: Error) => setError(e.message),
    );
  }, [guildId, track]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  return { map, error, news, refresh };
}

export type LeaderRow ={ group_id: number; group_name: string; total_points: number };

export async function loadLeaderboard(guildId: number): Promise<LeaderRow[]> {
  const { data, error } = await db().rpc("leaderboard", { p_guild_id: guildId });
  if (error) throw new Error(error.message);
  return data;
}

// RPC errors carry short codes (see 0001_init.sql); show a sentence instead.
const MESSAGES: Record<string, string> = {
  limit_reached: "You have already used every repeat of this node.",
  note_required: "This node needs a note.",
  photo_required: "This node needs a photo.",
  invalid_photo: "That photo could not be attached. Try again.",
  unauthenticated: "Please log in again.",
  invalid_invite: "This invite link is not valid any more. Ask your captain for a new one.",
  email_unverified: "Verify your email first: log in with the 6-digit code.",
  cannot_change_self: "You cannot change your own role. Ask another captain.",
  invalid_request: "That request is not valid.",
  not_found: "This node is not available.",
  forbidden: "You are not allowed to do that.",
  not_pending: "That submission was already reviewed.",
  reason_required: "Add a short reason when awarding above the minimum.",
  points_out_of_range: "Points are outside this node's range.",
};
export const friendly = (message: string) => MESSAGES[message] ?? message;
