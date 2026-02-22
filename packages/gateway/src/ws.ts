import { basename } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "./bootstrap.js";
import type {
  ContentBlock,
  Message,
  ToolExecutionContext,
} from "@agentclaw/types";

function extractTextFromMessage(message: Message): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function extractToolCalls(
  content: string | ContentBlock[],
): Array<{ name: string; input: Record<string, unknown> }> {
  if (typeof content === "string") return [];
  return content
    .filter(
      (
        b,
      ): b is {
        type: "tool_use";
        id: string;
        name: string;
        input: Record<string, unknown>;
      } => b.type === "tool_use",
    )
    .map((b) => ({ name: b.name, input: b.input }));
}

const wsClients = new Set<import("ws").WebSocket>();

/** Get all active WebSocket clients for broadcasting */
export function getWsClients(): Set<import("ws").WebSocket> {
  return wsClients;
}

export function registerWebSocket(app: FastifyInstance, ctx: AppContext): void {
  app.get("/ws", { websocket: true }, (socket, req) => {
    wsClients.add(socket);
    socket.on("close", () => wsClients.delete(socket));
    const sessionId = (req.query as Record<string, string>).sessionId;

    if (!sessionId) {
      socket.send(
        JSON.stringify({
          type: "error",
          error: "Missing sessionId query parameter",
        }),
      );
      socket.close();
      return;
    }

    socket.on("message", async (rawData: Buffer | string) => {
      let parsed: { type?: string; content?: string };
      try {
        const str =
          typeof rawData === "string" ? rawData : rawData.toString("utf-8");
        parsed = JSON.parse(str);
      } catch {
        socket.send(JSON.stringify({ type: "error", error: "Invalid JSON" }));
        return;
      }

      if (parsed.type === "stop") {
        const stopped = ctx.orchestrator.stopSession(sessionId);
        socket.send(JSON.stringify({ type: "stopped", success: stopped }));
        return;
      }

      if (parsed.type !== "message" || !parsed.content) {
        socket.send(
          JSON.stringify({
            type: "error",
            error: "Expected { type: 'message', content: '...' }",
          }),
        );
        return;
      }

      try {
        // Verify session exists
        const session = await ctx.orchestrator.getSession(sessionId);
        if (!session) {
          socket.send(
            JSON.stringify({
              type: "error",
              error: `Session not found: ${sessionId}`,
            }),
          );
          return;
        }

        // Build tool execution context with sendFile support
        const sentFiles: Array<{ url: string; filename: string }> = [];
        const context: ToolExecutionContext = {
          sentFiles,
          sendFile: async (filePath: string) => {
            const filename = basename(filePath);
            const url = `/files/${encodeURIComponent(filename)}`;
            sentFiles.push({ url, filename });
            socket.send(JSON.stringify({ type: "file", url, filename }));
          },
        };

        // Use processInputStream for streaming events
        const eventStream = ctx.orchestrator.processInputStream(
          sessionId,
          parsed.content,
          context,
        );

        // Usage stats to send with the "done" message
        let usageStats: {
          model?: string;
          tokensIn?: number;
          tokensOut?: number;
          durationMs?: number;
          toolCallCount?: number;
        } = {};

        for await (const event of eventStream) {
          switch (event.type) {
            case "tool_call": {
              const data = event.data as { name: string; input: unknown };
              socket.send(
                JSON.stringify({
                  type: "tool_call",
                  toolName: data.name,
                  toolInput:
                    typeof data.input === "string"
                      ? data.input
                      : JSON.stringify(data.input),
                }),
              );
              break;
            }
            case "tool_result": {
              const data = event.data as {
                name: string;
                result: { content: string };
              };
              socket.send(
                JSON.stringify({
                  type: "tool_result",
                  toolName: data.name,
                  toolResult: data.result.content,
                }),
              );
              break;
            }
            case "response_chunk": {
              const data = event.data as { text: string };
              socket.send(
                JSON.stringify({
                  type: "text",
                  text: data.text,
                }),
              );
              break;
            }
            case "response_complete": {
              const data = event.data as { message: Message };
              usageStats = {
                model: data.message.model,
                tokensIn: data.message.tokensIn,
                tokensOut: data.message.tokensOut,
                durationMs: data.message.durationMs,
                toolCallCount: data.message.toolCallCount,
              };
              break;
            }
            case "error": {
              const data = event.data as { message?: string; error?: string };
              socket.send(
                JSON.stringify({
                  type: "error",
                  error: data.message || data.error || "Unknown error",
                }),
              );
              break;
            }
            case "thinking":
              socket.send(JSON.stringify({ type: "thinking" }));
              break;
            default:
              // state_change — skip
              break;
          }
        }

        socket.send(JSON.stringify({ type: "done", ...usageStats }));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        socket.send(JSON.stringify({ type: "error", error: message }));
        socket.send(JSON.stringify({ type: "done" }));
      }
    });
  });
}
