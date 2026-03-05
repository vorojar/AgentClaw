import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../bootstrap.js";

export function registerTodoRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): void {
  const store = ctx.memoryStore;

  // GET /api/todos — List tasks
  app.get<{
    Querystring: {
      status?: string;
      priority?: string;
      limit?: string;
      offset?: string;
    };
  }>("/api/todos", async (req, reply) => {
    try {
      const { status, priority, limit, offset } = req.query;
      const result = store.listTasks(
        {
          status: status || undefined,
          priority: priority || undefined,
        },
        limit ? parseInt(limit, 10) : 100,
        offset ? parseInt(offset, 10) : 0,
      );
      return reply.send({
        items: result.items.map(serializeTask),
        total: result.total,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  // POST /api/todos — Create task
  app.post<{
    Body: {
      title: string;
      description?: string;
      priority?: string;
      dueDate?: string;
      assignee?: string;
      tags?: string[];
    };
  }>(
    "/api/todos",
    {
      schema: {
        body: {
          type: "object",
          required: ["title"],
          properties: {
            title: { type: "string", minLength: 1 },
            description: { type: "string" },
            priority: { type: "string", enum: ["low", "medium", "high"] },
            dueDate: { type: "string" },
            assignee: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const id = randomUUID().slice(0, 8);
        store.addTask({
          id,
          title: req.body.title,
          description: req.body.description,
          priority: req.body.priority,
          dueDate: req.body.dueDate,
          assignee: req.body.assignee,
          tags: req.body.tags,
          createdBy: "human",
        });
        // Fetch and return the created task
        const result = store.listTasks(undefined, 1, 0);
        const created = result.items.find((t) => t.id === id);
        return reply
          .status(201)
          .send(created ? serializeTask(created) : { id });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: message });
      }
    },
  );

  // PATCH /api/todos/:id — Update task
  app.patch<{
    Params: { id: string };
    Body: {
      title?: string;
      description?: string;
      status?: string;
      priority?: string;
      dueDate?: string | null;
      assignee?: string;
      tags?: string[];
    };
  }>("/api/todos/:id", async (req, reply) => {
    try {
      const updated = store.updateTask(req.params.id, req.body);
      if (!updated) {
        return reply
          .status(404)
          .send({ error: `Task not found: ${req.params.id}` });
      }
      return reply.send({ success: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  // DELETE /api/todos/:id — Delete task
  app.delete<{ Params: { id: string } }>(
    "/api/todos/:id",
    async (req, reply) => {
      try {
        const deleted = store.deleteTask(req.params.id);
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

function serializeTask(row: {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  due_date: string | null;
  assignee: string;
  created_by: string;
  session_id: string | null;
  trace_id: string | null;
  tags: string;
  created_at: string;
  updated_at: string;
}) {
  let tags: string[] = [];
  try {
    tags = JSON.parse(row.tags);
  } catch {}
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date,
    assignee: row.assignee,
    createdBy: row.created_by,
    sessionId: row.session_id,
    traceId: row.trace_id,
    tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
