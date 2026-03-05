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
import { registerPreviewRoutes } from "./routes/preview.js";
import { registerTodoRoutes } from "./routes/todos.js";
import { registerCalendarRoutes } from "./routes/calendar.js";
import { registerSubAgentRoutes } from "./routes/subagents.js";
import { registerChannelRoutes } from "./routes/channels.js";
import { registerAuth } from "./auth.js";
import type { ChannelManager } from "./channel-manager.js";
import * as Sentry from "@sentry/node";

export interface ServerOptions {
  ctx: AppContext;
  scheduler?: TaskScheduler;
  channelManager?: ChannelManager;
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

  // 健康检查端点（无需认证，必须在 auth 之前注册）
  app.get("/health", async () => ({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }));

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
  registerTodoRoutes(app, ctx);
  registerCalendarRoutes(app, ctx, scheduler);
  registerSubAgentRoutes(app, ctx);
  if (options.channelManager) {
    registerChannelRoutes(app, options.channelManager);
  }

  // Register upload & WebSocket
  await registerUploadRoutes(app);
  registerWebSocket(app, ctx);
  registerBrowserExtension(app);

  // Serve generated files (images, documents, etc.) from data/tmp/
  const dataTmpDir = resolve(process.cwd(), "data", "tmp");
  mkdirSync(dataTmpDir, { recursive: true });
  await app.register(fastifyStatic, {
    root: dataTmpDir,
    prefix: "/files/",
    decorateReply: false,
    // Generated files use snowflake IDs — immutable, safe to cache forever.
    // Prevents re-download through slow VPN/Tunnel paths.
    maxAge: "7d",
    immutable: true,
  });
  console.log("[server] Serving generated files from", dataTmpDir);

  // Preview: /preview/xxx.{md,docx,xlsx,csv,pptx} → rendered HTML
  registerPreviewRoutes(app, dataTmpDir);

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
        request.url.startsWith("/files/") ||
        request.url.startsWith("/preview/")
      ) {
        reply.code(404).send({ error: "Not found" });
      } else {
        reply.header("Cache-Control", "no-cache, no-store, must-revalidate");
        reply.sendFile("index.html");
      }
    });

    console.log("[server] Serving Web UI from", webDistDir);
  }

  // Sentry：捕获 Fastify 未处理的路由错误
  app.setErrorHandler(
    (error: Error & { statusCode?: number }, _request, reply) => {
      Sentry.captureException(error);
      reply.status(error.statusCode ?? 500).send({
        error: error.message || "Internal Server Error",
      });
    },
  );

  return app;
}
