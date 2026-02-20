import type { FastifyInstance } from "fastify";
import type { AppContext } from "../bootstrap.js";
import type { MemoryType } from "@agentclaw/types";

export function registerMemoryRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): void {
  // GET /api/memories - Search memories
  app.get<{ Querystring: { q?: string; type?: string; limit?: string } }>(
    "/api/memories",
    async (req, reply) => {
      try {
        const { q, type, limit } = req.query;
        const results = await ctx.memoryStore.search({
          query: q || undefined,
          type: type ? (type as MemoryType) : undefined,
          limit: limit ? parseInt(limit, 10) : 10,
        });

        const memories = results.map((r) => ({
          id: r.entry.id,
          type: r.entry.type,
          content: r.entry.content,
          importance: r.entry.importance,
          createdAt: r.entry.createdAt.toISOString(),
          accessedAt: r.entry.accessedAt.toISOString(),
          accessCount: r.entry.accessCount,
        }));

        return reply.send(memories);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: message });
      }
    },
  );

  // DELETE /api/memories/:id - Delete memory
  app.delete<{ Params: { id: string } }>(
    "/api/memories/:id",
    async (req, reply) => {
      try {
        await ctx.memoryStore.delete(req.params.id);
        return reply.status(204).send();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: message });
      }
    },
  );
}
