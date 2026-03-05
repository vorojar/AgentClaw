import type { FastifyInstance } from "fastify";
import type { AppContext } from "../bootstrap.js";
import type { TaskScheduler } from "../scheduler.js";

export function registerCalendarRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  scheduler: TaskScheduler,
): void {
  // GET /api/calendar?year=2026&month=3 — Calendar data (tasks + scheduled tasks merged)
  app.get<{
    Querystring: { year?: string; month?: string };
  }>("/api/calendar", async (req, reply) => {
    try {
      const now = new Date();
      const year = req.query.year
        ? parseInt(req.query.year, 10)
        : now.getFullYear();
      const month = req.query.month
        ? parseInt(req.query.month, 10)
        : now.getMonth() + 1;

      // Tasks with due dates
      const taskItems = ctx.memoryStore.getCalendarItems(year, month);

      // Scheduled tasks with nextRunAt
      const scheduleItems = scheduler
        .list()
        .filter((t) => t.enabled && t.nextRunAt)
        .map((t) => {
          const d = t.nextRunAt!;
          const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          return {
            date: dateStr,
            type: "schedule" as const,
            id: t.id,
            title: t.name,
            cron: t.cron,
          };
        })
        .filter((item) => {
          // Filter to requested month
          const [y, m] = item.date.split("-").map(Number);
          return y === year && m === month;
        });

      return reply.send({
        year,
        month,
        items: [...taskItems, ...scheduleItems],
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });
}
