import { basename, join, extname, resolve, relative } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "./bootstrap.js";
import type {
  ContentBlock,
  Message,
  ToolExecutionContext,
} from "@agentclaw/types";

const IMAGE_EXTS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
]);
const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};
// 捕获原始文件名(group 1)和保存文件名(group 2)
const UPLOAD_RE = /\[Uploaded:\s*([^\]]*)\]\(\/files\/([^)]+)\)/g;

/**
 * 解析用户消息中的上传文件链接：
 * - 图片文件：转为 base64 ContentBlock，LLM 可直接看到
 * - 非图片文件：注入文件路径提示，LLM 可用 file_read 工具读取内容
 */
async function parseUserContent(
  text: string,
): Promise<string | ContentBlock[]> {
  const matches = [...text.matchAll(UPLOAD_RE)];
  if (matches.length === 0) return text;

  const blocks: ContentBlock[] = [];
  // 非图片文件的路径提示，引导 LLM 使用 file_read 读取
  const fileHints: string[] = [];

  for (const m of matches) {
    const originalName = m[1].trim();
    const savedName = decodeURIComponent(m[2]);
    const ext = extname(savedName).toLowerCase();
    const filePath = join(process.cwd(), "data", "tmp", savedName);

    if (IMAGE_EXTS.has(ext)) {
      // 图片：转为 base64 ContentBlock
      if (existsSync(filePath)) {
        try {
          const buf = await readFile(filePath);
          blocks.push({
            type: "image",
            data: buf.toString("base64"),
            mediaType: MIME_MAP[ext] ?? "image/jpeg",
          });
        } catch {
          /* 跳过不可读文件 */
        }
      }
    } else {
      // 非图片：注入文件路径 + 原始文件名提示
      if (existsSync(filePath)) {
        const absPath = filePath.replace(/\\/g, "/");
        fileHints.push(
          `[Attached file: "${originalName}" | filepath="${absPath}" | Use this exact filepath variable in your code. Use original filename "${originalName}" when sending as attachment.]`,
        );
      }
    }
  }

  // 清理上传链接标记，保留其他文本
  let cleanText = text
    .replace(UPLOAD_RE, "")
    .replace(/\n{3,}/g, "\n")
    .trim();

  // 拼接非图片文件路径提示
  if (fileHints.length > 0) {
    cleanText = cleanText
      ? `${cleanText}\n${fileHints.join("\n")}`
      : fileHints.join("\n");
  }

  if (cleanText) {
    blocks.push({ type: "text", text: cleanText });
  }

  return blocks.length > 0 ? blocks : text;
}

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

/** Ping interval (ms) — keeps Cloudflare Tunnel / reverse proxies alive */
const WS_PING_INTERVAL = 30_000;

export function registerWebSocket(app: FastifyInstance, ctx: AppContext): void {
  app.get("/ws", { websocket: true }, (socket, req) => {
    wsClients.add(socket);

    /** Safe send — silently drops if socket is not OPEN */
    function safeSend(data: string): void {
      if (socket.readyState === 1 /* OPEN */) {
        try {
          socket.send(data);
        } catch {
          /* socket closed between check and send — ignore */
        }
      }
    }

    // ── Server-side ping to keep connection alive through proxies ──
    let alive = true;
    let missedPongs = 0;
    const pingTimer = setInterval(() => {
      if (!alive) {
        missedPongs++;
        // Tolerate 2 missed pongs (60s) before killing — long tasks may delay browser
        if (missedPongs >= 2) {
          socket.terminate();
          return;
        }
      } else {
        missedPongs = 0;
      }
      alive = false;
      socket.ping();
    }, WS_PING_INTERVAL);
    socket.on("pong", () => {
      alive = true;
      missedPongs = 0;
    });
    socket.on("close", () => {
      clearInterval(pingTimer);
      wsClients.delete(socket);
    });

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

    // promptUser support: resolve pending prompt when user replies
    let pendingPrompt: ((answer: string) => void) | null = null;

    socket.on("message", async (rawData: Buffer | string) => {
      let parsed: { type?: string; content?: string; skillName?: string };
      try {
        const str =
          typeof rawData === "string" ? rawData : rawData.toString("utf-8");
        parsed = JSON.parse(str);
      } catch {
        safeSend(JSON.stringify({ type: "error", error: "Invalid JSON" }));
        return;
      }

      if (parsed.type === "stop") {
        const stopped = ctx.orchestrator.stopSession(sessionId);
        safeSend(JSON.stringify({ type: "stopped", success: stopped }));
        return;
      }

      if (parsed.type === "prompt_reply") {
        if (pendingPrompt) {
          pendingPrompt(parsed.content ?? "");
          pendingPrompt = null;
        }
        return;
      }

      if (parsed.type !== "message" || !parsed.content) {
        safeSend(
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
          safeSend(
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
          preSelectedSkillName: parsed.skillName || undefined,
          sendFile: async (filePath: string) => {
            const filename = basename(filePath);
            // Preserve subdirectory path relative to data/tmp for correct static serving
            const tmpDir = resolve(process.cwd(), "data", "tmp");
            const tempDir = resolve(process.cwd(), "data", "temp");
            const abs = resolve(filePath);
            let relPath = filename;
            if (abs.startsWith(tmpDir)) {
              relPath = relative(tmpDir, abs).replace(/\\/g, "/");
            } else if (abs.startsWith(tempDir)) {
              relPath = relative(tempDir, abs).replace(/\\/g, "/");
            }
            const url = `/files/${relPath.split("/").map(encodeURIComponent).join("/")}`;
            if (!sentFiles.some((f) => f.url === url)) {
              sentFiles.push({ url, filename });
            }
            safeSend(JSON.stringify({ type: "file", url, filename }));
          },
          streamText: (text: string) => {
            safeSend(JSON.stringify({ type: "text", text }));
          },
          todoNotify: (items: Array<{ text: string; done: boolean }>) => {
            safeSend(JSON.stringify({ type: "todo_update", items }));
          },
          promptUser: (question: string) => {
            return new Promise<string>((resolve) => {
              pendingPrompt = resolve;
              safeSend(JSON.stringify({ type: "prompt", question }));
            });
          },
        };

        // Convert uploaded images to multimodal ContentBlock[]
        // 保留原始文本，agent-loop 用于 DB 存储（刷新后显示的是这个）
        context.originalUserText = parsed.content;
        const userContent = await parseUserContent(parsed.content);

        // Use processInputStream for streaming events
        const eventStream = ctx.orchestrator.processInputStream(
          sessionId,
          userContent,
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
              safeSend(
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
              safeSend(
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
              safeSend(
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
              safeSend(
                JSON.stringify({
                  type: "error",
                  error: data.message || data.error || "Unknown error",
                }),
              );
              break;
            }
            case "thinking":
              safeSend(JSON.stringify({ type: "thinking" }));
              break;
            default:
              // state_change — skip
              break;
          }
        }

        safeSend(JSON.stringify({ type: "done", ...usageStats }));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        safeSend(JSON.stringify({ type: "error", error: message }));
        safeSend(JSON.stringify({ type: "done" }));
      }
    });
  });
}
