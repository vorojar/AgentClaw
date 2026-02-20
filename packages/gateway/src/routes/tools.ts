import type { FastifyInstance } from "fastify";
import type { AppContext } from "../bootstrap.js";

export function registerToolRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): void {
  // GET /api/tools - List tools
  app.get("/api/tools", async (_req, reply) => {
    try {
      const tools = ctx.toolRegistry.list();
      const result = tools.map((t) => ({
        name: t.name,
        description: t.description,
        category: t.category,
      }));
      return reply.send(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  // GET /api/skills - List skills
  app.get("/api/skills", async (_req, reply) => {
    try {
      const skills = ctx.skillRegistry.list();
      const result = skills.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        enabled: s.enabled,
      }));
      return reply.send(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });
}
