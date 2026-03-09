import type { FastifyInstance } from "fastify";
import type { AppContext } from "../bootstrap.js";

function serializeProject(p: {
  id: string;
  name: string;
  description?: string;
  instructions?: string;
  color?: string;
  createdAt: Date;
  updatedAt: Date;
  sessionCount?: number;
}) {
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? "",
    instructions: p.instructions ?? "",
    color: p.color ?? "#6B7F5E",
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    sessionCount: p.sessionCount ?? 0,
  };
}

export function registerProjectRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): void {
  // POST /api/projects — Create project
  app.post<{
    Body: {
      name: string;
      description?: string;
      instructions?: string;
      color?: string;
    };
  }>("/api/projects", async (req, reply) => {
    try {
      const { name, description, instructions, color } = req.body;
      if (!name || !name.trim()) {
        return reply.status(400).send({ error: "name is required" });
      }
      const project = await ctx.memoryStore.createProject({
        name: name.trim(),
        description,
        instructions,
        color,
      });
      return reply.status(201).send(serializeProject(project));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  // GET /api/projects — List projects
  app.get("/api/projects", async (_req, reply) => {
    try {
      const projects = await ctx.memoryStore.listProjects();
      return reply.send(projects.map(serializeProject));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  // GET /api/projects/:id — Get project
  app.get<{ Params: { id: string } }>(
    "/api/projects/:id",
    async (req, reply) => {
      try {
        const project = await ctx.memoryStore.getProject(req.params.id);
        if (!project) {
          return reply.status(404).send({ error: "Project not found" });
        }
        return reply.send(serializeProject(project));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: message });
      }
    },
  );

  // PUT /api/projects/:id — Update project
  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      description?: string;
      instructions?: string;
      color?: string;
    };
  }>("/api/projects/:id", async (req, reply) => {
    try {
      const project = await ctx.memoryStore.updateProject(
        req.params.id,
        req.body,
      );
      return reply.send(serializeProject(project));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  // DELETE /api/projects/:id — Delete project
  app.delete<{ Params: { id: string } }>(
    "/api/projects/:id",
    async (req, reply) => {
      try {
        await ctx.memoryStore.deleteProject(req.params.id);
        return reply.status(204).send();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: message });
      }
    },
  );
}
