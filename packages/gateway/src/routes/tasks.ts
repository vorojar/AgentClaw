import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../bootstrap.js";
import type { TaskScheduler } from "../scheduler.js";

/**
 * 序列化 TaskRow → 前端友好的 JSON 对象
 * snake_case → camelCase，JSON 字段解析
 */
function serializeTask(row: Record<string, unknown>) {
  let tags: string[] = [];
  try {
    tags = JSON.parse((row.tags as string) || "[]");
  } catch {}
  let decisionOptions: string[] | null = null;
  try {
    if (row.decision_options) {
      decisionOptions = JSON.parse(row.decision_options as string);
    }
  } catch {}
  let traceIds: string[] = [];
  try {
    traceIds = JSON.parse((row.trace_ids as string) || "[]");
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
    executor: row.executor,
    source: row.source,
    sourceMsgId: row.source_msg_id,
    scheduledAt: row.scheduled_at,
    deadline: row.deadline,
    recurrence: row.recurrence,
    parentId: row.parent_id,
    result: row.result,
    decisionContext: row.decision_context,
    decisionOptions,
    decisionResult: row.decision_result,
    traceIds,
    progress: row.progress,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function registerTaskRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  scheduler?: TaskScheduler,
): void {
  const store = ctx.memoryStore;

  // taskManager 可能还没挂载，用可选访问
  const getTaskManager = () =>
    (ctx as unknown as Record<string, unknown>).taskManager as
      | {
          captureTask(
            text: string,
            source: string,
          ): Promise<Record<string, unknown>>;
          generateDailyBrief(): Promise<string>;
          executeTask(id: string): Promise<Record<string, unknown>>;
          resolveDecision(
            id: string,
            decision: string,
          ): Promise<Record<string, unknown>>;
        }
      | undefined;

  // GET /api/tasks — 任务列表
  app.get<{
    Querystring: {
      status?: string;
      executor?: string;
      priority?: string;
      limit?: string;
      offset?: string;
    };
  }>("/api/tasks", async (req, reply) => {
    try {
      const { status, executor, priority, limit, offset } = req.query;
      const result = store.listTasks(
        {
          status: status || undefined,
          priority: priority || undefined,
          assignee: executor || undefined,
        },
        limit ? parseInt(limit, 10) : 100,
        offset ? parseInt(offset, 10) : 0,
      );
      const stats = store.getTaskStats();
      return reply.send({
        items: result.items.map(serializeTask),
        total: result.total,
        stats,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  // GET /api/tasks/stats — 统计
  app.get("/api/tasks/stats", async (_req, reply) => {
    try {
      const stats = store.getTaskStats();
      return reply.send(stats);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  // GET /api/tasks/brief — 今日简报
  app.get("/api/tasks/brief", async (_req, reply) => {
    try {
      const tm = getTaskManager();
      if (tm) {
        const brief = await tm.generateDailyBrief();
        return reply.send({ brief });
      }
      // 没有 taskManager，返回简单统计
      const stats = store.getTaskStats();
      return reply.send({ brief: null, stats });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  // GET /api/tasks/:id — 单个任务详情
  app.get<{ Params: { id: string } }>(
    "/api/tasks/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 1 } },
        },
      },
    },
    async (req, reply) => {
      try {
        const task = store.getTask(req.params.id);
        if (!task) {
          return reply
            .status(404)
            .send({ error: `Task not found: ${req.params.id}` });
        }
        return reply.send(serializeTask(task));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: message });
      }
    },
  );

  // POST /api/tasks — 创建任务
  // 支持两种方式：
  //   1. { text: "..." } — 自然语言，通过 taskManager.captureTask() 创建
  //   2. { task: { title, description, priority, deadline, executor } } — 结构化创建
  app.post<{
    Body: {
      text?: string;
      task?: {
        title: string;
        description?: string;
        priority?: string;
        deadline?: string;
        executor?: string;
        dueDate?: string;
        assignee?: string;
        tags?: string[];
      };
    };
  }>("/api/tasks", async (req, reply) => {
    try {
      const { text, task } = req.body ?? {};

      // 自然语言创建
      if (text) {
        const tm = getTaskManager();
        if (!tm) {
          return reply.status(400).send({
            error: "TaskManager not available for natural language capture",
          });
        }
        const created = await tm.captureTask(text, "web");
        return reply.status(201).send(created);
      }

      // 结构化创建
      if (task) {
        if (!task.title) {
          return reply.status(400).send({ error: "task.title is required" });
        }
        const id = randomUUID().slice(0, 8);
        store.addTask({
          id,
          title: task.title,
          description: task.description,
          priority: task.priority,
          dueDate: task.deadline ?? task.dueDate,
          assignee: task.executor ?? task.assignee,
          tags: task.tags,
          createdBy: "human",
        });
        const created = store.getTask(id);
        return reply
          .status(201)
          .send(created ? serializeTask(created) : { id });
      }

      return reply
        .status(400)
        .send({ error: "Either 'text' or 'task' field is required" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  // PATCH /api/tasks/:id — 更新任务
  app.patch<{
    Params: { id: string };
    Body: {
      title?: string;
      description?: string;
      status?: string;
      priority?: string;
      dueDate?: string | null;
      assignee?: string;
      executor?: string;
      deadline?: string | null;
      tags?: string[];
      scheduledAt?: string | null;
      recurrence?: string | null;
      parentId?: string | null;
      result?: string | null;
      progress?: number;
    };
  }>(
    "/api/tasks/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 1 } },
        },
      },
    },
    async (req, reply) => {
      try {
        const existing = store.getTask(req.params.id);
        if (!existing) {
          return reply
            .status(404)
            .send({ error: `Task not found: ${req.params.id}` });
        }
        const updated = store.updateTask(req.params.id, req.body);
        if (!updated) {
          return reply.status(400).send({ error: "No valid fields to update" });
        }
        // 返回更新后的完整任务
        const task = store.getTask(req.params.id);
        return reply.send(task ? serializeTask(task) : { id: req.params.id });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: message });
      }
    },
  );

  // DELETE /api/tasks/:id — 删除任务
  app.delete<{ Params: { id: string } }>(
    "/api/tasks/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 1 } },
        },
      },
    },
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

  // POST /api/tasks/:id/execute — 手动触发执行
  app.post<{ Params: { id: string } }>(
    "/api/tasks/:id/execute",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 1 } },
        },
      },
    },
    async (req, reply) => {
      try {
        const existing = store.getTask(req.params.id);
        if (!existing) {
          return reply
            .status(404)
            .send({ error: `Task not found: ${req.params.id}` });
        }
        const tm = getTaskManager();
        if (!tm) {
          return reply.status(400).send({ error: "TaskManager not available" });
        }
        const result = await tm.executeTask(req.params.id);
        // 返回执行后的完整任务
        const task = store.getTask(req.params.id);
        return reply.send({
          result,
          task: task ? serializeTask(task) : null,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: message });
      }
    },
  );

  // POST /api/tasks/:id/decide — 提交决策
  app.post<{ Params: { id: string }; Body: { decision: string } }>(
    "/api/tasks/:id/decide",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 1 } },
        },
        body: {
          type: "object",
          required: ["decision"],
          properties: {
            decision: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const existing = store.getTask(req.params.id);
        if (!existing) {
          return reply
            .status(404)
            .send({ error: `Task not found: ${req.params.id}` });
        }
        const tm = getTaskManager();
        if (tm) {
          const result = await tm.resolveDecision(
            req.params.id,
            req.body.decision,
          );
          const task = store.getTask(req.params.id);
          return reply.send({
            result,
            task: task ? serializeTask(task) : null,
          });
        }
        // 没有 taskManager，直接更新 decisionResult 字段
        store.updateTask(req.params.id, {
          decisionResult: req.body.decision,
          status: "queued",
        });
        const task = store.getTask(req.params.id);
        return reply.send(task ? serializeTask(task) : { id: req.params.id });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: message });
      }
    },
  );

  // ─── Scheduled Tasks (Automations) ───

  // GET /api/tasks/scheduled — 列出所有定时任务
  app.get("/api/tasks/scheduled", async (_req, reply) => {
    if (!scheduler) return reply.send([]);
    return reply.send(scheduler.list());
  });

  // POST /api/tasks/scheduled — 创建定时任务
  app.post<{
    Body: {
      name: string;
      cron: string;
      action: string;
      enabled: boolean;
    };
  }>("/api/tasks/scheduled", async (req, reply) => {
    if (!scheduler) {
      return reply.status(400).send({ error: "Scheduler not available" });
    }
    const task = scheduler.create(req.body);
    return reply.status(201).send(task);
  });

  // DELETE /api/tasks/scheduled/:id — 删除定时任务
  app.delete<{ Params: { id: string } }>(
    "/api/tasks/scheduled/:id",
    async (req, reply) => {
      if (!scheduler) {
        return reply.status(400).send({ error: "Scheduler not available" });
      }
      const deleted = scheduler.delete(req.params.id);
      if (!deleted) {
        return reply.status(404).send({ error: "Scheduled task not found" });
      }
      return reply.status(204).send();
    },
  );
}
