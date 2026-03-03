import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { marked } from "marked";
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

  // Markdown preview: /preview/xxx.md → rendered HTML with download button
  app.get("/preview/*", async (request, reply) => {
    const relPath = decodeURIComponent(
      (request.params as { "*": string })["*"],
    );
    // Security: block path traversal
    if (relPath.includes("..")) {
      return reply.code(400).send("Invalid path");
    }
    const filePath = resolve(dataTmpDir, relPath);
    if (!existsSync(filePath) || !filePath.endsWith(".md")) {
      return reply.code(404).send("File not found");
    }
    const md = readFileSync(filePath, "utf-8");
    const htmlBody = await marked.parse(md);
    const title = relPath.split("/").pop() ?? "Preview";
    const downloadUrl = `/files/${relPath}`;
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    max-width: 860px; margin: 0 auto; padding: 24px 20px 60px;
    color: #1a1a1a; background: #fff; line-height: 1.7;
  }
  .toolbar {
    position: fixed; top: 0; left: 0; right: 0; z-index: 100;
    background: rgba(255,255,255,0.92); backdrop-filter: blur(8px);
    border-bottom: 1px solid #e5e5e5; padding: 8px 20px;
    display: flex; justify-content: flex-end; gap: 10px;
  }
  .toolbar a {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 6px 16px; border-radius: 6px; font-size: 14px;
    text-decoration: none; color: #fff; background: #2563eb;
  }
  .toolbar a:hover { background: #1d4ed8; }
  body { padding-top: 56px; }
  h1 { font-size: 1.8em; border-bottom: 2px solid #e5e5e5; padding-bottom: 8px; }
  h2 { font-size: 1.4em; border-bottom: 1px solid #eee; padding-bottom: 6px; margin-top: 2em; }
  h3 { font-size: 1.15em; margin-top: 1.5em; }
  pre { background: #f6f8fa; border-radius: 6px; padding: 16px; overflow-x: auto; font-size: 14px; }
  code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 4px solid #ddd; margin: 1em 0; padding: 0.5em 1em; color: #555; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  th { background: #f6f8fa; font-weight: 600; }
  img { max-width: 100%; border-radius: 6px; }
  a { color: #2563eb; }
  @media (prefers-color-scheme: dark) {
    body { background: #1a1a2e; color: #e0e0e0; }
    .toolbar { background: rgba(26,26,46,0.92); border-color: #333; }
    pre { background: #16213e; }
    code { background: #1a1a3a; }
    th { background: #16213e; }
    th, td { border-color: #333; }
    h1, h2 { border-color: #333; }
    blockquote { border-color: #444; color: #aaa; }
  }
</style>
</head>
<body>
<div class="toolbar">
  <a href="${downloadUrl}" download>⬇ 下载</a>
</div>
${htmlBody}
</body>
</html>`;
    // Bypass Fastify reply chain (including @fastify/compress which
    // produces content-length:0 with Brotli) by writing directly to raw response.
    const buf = Buffer.from(html, "utf-8");
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-length": buf.length.toString(),
    });
    reply.raw.end(buf);
  });

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

  return app;
}
