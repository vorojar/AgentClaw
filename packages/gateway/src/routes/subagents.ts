import type { FastifyInstance } from "fastify";
import type { AppContext } from "../bootstrap.js";

function serializeRow(row: {
  id: string;
  session_id: string | null;
  goal: string;
  model: string | null;
  status: string;
  result: string | null;
  error: string | null;
  tokens_in: number;
  tokens_out: number;
  tools_used: string;
  iterations: number;
  created_at: string;
  completed_at: string | null;
}) {
  let toolsUsed: string[] = [];
  try {
    toolsUsed = JSON.parse(row.tools_used);
  } catch {}
  return {
    id: row.id,
    sessionId: row.session_id,
    goal: row.goal,
    model: row.model,
    status: row.status,
    result: row.result,
    error: row.error,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    toolsUsed,
    iterations: row.iterations,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export function registerSubAgentRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): void {
  const store = ctx.memoryStore;

  // GET /api/subagents — List sub-agents
  app.get<{
    Querystring: {
      session_id?: string;
      status?: string;
      limit?: string;
      offset?: string;
    };
  }>("/api/subagents", async (req, reply) => {
    try {
      const { session_id, status, limit, offset } = req.query;
      const result = store.listSubAgents(
        {
          sessionId: session_id || undefined,
          status: status || undefined,
        },
        limit ? parseInt(limit, 10) : 20,
        offset ? parseInt(offset, 10) : 0,
      );
      return reply.send({
        items: result.items.map(serializeRow),
        total: result.total,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  // GET /api/subagents/:id — Get sub-agent detail
  app.get<{ Params: { id: string } }>(
    "/api/subagents/:id",
    async (req, reply) => {
      try {
        const row = store.getSubAgent(req.params.id);
        if (!row) {
          return reply
            .status(404)
            .send({ error: `SubAgent not found: ${req.params.id}` });
        }
        return reply.send(serializeRow(row));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: message });
      }
    },
  );
}
