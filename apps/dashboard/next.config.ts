import type { NextConfig } from "next";
import { resolve } from "node:path";

const nextConfig: NextConfig = {
  agentRules: false,
  transpilePackages: ["@mcp-breaker/shared", "@mcp-breaker/demo-target", "@mcp-breaker/evaluation"],
  turbopack: {
    root: resolve(import.meta.dirname, "../.."),
  },
};

export default nextConfig;
