import type { CSSProperties } from "react";
import { readableOn } from "@/lib/icons";
import { pointsLabel, type Node } from "@/lib/roadmap";

// One map node: dim / pending (half-lit) / lit / locked placeholder. Repeat dots for max_repeats > 1.
export function NodeDot({ node, color, onOpen }: { node: Node; color: string; onOpen?: () => void }) {
  if (node.locked) {
    return (
      <div className="node locked" role="img" aria-label="Locked node">
        <span className="dot">🔒</span>
      </div>
    );
  }
  const full = node.approved + node.pending >= node.max_repeats;
  const body = (
    <>
      <span className={`dot ${node.status}`} style={{ "--c": color, "--on": readableOn(color) } as CSSProperties}>
        {node.status === "lit" ? "✓" : ""}
      </span>
      <span className="title">{node.title}</span>
      <span className="pts">{pointsLabel(node)}</span>
      {node.max_repeats > 1 && (
        <span className="repeats" role="img" aria-label={`${node.approved} of ${node.max_repeats} done`}>
          {Array.from({ length: node.max_repeats }, (_, i) => (
            <i key={i} className={i < node.approved ? "on" : ""} />
          ))}
        </span>
      )}
    </>
  );
  return onOpen && !full ? (
    <button type="button" className={`node ${node.status}`} onClick={onOpen}>
      {body}
    </button>
  ) : (
    <div className={`node ${node.status}`}>{body}</div>
  );
}
