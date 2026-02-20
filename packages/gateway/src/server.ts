import Fastify from "fastify";
import cors from "@fastify/cors";
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

  return app;
}
