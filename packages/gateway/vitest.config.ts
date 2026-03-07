import { defineConfig } from "vitest/config";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

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
      "@agentclaw/providers": resolve(packagesDir, "providers/src/index.ts"),
      "@agentclaw/tools": resolve(packagesDir, "tools/src/index.ts"),
      "@agentclaw/memory": resolve(packagesDir, "memory/src/index.ts"),
      "@agentclaw/core": resolve(packagesDir, "core/src/index.ts"),
    },
  },
});
