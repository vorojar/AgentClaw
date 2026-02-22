import type { FastifyInstance } from "fastify";
import type { AppContext } from "../bootstrap.js";
import type { Message, ContentBlock } from "@agentclaw/types";

function extractText(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function serializeSession(session: {
  id: string;
  conversationId: string;
  createdAt: Date;
  lastActiveAt: Date;
  title?: string;
}) {
  return {
    id: session.id,
    conversationId: session.conversationId,
    createdAt: session.createdAt.toISOString(),
    lastActiveAt: session.lastActiveAt.toISOString(),
    title: session.title,
  };
}

function serializeMessage(msg: Message) {
  return {
    role: msg.role,
    content: extractText(msg.content),
    model: msg.model,
    tokensIn: msg.tokensIn,
    tokensOut: msg.tokensOut,
    durationMs: msg.durationMs,
    toolCallCount: msg.toolCallCount,
    createdAt: msg.createdAt.toISOString(),
  };
}

export function registerSessionRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): void {
  // POST /api/sessions - Create session
  app.post("/api/sessions", async (_req, reply) => {
    try {
      const session = await ctx.orchestrator.createSession();
      return reply.send(serializeSession(session));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  // GET /api/sessions - List sessions
  app.get("/api/sessions", async (_req, reply) => {
    try {
      const sessions = await ctx.orchestrator.listSessions();
      return reply.send(sessions.map(serializeSession));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  // DELETE /api/sessions/:id - Close session
  app.delete<{ Params: { id: string } }>(
    "/api/sessions/:id",
    async (req, reply) => {
      try {
        await ctx.orchestrator.closeSession(req.params.id);
        return reply.status(204).send();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: message });
      }
    },
  );

  // POST /api/sessions/:id/chat - Send message
  app.post<{ Params: { id: string }; Body: { content: string } }>(
    "/api/sessions/:id/chat",
    async (req, reply) => {
      try {
        const { id } = req.params;
        const { content } = req.body;

        if (!content) {
          return reply
            .status(400)
            .send({ error: "Missing content in request body" });
        }

        const session = await ctx.orchestrator.getSession(id);
        if (!session) {
          return reply.status(404).send({ error: `Session not found: ${id}` });
        }

        const message = await ctx.orchestrator.processInput(id, content);
        return reply.send({ message: serializeMessage(message) });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: message });
      }
    },
  );

  // GET /api/sessions/:id/history - Get conversation history
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    "/api/sessions/:id/history",
    async (req, reply) => {
      try {
        const { id } = req.params;
        const limit = req.query.limit
          ? parseInt(req.query.limit, 10)
          : undefined;

        const session = await ctx.orchestrator.getSession(id);
        if (!session) {
          return reply.status(404).send({ error: `Session not found: ${id}` });
        }

        const turns = await ctx.memoryStore.getHistory(
          session.conversationId,
          limit,
        );
        const messages = turns.map((turn) => ({
          role: turn.role,
          content: turn.content,
          model: turn.model,
          tokensIn: turn.tokensIn,
          tokensOut: turn.tokensOut,
          durationMs: turn.durationMs,
          toolCallCount: turn.toolCallCount,
          createdAt: turn.createdAt.toISOString(),
          ...(turn.toolCalls ? { toolCalls: turn.toolCalls } : {}),
          ...(turn.toolResults ? { toolResults: turn.toolResults } : {}),
        }));

        return reply.send(messages);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: message });
      }
    },
  );
}
