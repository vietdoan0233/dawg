import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next dev` would otherwise append a block to AGENTS.md; the team owns that file.
  agentRules: false,
};

export default nextConfig;
