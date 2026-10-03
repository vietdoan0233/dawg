import type { Roadmap } from "@/lib/roadmap";

// Tier ladder: "12p to Teekkari". Own tier comes from member_tier via roadmap().
export function Tiers({ map }: { map: Roadmap }) {
  const next = map.tiers.find((t) => t.min_total > map.total);
  const own = map.tiers.find((t) => t.id === map.own_tier_id);
  return (
    <section className="tiers" aria-label="Levels">
      <p className="tiers-summary">
        <strong>{map.total}p</strong>
        {own ? ` · ${own.name}` : ""}
        {next ? ` · ${next.min_total - map.total}p to ${next.name}` : ""}
      </p>
      <ol>
        {map.tiers.map((t) => (
          <li key={t.id} className={t.id === map.own_tier_id ? "tier own" : map.total >= t.min_total ? "tier reached" : "tier"}>
            {t.name} <span>{t.min_total}p</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
