import type { FastifyInstance } from "fastify";
import type { AppContext } from "../bootstrap.js";
import type { Plan } from "@agentclaw/types";

function serializePlan(plan: Plan) {
  return {
    id: plan.id,
    goal: plan.goal,
    status: plan.status,
    steps: plan.steps.map((s) => ({
      id: s.id,
      description: s.description,
      status: s.status,
      result: s.result,
      error: s.error,
    })),
    createdAt: plan.createdAt.toISOString(),
    completedAt: plan.completedAt?.toISOString(),
  };
}

export function registerPlanRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): void {
  // GET /api/plans - List plans
  app.get("/api/plans", async (_req, reply) => {
    try {
      const plans = await ctx.planner.list();
      return reply.send(plans.map(serializePlan));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  // GET /api/plans/:id - Get plan detail
  app.get<{ Params: { id: string } }>("/api/plans/:id", async (req, reply) => {
    try {
      const plan = await ctx.planner.getPlan(req.params.id);
      if (!plan) {
        return reply
          .status(404)
          .send({ error: `Plan not found: ${req.params.id}` });
      }
      return reply.send(serializePlan(plan));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });
}
