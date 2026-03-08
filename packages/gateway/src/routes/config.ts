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
      const dailyBriefTime =
        (ctx.memoryStore as any).getSetting?.("daily_brief_time") || "09:00";
      return reply.send({
        provider: ctx.config.provider,
        model: ctx.config.model,
        databasePath: ctx.config.databasePath,
        skillsDir: ctx.config.skillsDir,
        dailyBriefTime,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  // PUT /api/config - Update config (model + dailyBriefTime at runtime)
  app.put<{
    Body: {
      model?: string;
      dailyBriefTime?: string;
    };
  }>(
    "/api/config",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            model: { type: "string", minLength: 1 },
            dailyBriefTime: { type: "string", pattern: "^\\d{2}:\\d{2}$" },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      try {
        const updates = req.body;
        if (updates.model !== undefined) {
          ctx.config.model = updates.model;
          (ctx.orchestrator as any).setModel(updates.model);
        }

        if (updates.dailyBriefTime !== undefined) {
          (ctx.memoryStore as any).setSetting(
            "daily_brief_time",
            updates.dailyBriefTime,
          );
          // 重启 Cron job 以应用新时间
          const restart = (ctx as unknown as Record<string, unknown>)
            .restartDailyBrief as (() => void) | undefined;
          if (restart) restart();
        }

        const dailyBriefTime =
          (ctx.memoryStore as any).getSetting?.("daily_brief_time") || "09:00";
        return reply.send({
          provider: ctx.config.provider,
          model: ctx.config.model,
          databasePath: ctx.config.databasePath,
          skillsDir: ctx.config.skillsDir,
          dailyBriefTime,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: message });
      }
    },
  );
}
