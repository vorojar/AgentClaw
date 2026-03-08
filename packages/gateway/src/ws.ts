import { basename, join, extname, resolve, relative } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync, renameSync, copyFileSync, mkdirSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "./bootstrap.js";
import type {
  ContentBlock,
  Message,
  ToolExecutionContext,
} from "@agentclaw/types";
import * as Sentry from "@sentry/node";

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
      // 图片：转为 base64 ContentBlock + 保存到 data/uploads/（与 Telegram 相同）
      if (existsSync(filePath)) {
        try {
          const buf = await readFile(filePath);
          blocks.push({
            type: "image",
            data: buf.toString("base64"),
            mediaType: MIME_MAP[ext] ?? "image/jpeg",
            filename: originalName,
          });
          // 保存到 data/uploads/（与 Telegram/WhatsApp 相同的持久路径）
          const uploadsDir = join(process.cwd(), "data", "uploads");
          mkdirSync(uploadsDir, { recursive: true });
          const uploadPath = join(uploadsDir, originalName).replace(/\\/g, "/");
          try {
            renameSync(filePath, uploadPath);
          } catch {
            try {
              copyFileSync(filePath, uploadPath);
            } catch {
              /* 保留原路径 */
            }
          }
          // 与 Telegram 相同的文本格式（空格非冒号，避免 agent-loop relocate）
          fileHints.push(`[用户发送了图片，已保存到 ${uploadPath}]`);
        } catch {
          /* 跳过不可读文件 */
        }
      }
    } else {
      // 非图片：rename 到原始文件名（移动，不留副本）
      if (existsSync(filePath)) {
        const origPath = join(
          process.cwd(),
          "data",
          "tmp",
          originalName,
        ).replace(/\\/g, "/");
        try {
          renameSync(filePath, origPath);
        } catch {
          /* rename 失败则保留原路径 */
        }
        const usePath = existsSync(origPath)
          ? origPath
          : filePath.replace(/\\/g, "/");
        fileHints.push(
          `用户上传了附件，已保存到：${usePath}\n注意：需要用到此文件时直接使用上述完整路径，不要用 glob 搜索。`,
        );
      }
    }
  }

  // 清理上传链接标记，保留其他文本
  let cleanText = text
    .replace(UPLOAD_RE, "")
    .replace(/\n{3,}/g, "\n")
    .trim();

  // 文件路径提示放在用户文本前面，确保 LLM 优先看到
  if (fileHints.length > 0) {
    cleanText = cleanText
      ? `${fileHints.join("\n")}\n${cleanText}`
      : fileHints.join("\n");
  }

  if (cleanText) {
    blocks.push({ type: "text", text: cleanText });
  }

  return blocks.length > 0 ? blocks : text;
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
    // 处理 error 事件，防止 unhandled error 导致进程崩溃
    socket.on("error", () => {
      wsClients.delete(socket);
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
            const tmpDir = resolve(process.cwd(), "data", "tmp");
            const abs = resolve(filePath);
            let relPath = filename;
            if (abs.startsWith(tmpDir)) {
              // Preserve subdirectory path relative to data/tmp for correct static serving
              relPath = relative(tmpDir, abs).replace(/\\/g, "/");
            } else {
              // File is outside served dir — copy into data/tmp/ so /files/ can serve it
              mkdirSync(tmpDir, { recursive: true });
              const dest = join(tmpDir, filename);
              try {
                copyFileSync(abs, dest);
              } catch {
                /* ignore copy errors */
              }
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
              const timer = setTimeout(
                () => {
                  pendingPrompt = null;
                  resolve("[用户未在 5 分钟内回答]");
                },
                5 * 60 * 1000,
              );
              pendingPrompt = (answer: string) => {
                clearTimeout(timer);
                resolve(answer);
              };
              safeSend(JSON.stringify({ type: "prompt", question }));
            });
          },
          notifyUser: async (message: string) => {
            safeSend(JSON.stringify({ type: "tool_progress", text: message }));
          },
        };

        // Convert uploaded images to multimodal ContentBlock[]
        // 保留原始文本，agent-loop 用于 DB 存储（刷新后显示的是这个）
        // 清理 /files/hex URL，防止 LLM 从历史上下文中拾取错误路径
        context.originalUserText = parsed.content.replace(
          /\[Uploaded:\s*([^\]]*)\]\(\/files\/[^)]+\)/g,
          "[$1]",
        );
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

        // 客户端断开后停止迭代 eventStream，避免资源浪费
        let aborted = false;
        socket.once("close", () => {
          aborted = true;
        });

        for await (const event of eventStream) {
          if (aborted) break;
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
                durationMs?: number;
              };
              safeSend(
                JSON.stringify({
                  type: "tool_result",
                  toolName: data.name,
                  toolResult: data.result.content,
                  durationMs: data.durationMs,
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
        Sentry.captureException(err);
        const message = err instanceof Error ? err.message : String(err);
        safeSend(JSON.stringify({ type: "error", error: message }));
        safeSend(JSON.stringify({ type: "done" }));
      }
    });
  });
}
