import type { FastifyInstance } from "fastify";
import { runGws } from "../gws.js";

/** Normalized task item returned to the frontend */
interface GoogleTaskItem {
  id: string;
  title: string;
  notes: string;
  status: "needsAction" | "completed";
  due?: string;
  updated: string;
  parent?: string;
  position: string;
}

function normalizeTask(raw: Record<string, unknown>): GoogleTaskItem {
  return {
    id: raw.id as string,
    title: (raw.title as string) || "",
    notes: (raw.notes as string) || "",
    status: (raw.status as "needsAction" | "completed") || "needsAction",
    due: raw.due as string | undefined,
    updated: (raw.updated as string) || "",
    parent: raw.parent as string | undefined,
    position: (raw.position as string) || "0",
  };
}

export function registerGoogleTasksRoutes(app: FastifyInstance): void {
  // GET /api/google-tasks?tasklist=@default&showCompleted=false
  app.get<{
    Querystring: { tasklist?: string; showCompleted?: string };
  }>("/api/google-tasks", async (req, reply) => {
    const tasklist = req.query.tasklist || "@default";
    const showCompleted = req.query.showCompleted === "true";

    const result = await runGws([
      "tasks",
      "tasks",
      "list",
      "--params",
      JSON.stringify({
        tasklist,
        showCompleted,
        maxResults: 100,
      }),
    ]);

    if (!result.ok) {
      return reply.status(502).send({ error: result.error });
    }

    const data = result.data as { items?: Record<string, unknown>[] };
    const items = (data?.items || []).map(normalizeTask);
    return reply.send({ items });
  });

  // GET /api/google-tasks/lists — list all task lists
  app.get("/api/google-tasks/lists", async (_req, reply) => {
    const result = await runGws(["tasks", "tasklists", "list"]);
    if (!result.ok) {
      return reply.status(502).send({ error: result.error });
    }
    const data = result.data as {
      items?: { id: string; title: string }[];
    };
    return reply.send({ items: data?.items || [] });
  });

  // POST /api/google-tasks — create a task
  app.post<{
    Body: {
      title: string;
      notes?: string;
      due?: string;
      tasklist?: string;
    };
  }>(
    "/api/google-tasks",
    {
      schema: {
        body: {
          type: "object",
          required: ["title"],
          properties: {
            title: { type: "string", minLength: 1 },
            notes: { type: "string" },
            due: { type: "string" },
            tasklist: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      const tasklist = req.body.tasklist || "@default";
      const json: Record<string, string> = { title: req.body.title };
      if (req.body.notes) json.notes = req.body.notes;
      if (req.body.due) json.due = req.body.due;

      const result = await runGws([
        "tasks",
        "tasks",
        "insert",
        "--params",
        JSON.stringify({ tasklist }),
        "--json",
        JSON.stringify(json),
      ]);

      if (!result.ok) {
        return reply.status(502).send({ error: result.error });
      }
      return reply
        .status(201)
        .send(normalizeTask(result.data as Record<string, unknown>));
    },
  );

  // PATCH /api/google-tasks/:id — update/complete a task
  app.patch<{
    Params: { id: string };
    Body: {
      title?: string;
      notes?: string;
      status?: "needsAction" | "completed";
      due?: string | null;
      tasklist?: string;
    };
  }>("/api/google-tasks/:id", async (req, reply) => {
    const tasklist = req.body.tasklist || "@default";
    const json: Record<string, unknown> = {};
    if (req.body.title !== undefined) json.title = req.body.title;
    if (req.body.notes !== undefined) json.notes = req.body.notes;
    if (req.body.status !== undefined) json.status = req.body.status;
    if (req.body.due !== undefined) json.due = req.body.due;

    const result = await runGws([
      "tasks",
      "tasks",
      "patch",
      "--params",
      JSON.stringify({ tasklist, task: req.params.id }),
      "--json",
      JSON.stringify(json),
    ]);

    if (!result.ok) {
      return reply.status(502).send({ error: result.error });
    }
    return reply.send(normalizeTask(result.data as Record<string, unknown>));
  });

  // DELETE /api/google-tasks/:id
  app.delete<{
    Params: { id: string };
    Querystring: { tasklist?: string };
  }>("/api/google-tasks/:id", async (req, reply) => {
    const tasklist = req.query.tasklist || "@default";

    const result = await runGws([
      "tasks",
      "tasks",
      "delete",
      "--params",
      JSON.stringify({ tasklist, task: req.params.id }),
    ]);

    if (!result.ok) {
      return reply.status(502).send({ error: result.error });
    }
    return reply.status(204).send();
  });
}
