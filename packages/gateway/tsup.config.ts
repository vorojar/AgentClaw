import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: [
    "@agentclaw/types",
    "@agentclaw/core",
    "@agentclaw/providers",
    "@agentclaw/tools",
    "@agentclaw/memory",
    "fastify",
    "@fastify/cors",
    "@fastify/websocket",
    "croner",
    "better-sqlite3",
    "grammy",
    "dotenv",
  ],
});
