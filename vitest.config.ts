import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const resolvePath = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Allow importing server modules (which import `server-only`) under Vitest.
      "server-only": resolvePath("./test/empty.ts"),
      // Mirror the tsconfig "@/*" path alias.
      "@": resolvePath("./"),
    },
  },
  test: {
    include: ["**/*.test.ts"],
    exclude: ["node_modules", ".next"],
    environment: "node",
    setupFiles: ["./test/vitest-setup.ts"],
  },
});
