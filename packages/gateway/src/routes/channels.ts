import type { FastifyInstance } from "fastify";
import type { ChannelManager } from "../channel-manager.js";

export function registerChannelRoutes(
  app: FastifyInstance,
  channelManager: ChannelManager,
): void {
  // GET /api/channels — List all channels with status
  app.get("/api/channels", async (_req, reply) => {
    try {
      return reply.send(channelManager.list());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  // POST /api/channels/:id/start — Start a channel
  app.post<{ Params: { id: string } }>(
    "/api/channels/:id/start",
    async (req, reply) => {
      try {
        await channelManager.start(req.params.id);
        const info = channelManager.getInfo(req.params.id);
        return reply.send(info);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(400).send({ error: message });
      }
    },
  );

  // POST /api/channels/:id/stop — Stop a channel
  app.post<{ Params: { id: string } }>(
    "/api/channels/:id/stop",
    async (req, reply) => {
      try {
        await channelManager.stop(req.params.id);
        const info = channelManager.getInfo(req.params.id);
        return reply.send(info);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(400).send({ error: message });
      }
    },
  );
}
