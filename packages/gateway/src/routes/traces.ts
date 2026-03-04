import type { FastifyInstance } from "fastify";
import type { AppContext } from "../bootstrap.js";

export function registerTraceRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): void {
  // List traces (summary)
  app.get<{
    Querystring: { limit?: string; offset?: string };
  }>(
    "/api/traces",
    {
      schema: {
        // 校验查询参数：limit/offset 可选，数字字符串
        querystring: {
          type: "object",
          properties: {
            limit: { type: "string", pattern: "^[0-9]+$" },
            offset: { type: "string", pattern: "^[0-9]+$" },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const limit = Math.min(
          Math.max(parseInt(req.query.limit || "20", 10) || 20, 1),
          200,
        );
        const offset = Math.max(parseInt(req.query.offset || "0", 10) || 0, 0);
        const result = await ctx.memoryStore.getTraces(limit, offset);
        return reply.send(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: message });
      }
    },
  );

  // Get latest trace
  app.get("/api/traces/latest", async (_req, reply) => {
    try {
      const result = await ctx.memoryStore.getTraces(1, 0);
      if (result.items.length === 0) {
        return reply.status(404).send({ error: "No traces found" });
      }
      return reply.send(result.items[0]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  // Get trace by ID
  app.get<{
    Params: { id: string };
  }>(
    "/api/traces/:id",
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
        const trace = await ctx.memoryStore.getTrace(req.params.id);
        if (!trace) {
          return reply.status(404).send({ error: "Trace not found" });
        }
        return reply.send(trace);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: message });
      }
    },
  );
}
