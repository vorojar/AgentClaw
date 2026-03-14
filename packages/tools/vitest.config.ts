import { defineConfig } from "vitest/config";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packagesDir = resolve(__dirname, "..");

export default defineConfig({
  test: {
    globals: true,
    include: ["src/__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@agentclaw/types": resolve(packagesDir, "types/src/index.ts"),
      "@agentclaw/tools": resolve(packagesDir, "tools/src/index.ts"),
    },
  },
});
