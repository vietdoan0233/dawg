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
// The lowest level above the member's own, and what is still missing (computed in SQL; render as-is, SDD §11.2).
export type NextTier = {
  tier_id: number;
  name: string;
  points_needed: number;
  unmet: { category_id: number; have: number; need: number }[];
  required_missing: number;
};
export type Roadmap = {
  member_id: number;
  total: number;
  own_tier_id: number | null;
  tiers: Tier[];
  next_tier: NextTier | null; // null at the top level
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

// One row per fuksi of the guild, ordered by rank (ties share a rank). Week = rolling 7 days, adjustments excluded.
export type LeaderRow = {
  member_id: number;
  display_name: string;
  total: number;
  tier_name: string | null;
  week_points: number;
  rank: number;
  rank_week_ago: number;
};

export async function loadLeaderboard(guildId: number): Promise<LeaderRow[]> {
  const { data, error } = await db().rpc("leaderboard", { p_guild_id: guildId });
  if (error) throw new Error(error.message);
  return data;
}

// Newest approved points of the guild's fuksis in the last 7 days. task_title is null while the task is secret.
export type ActivityRow = {
  at: string;
  member_id: number;
  display_name: string;
  category_id: number;
  task_title: string | null;
  points: number;
  secret: boolean;
};

export async function loadActivity(guildId: number, limit = 20): Promise<ActivityRow[]> {
  const { data, error } = await db().rpc("activity", { p_guild_id: guildId, p_limit: limit });
  if (error) throw new Error(error.message);
  return data;
}

// RPC errors carry short codes (see 0001_init.sql); show a sentence instead.
const MESSAGES: Record<string, string> = {
  limit_reached: "This task has already been completed the maximum number of times.",
  note_required: "This task needs a short note.",
  photo_required: "This task needs a photo.",
  invalid_photo: "The photo could not be attached. Please try again.",
  unauthenticated: "Your session has ended. Please log in again.",
  invalid_invite: "This invite link has expired or been turned off. Ask your guild captain for a new one.",
  email_unverified: "Please confirm your email first by logging in with the 6-digit code.",
  cannot_change_self: "You can't change your own role. Ask another captain to do it.",
  invalid_request: "Something in that request wasn't right. Please check and try again.",
  not_found: "This task isn't available.",
  forbidden: "You don't have permission to do that.",
  not_pending: "Someone has already reviewed this submission.",
  reason_required: "Please add a short reason when giving more than the standard points.",
  points_out_of_range: "Those points are outside this task's allowed range.",
};
export const friendly = (message: string) => MESSAGES[message] ?? message;
