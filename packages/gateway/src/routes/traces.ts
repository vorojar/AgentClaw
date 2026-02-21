import type { FastifyInstance } from "fastify";
import type { AppContext } from "../bootstrap.js";

export function registerTraceRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): void {
  // List traces (summary)
  app.get<{
    Querystring: { limit?: string; offset?: string };
  }>("/api/traces", async (req, reply) => {
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
  });

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
  }>("/api/traces/:id", async (req, reply) => {
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
  });
}
