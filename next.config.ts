import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

// Pin the workspace root to this project — a stray parent lockfile
// (~/package-lock.json) otherwise makes Next infer the wrong root.
const projectRoot = fileURLToPath(new URL(".", import.meta.url));

const nextConfig: NextConfig = {
  turbopack: { root: projectRoot },
  outputFileTracingRoot: projectRoot,
};

export default nextConfig;
