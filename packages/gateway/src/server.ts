import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "./bootstrap.js";
import { TaskScheduler } from "./scheduler.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerPlanRoutes } from "./routes/plans.js";
import { registerMemoryRoutes } from "./routes/memories.js";
import { registerToolRoutes } from "./routes/tools.js";
import { registerConfigRoutes } from "./routes/config.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import { registerWebSocket } from "./ws.js";

export interface ServerOptions {
  ctx: AppContext;
  scheduler?: TaskScheduler;
}

export async function createServer(
  options: ServerOptions,
): Promise<FastifyInstance> {
  const { ctx } = options;
  const scheduler = options.scheduler ?? new TaskScheduler();

  const app = Fastify({
    logger: true,
  });

  // Register plugins
  await app.register(cors, {
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  });

  await app.register(websocket);

  // Register REST routes
  registerSessionRoutes(app, ctx);
  registerPlanRoutes(app, ctx);
  registerMemoryRoutes(app, ctx);
  registerToolRoutes(app, ctx);
  registerConfigRoutes(app, ctx);
  registerTaskRoutes(app, scheduler);

  // Register WebSocket
  registerWebSocket(app, ctx);

  // Serve Web UI static files (built by @agentclaw/web)
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const webDistDir = resolve(__dirname, "../../web/dist");
  if (existsSync(webDistDir)) {
    await app.register(fastifyStatic, {
      root: webDistDir,
      prefix: "/",
      wildcard: false,
    });

    // SPA fallback: serve index.html for non-API, non-file routes
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/") || request.url.startsWith("/ws")) {
        reply.code(404).send({ error: "Not found" });
      } else {
        reply.sendFile("index.html");
      }
    });

    console.log("[server] Serving Web UI from", webDistDir);
  }

  return app;
}
