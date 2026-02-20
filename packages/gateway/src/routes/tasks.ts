import type { FastifyInstance } from "fastify";
import type { AppContext } from "../bootstrap.js";
import type { TaskScheduler } from "../scheduler.js";

function serializeTask(task: {
  id: string;
  name: string;
  cron: string;
  action: string;
  enabled: boolean;
  lastRunAt?: Date;
  nextRunAt?: Date;
}) {
  return {
    id: task.id,
    name: task.name,
    cron: task.cron,
    action: task.action,
    enabled: task.enabled,
    lastRunAt: task.lastRunAt?.toISOString(),
    nextRunAt: task.nextRunAt?.toISOString(),
  };
}

export function registerTaskRoutes(
  app: FastifyInstance,
  scheduler: TaskScheduler,
): void {
  // GET /api/tasks - List scheduled tasks
  app.get("/api/tasks", async (_req, reply) => {
    try {
      const tasks = scheduler.list();
      return reply.send(tasks.map(serializeTask));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  // POST /api/tasks - Create scheduled task
  app.post<{
    Body: { name: string; cron: string; action: string; enabled: boolean };
  }>("/api/tasks", async (req, reply) => {
    try {
      const { name, cron, action, enabled } = req.body;

      if (!name || !cron || !action) {
        return reply
          .status(400)
          .send({ error: "Missing required fields: name, cron, action" });
      }

      const task = scheduler.create({
        name,
        cron,
        action,
        enabled: enabled ?? true,
      });
      return reply.status(201).send(serializeTask(task));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  // DELETE /api/tasks/:id - Delete scheduled task
  app.delete<{ Params: { id: string } }>(
    "/api/tasks/:id",
    async (req, reply) => {
      try {
        const deleted = scheduler.delete(req.params.id);
        if (!deleted) {
          return reply
            .status(404)
            .send({ error: `Task not found: ${req.params.id}` });
        }
        return reply.status(204).send();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: message });
      }
    },
  );
}
