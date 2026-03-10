import type { FastifyInstance } from "fastify";
import type { AppContext } from "../bootstrap.js";
import type { Message, ToolExecutionContext } from "@agentclaw/types";
import { basename, join, resolve, relative } from "node:path";
import { copyFileSync, mkdirSync } from "node:fs";
import { extractText } from "../utils.js";

function serializeSession(session: {
  id: string;
  conversationId: string;
  createdAt: Date;
  lastActiveAt: Date;
  title?: string;
  projectId?: string;
  preview?: string;
  metadata?: Record<string, unknown>;
}) {
  return {
    id: session.id,
    conversationId: session.conversationId,
    createdAt: session.createdAt.toISOString(),
    lastActiveAt: session.lastActiveAt.toISOString(),
    title: session.title,
    projectId: session.projectId ?? null,
    preview: session.preview ?? null,
    agentId: (session.metadata?.agentId as string) || "default",
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
  // POST /api/sessions - Create session (optional agentId, projectId in body)
  app.post<{ Body: { agentId?: string; projectId?: string } }>(
    "/api/sessions",
    async (req, reply) => {
      try {
        const agentId = req.body?.agentId || "default";
        const projectId = req.body?.projectId;
        const session = await ctx.orchestrator.createSession({ agentId });
        // Attach project if specified
        if (projectId) {
          (session as { projectId?: string }).projectId = projectId;
          await ctx.memoryStore.saveSession(session);
        }
        return reply.send(serializeSession(session));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: message });
      }
    },
  );

  // GET /api/sessions - List sessions (optional ?projectId=xxx filter)
  app.get<{ Querystring: { projectId?: string } }>(
    "/api/sessions",
    async (req, reply) => {
      try {
        const sessions = await ctx.orchestrator.listSessions();
        const { projectId } = req.query;
        const filtered = projectId
          ? sessions.filter(
              (s) =>
                (s as typeof s & { projectId?: string }).projectId ===
                projectId,
            )
          : sessions;
        return reply.send(
          filtered.map((s) =>
            serializeSession(
              s as typeof s & { metadata?: Record<string, unknown> },
            ),
          ),
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: message });
      }
    },
  );

  // DELETE /api/sessions/:id - Close session
  app.delete<{ Params: { id: string } }>(
    "/api/sessions/:id",
    {
      schema: {
        // 校验路径参数：id 不能为空
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 1 } },
        },
      },
    },
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

  // PATCH /api/sessions/:id - Update session (title, projectId)
  app.patch<{
    Params: { id: string };
    Body: { title?: string; projectId?: string | null };
  }>(
    "/api/sessions/:id",
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
        const session = await ctx.orchestrator.getSession(req.params.id);
        if (!session) {
          return reply.status(404).send({ error: "Session not found" });
        }
        const updated = { ...session };
        if (req.body.title !== undefined) updated.title = req.body.title;
        if (req.body.projectId !== undefined) {
          (updated as { projectId?: string }).projectId =
            req.body.projectId ?? undefined;
        }
        await ctx.memoryStore.saveSession(updated);
        return reply.send(serializeSession(updated));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: message });
      }
    },
  );

  // POST /api/sessions/:id/chat - Send message
  app.post<{ Params: { id: string }; Body: { content: string } }>(
    "/api/sessions/:id/chat",
    {
      schema: {
        // 校验路径参数：id 不能为空
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 1 } },
        },
        // 校验请求体：content 必填，至少 1 个字符
        body: {
          type: "object",
          required: ["content"],
          properties: {
            content: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const { id } = req.params;
        const { content } = req.body;

        const session = await ctx.orchestrator.getSession(id);
        if (!session) {
          return reply.status(404).send({ error: `Session not found: ${id}` });
        }

        // Provide sendFile so tools like send_file work in REST mode too
        const tmpDir = resolve(process.cwd(), "data", "tmp");
        const sentFiles: Array<{ url: string; filename: string }> = [];
        const toolContext: ToolExecutionContext = {
          sentFiles,
          sendFile: async (filePath: string) => {
            const filename = basename(filePath);
            const abs = resolve(filePath);
            let relPath = filename;
            if (abs.startsWith(tmpDir)) {
              relPath = relative(tmpDir, abs).replace(/\\/g, "/");
            } else {
              mkdirSync(tmpDir, { recursive: true });
              try {
                copyFileSync(abs, join(tmpDir, filename));
              } catch {}
            }
            const url = `/files/${relPath.split("/").map(encodeURIComponent).join("/")}`;
            if (!sentFiles.some((f) => f.url === url)) {
              sentFiles.push({ url, filename });
            }
          },
        };
        const message = await ctx.orchestrator.processInput(
          id,
          content,
          toolContext,
        );
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
    {
      schema: {
        // 校验路径参数：id 不能为空
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 1 } },
        },
        // 校验查询参数：limit 可选，数字字符串
        querystring: {
          type: "object",
          properties: {
            limit: { type: "string", pattern: "^[0-9]+$" },
          },
        },
      },
    },
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

  // DELETE /api/sessions/:id/turns?from=<ISO timestamp>
  // Truncate conversation history from a given timestamp (inclusive)
  app.delete<{ Params: { id: string }; Querystring: { from: string } }>(
    "/api/sessions/:id/turns",
    async (req, reply) => {
      try {
        const { id } = req.params;
        const from = req.query.from;
        if (!from) {
          return reply
            .status(400)
            .send({ error: 'Missing required query param "from"' });
        }

        const session = await ctx.orchestrator.getSession(id);
        if (!session) {
          return reply.status(404).send({ error: `Session not found: ${id}` });
        }

        if (!ctx.memoryStore.deleteTurnsFrom) {
          return reply
            .status(501)
            .send({ error: "deleteTurnsFrom not supported" });
        }

        const deleted = await ctx.memoryStore.deleteTurnsFrom(
          session.conversationId,
          from,
        );
        return reply.send({ deleted });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: message });
      }
    },
  );
}
