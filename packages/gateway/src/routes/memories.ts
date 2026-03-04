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
    {
      schema: {
        // 校验查询参数：q/type/limit 均可选
        querystring: {
          type: "object",
          properties: {
            q: { type: "string" },
            type: { type: "string" },
            limit: { type: "string", pattern: "^[0-9]+$" },
          },
        },
      },
    },
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

  // POST /api/memories/reindex - Regenerate all embeddings
  app.post("/api/memories/reindex", async (_req, reply) => {
    try {
      const result = await ctx.memoryStore.reindexEmbeddings();
      return reply.send(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  // DELETE /api/memories/:id - Delete memory
  app.delete<{ Params: { id: string } }>(
    "/api/memories/:id",
    {
      schema: {
        // 校验路径参数：id 不能为空
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 1 } },
        },
      },
    },
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
