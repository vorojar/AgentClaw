import { existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import compress from "@fastify/compress";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "./bootstrap.js";
import { TaskScheduler } from "./scheduler.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerMemoryRoutes } from "./routes/memories.js";
import { registerToolRoutes } from "./routes/tools.js";
import { registerConfigRoutes } from "./routes/config.js";
import { registerTokenLogRoutes } from "./routes/token-logs.js";
import { registerTraceRoutes } from "./routes/traces.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import { registerWebSocket } from "./ws.js";
import { registerBrowserExtension } from "./routes/browser-ext.js";
import { registerUploadRoutes } from "./routes/upload.js";
import { registerAuth } from "./auth.js";

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
    // Cloudflare Tunnel reuses connections aggressively; Node.js default
    // keepAliveTimeout (5 s) is too short, causing 502/503 on reused sockets.
    keepAliveTimeout: 120_000,
  });

  // Register plugins
  await app.register(compress);
  await app.register(cors, {
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  });

  await app.register(websocket);
  await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024 } });

  // Register authentication (no-op if API_KEY not set)
  registerAuth(app);

  // Register REST routes
  registerSessionRoutes(app, ctx);
  registerMemoryRoutes(app, ctx);
  registerToolRoutes(app, ctx);
  registerConfigRoutes(app, ctx);
  registerTokenLogRoutes(app, ctx);
  registerTraceRoutes(app, ctx);
  registerTaskRoutes(app, scheduler);

  // Register upload & WebSocket
  await registerUploadRoutes(app);
  registerWebSocket(app, ctx);
  registerBrowserExtension(app);

  // Serve generated files (images, documents, etc.) from data/tmp/
  const dataFilesDir = resolve(process.cwd(), "data", "tmp");
  mkdirSync(dataFilesDir, { recursive: true });
  await app.register(fastifyStatic, {
    root: dataFilesDir,
    prefix: "/files/",
    decorateReply: false,
  });
  console.log("[server] Serving generated files from", dataFilesDir);

  // Serve Web UI static files (built by @agentclaw/web)
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const webDistDir = resolve(__dirname, "../../web/dist");
  if (existsSync(webDistDir)) {
    await app.register(fastifyStatic, {
      root: webDistDir,
      prefix: "/",
      wildcard: false,
      setHeaders(res, pathName) {
        // index.html must never be cached (references hashed asset filenames)
        if (pathName.endsWith("index.html") || pathName.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        }
      },
    });

    // SPA fallback: serve index.html only for navigation requests,
    // NOT for static assets (.js, .css, etc.) to avoid MIME type errors.
    app.setNotFoundHandler((request, reply) => {
      if (
        request.url.startsWith("/api/") ||
        request.url.startsWith("/ws") ||
        request.url.startsWith("/assets/") ||
        request.url.startsWith("/files/")
      ) {
        reply.code(404).send({ error: "Not found" });
      } else {
        reply.header("Cache-Control", "no-cache, no-store, must-revalidate");
        reply.sendFile("index.html");
      }
    });

    console.log("[server] Serving Web UI from", webDistDir);
  }

  return app;
}
