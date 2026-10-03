"use client";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { loadRoadmap, type OpenNode, type Roadmap } from "@/lib/roadmap";
import { iconGlyph } from "@/lib/icons";
import type { Me } from "@/lib/useMe";
import { NodeDot } from "./NodeDot";
import { SubmitSheet } from "./SubmitSheet";
import { Tiers } from "./Tiers";

// Phone view: one stacked card per category with a time-ordered (id-ordered) chain of nodes.
export function RoadmapCards({ me }: { me: Me }) {
  const [map, setMap] = useState<Roadmap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<OpenNode | null>(null);

  const refresh = useCallback(() => {
    loadRoadmap(me.guildId).then(setMap, (e: Error) => setError(e.message));
  }, [me.guildId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (error) return <p className="error">{error}</p>;
  if (!map) return <p>Loading your map…</p>;

  return (
    <>
      <Tiers map={map} />
      {map.categories.map((c) => {
        const color = c.color;
        const nodes = map.nodes.filter((n) => n.category_id === c.id);
        return (
          <section key={c.id} className="card" style={{ "--c": color } as CSSProperties}>
            <header>
              <span aria-hidden>{iconGlyph(c.icon)}</span>
              <h2>{c.name}</h2>
              <span className="progress">{c.min_points ? `${c.points}/${c.min_points}p` : `${c.points}p`}</span>
            </header>
            <div className="chain">
              {nodes.length === 0 && <p className="empty">No nodes on the map yet</p>}
              {nodes.map((n, j) => (
                <NodeDot key={n.locked ? `lock-${j}` : n.id} node={n} color={color} onOpen={n.locked ? undefined : () => setOpen(n)} />
              ))}
            </div>
          </section>
        );
      })}
      {open && (
        <SubmitSheet
          node={open}
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null);
            refresh();
          }}
        />
      )}
    </>
  );
}
