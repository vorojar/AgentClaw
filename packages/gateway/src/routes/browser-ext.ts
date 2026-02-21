import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";

let extensionSocket: WebSocket | null = null;

const pendingRequests = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }
>();

const REQUEST_TIMEOUT = 30_000;

export function registerBrowserExtension(app: FastifyInstance): void {
  // -----------------------------------------------------------------------
  // WebSocket endpoint for the Chrome extension
  // -----------------------------------------------------------------------
  app.get("/ws/ext", { websocket: true }, (socket, _req) => {
    console.log("[browser-ext] Extension connected");
    extensionSocket = socket;

    socket.on("message", (rawData: Buffer | string) => {
      let msg: { id?: string; type?: string; result?: unknown; error?: string };
      try {
        const str = typeof rawData === "string" ? rawData : rawData.toString("utf-8");
        msg = JSON.parse(str);
      } catch {
        return;
      }

      // Heartbeat ping — reply with pong
      if (msg.type === "ping") {
        socket.send(JSON.stringify({ type: "pong" }));
        return;
      }

      const { id } = msg;
      if (!id) return;

      const pending = pendingRequests.get(id);
      if (!pending) return;

      pendingRequests.delete(id);
      clearTimeout(pending.timer);

      if (msg.error) {
        pending.reject(new Error(msg.error));
      } else {
        pending.resolve(msg.result);
      }
    });

    socket.on("close", () => {
      console.log("[browser-ext] Extension disconnected");
      if (extensionSocket === socket) {
        extensionSocket = null;
      }
      // Reject all pending requests
      for (const [id, pending] of pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Extension disconnected"));
        pendingRequests.delete(id);
      }
    });
  });

  // -----------------------------------------------------------------------
  // HTTP endpoint for browser.mjs to send commands
  // -----------------------------------------------------------------------
  app.post("/api/browser/exec", async (request, reply) => {
    // Wait up to 8 seconds for extension to connect (handles gateway restart race)
    if (!extensionSocket || extensionSocket.readyState !== 1) {
      for (let i = 0; i < 16; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (extensionSocket && extensionSocket.readyState === 1) break;
      }
    }
    if (!extensionSocket || extensionSocket.readyState !== 1) {
      return reply.status(503).send({
        error: "浏览器扩展暂时未连接，请稍后重试。",
      });
    }

    const body = request.body as { action?: string; args?: Record<string, unknown> };
    if (!body?.action) {
      return reply.status(400).send({ error: "Missing action" });
    }

    const id = randomUUID();

    const result = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error("Extension request timed out (30s)"));
      }, REQUEST_TIMEOUT);

      pendingRequests.set(id, { resolve, reject, timer });

      extensionSocket!.send(JSON.stringify({ id, action: body.action, args: body.args || {} }));
    }).catch((err) => {
      return reply.status(502).send({ error: err.message });
    });

    // If reply was already sent by catch block
    if (reply.sent) return;

    return reply.send({ result });
  });
}
