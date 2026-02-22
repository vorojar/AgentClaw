import type { FastifyInstance } from "fastify";
import type { AppContext } from "../bootstrap.js";

export function registerConfigRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): void {
  // GET /api/stats - Usage stats
  app.get("/api/stats", async (_req, reply) => {
    try {
      const usage = ctx.memoryStore.getUsageStats();
      const stats = {
        totalInputTokens: usage.totalIn,
        totalOutputTokens: usage.totalOut,
        totalCost: 0,
        totalCalls: usage.totalCalls,
        byModel: usage.byModel.map((m) => ({
          provider: "",
          model: m.model,
          totalInputTokens: m.totalIn,
          totalOutputTokens: m.totalOut,
          totalCost: 0,
          callCount: m.callCount,
        })),
      };
      return reply.send(stats);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  // GET /api/config - Get config
  app.get("/api/config", async (_req, reply) => {
    try {
      return reply.send({
        provider: ctx.config.provider,
        model: ctx.config.model,
        databasePath: ctx.config.databasePath,
        skillsDir: ctx.config.skillsDir,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  // PUT /api/config - Update config (only model can be changed at runtime)
  app.put<{
    Body: {
      model?: string;
    };
  }>("/api/config", async (req, reply) => {
    try {
      const updates = req.body;
      if (updates.model !== undefined) {
        ctx.config.model = updates.model;
        (ctx.orchestrator as any).setModel(updates.model);
      }

      return reply.send({
        provider: ctx.config.provider,
        model: ctx.config.model,
        databasePath: ctx.config.databasePath,
        skillsDir: ctx.config.skillsDir,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });
}
