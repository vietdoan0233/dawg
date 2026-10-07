import type { OpenNode, Roadmap } from "./roadmap";

// What changed between two polls of roadmap(), so the screen can celebrate it. Kept import-free (types only)
// so scripts/check-news.mjs can run it under plain Node.
// fresh = approved nodes this device has not shown yet (approved while the fuksi was away, or just now):
// their lines draw on as neon, one by one.
export type News = { lit: OpenNode[]; revealed: number[]; tier: string | null; fresh: number[]; n: number };

export const litIds = (m: Roadmap) => m.nodes.flatMap((x) => (!x.locked && x.approved > 0 ? [x.id] : []));

// p = previous poll (null on the first load), seen = node ids already shown on this device (null = don't track)
export function diffRoadmap(p: Roadmap | null, m: Roadmap, n: number, seen: number[] | null): News | null {
  const before = new Map((p?.nodes ?? []).flatMap((x) => (x.locked ? [] : [[x.id, x] as const])));
  const open = m.nodes.filter((x): x is OpenNode => !x.locked);
  const lit = p ? open.filter((x) => x.approved > (before.get(x.id)?.approved ?? 0)) : [];
  const revealed = p ? open.filter((x) => !before.has(x.id)).map((x) => x.id) : [];
  const tier = p && m.own_tier_id !== p.own_tier_id ? (m.tiers.find((t) => t.id === m.own_tier_id)?.name ?? null) : null;
  const shown = new Set(seen ?? []);
  const fresh = seen ? [...new Set([...litIds(m).filter((id) => !shown.has(id)), ...lit.map((x) => x.id)])] : [];
  return lit.length || revealed.length || tier || fresh.length ? { lit, revealed, tier, fresh, n } : null;
}
