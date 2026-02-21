import type { FastifyInstance } from "fastify";
import type { AppContext } from "../bootstrap.js";

export function registerTokenLogRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): void {
  app.get<{
    Querystring: { limit?: string; offset?: string };
  }>("/api/token-logs", async (req, reply) => {
    try {
      const limit = Math.min(
        Math.max(parseInt(req.query.limit || "50", 10) || 50, 1),
        200,
      );
      const offset = Math.max(parseInt(req.query.offset || "0", 10) || 0, 0);
      const result = ctx.memoryStore.getTokenLogs(limit, offset);
      return reply.send(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });
}
