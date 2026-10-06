"use client";
import { useState } from "react";
import { SkillTree } from "@/components/SkillTree";
import { MOCK_TREE, type TreeNode } from "@/lib/skillTree";

// PROTOTYPE route: mock nodes, local state only. Submitting marks the node pending in memory;
// wiring it to submit_task needs real task ids and the `parents` schema change (not in the SDD yet).
export default function TreePage() {
  const [nodes, setNodes] = useState<TreeNode[]>(MOCK_TREE);

  return (
    <main className="tree-page">
      <header className="tree-head">
        <h1>Fuksipisteet</h1>
        <p className="hint">Prototype skill tree · mock data</p>
      </header>
      <SkillTree
        nodes={nodes}
        onSubmit={async (id) => {
          setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, status: "pending" } : n)));
        }}
      />
    </main>
  );
}
