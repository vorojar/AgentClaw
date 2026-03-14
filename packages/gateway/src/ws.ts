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

/** Parse ALLOWED_ORIGINS env (comma-separated) into a Set; empty = allow all */
function getAllowedOrigins(): Set<string> | null {
  const raw = process.env.ALLOWED_ORIGINS?.trim();
  if (!raw) return null; // not configured → allow all (backward compat)
  return new Set(
    raw
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
  );
}

const wsClients = new Set<import("ws").WebSocket>();

/** Get all active WebSocket clients for broadcasting */
export function getWsClients(): Set<import("ws").WebSocket> {
  return wsClients;
}

/** Ping interval (ms) — keeps Cloudflare Tunnel / reverse proxies alive */
const WS_PING_INTERVAL = 30_000;

// ── 活跃的 agent 流（session 级别，跨 socket 生存） ──────────────
interface ActiveStream {
  /** 所有已发送的 WS 事件（JSON 字符串），用于重连回放 */
  buffer: string[];
  /** 当前连接的 socket（断连时为 null，重连时更新） */
  socketRef: { current: import("ws").WebSocket | null };
  /** promptUser 回调引用（跨 socket 生存） */
  pendingPromptRef: {
    current: ((answer: string) => void) | null;
    timer: ReturnType<typeof setTimeout> | null;
  };
  /** 用户主动停止（点 Stop 按钮） */
  userAborted: boolean;
}

const activeStreams = new Map<string, ActiveStream>();

export function registerWebSocket(app: FastifyInstance, ctx: AppContext): void {
  app.get("/ws", { websocket: true }, (socket, req) => {
    // ── Origin 校验：防止恶意网页通过 WS 连接 ──
    const allowedOrigins = getAllowedOrigins();
    if (allowedOrigins) {
      const origin = req.headers.origin;
      if (!origin || !allowedOrigins.has(origin)) {
        socket.close(4003, "Origin not allowed");
        return;
      }
    }

    wsClients.add(socket);

    // ── Server-side ping to keep connection alive through proxies ──
    let alive = true;
    let missedPongs = 0;
    const pingTimer = setInterval(() => {
      if (!alive) {
        missedPongs++;
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
    socket.on("error", () => {
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

    // ── 检查是否有正在运行的 agent 流（重连场景） ──
    const existingStream = activeStreams.get(sessionId);
    if (existingStream) {
      // 重连：更新 socket 引用，回放缓冲事件
      existingStream.socketRef.current = socket;
      safeSendTo(socket, JSON.stringify({ type: "resuming" }));
      for (const msg of existingStream.buffer) {
        safeSendTo(socket, msg);
      }
    }

    socket.on("close", () => {
      clearInterval(pingTimer);
      wsClients.delete(socket);
      // 不中止 agent loop —— 仅将 socketRef 置空
      const stream = activeStreams.get(sessionId);
      if (stream && stream.socketRef.current === socket) {
        stream.socketRef.current = null;
      }
    });

    socket.on("message", async (rawData: Buffer | string) => {
      let parsed: { type?: string; content?: string; skillName?: string };
      try {
        const str =
          typeof rawData === "string" ? rawData : rawData.toString("utf-8");
        parsed = JSON.parse(str);
      } catch {
        safeSendTo(
          socket,
          JSON.stringify({ type: "error", error: "Invalid JSON" }),
        );
        return;
      }

      // ── stop：用户主动停止 ──
      if (parsed.type === "stop") {
        const stream = activeStreams.get(sessionId);
        if (stream) stream.userAborted = true;
        const stopped = ctx.orchestrator.stopSession(sessionId);
        safeSendTo(
          socket,
          JSON.stringify({ type: "stopped", success: stopped }),
        );
        return;
      }

      // ── prompt_reply：回复 ask_user ──
      if (parsed.type === "prompt_reply") {
        const stream = activeStreams.get(sessionId);
        if (stream?.pendingPromptRef.current) {
          stream.pendingPromptRef.current(parsed.content ?? "");
          stream.pendingPromptRef.current = null;
          if (stream.pendingPromptRef.timer) {
            clearTimeout(stream.pendingPromptRef.timer);
            stream.pendingPromptRef.timer = null;
          }
        }
        return;
      }

      if (parsed.type !== "message" || !parsed.content) {
        safeSendTo(
          socket,
          JSON.stringify({
            type: "error",
            error: "Expected { type: 'message', content: '...' }",
          }),
        );
        return;
      }

      // ── 如果该 session 已有活跃流，拒绝新消息 ──
      if (activeStreams.has(sessionId)) {
        safeSendTo(
          socket,
          JSON.stringify({
            type: "error",
            error: "Agent is still processing. Please wait or stop first.",
          }),
        );
        return;
      }

      try {
        // Verify session exists
        const session = await ctx.orchestrator.getSession(sessionId);
        if (!session) {
          safeSendTo(
            socket,
            JSON.stringify({
              type: "error",
              error: `Session not found: ${sessionId}`,
            }),
          );
          return;
        }

        // ── 创建 ActiveStream ──
        const stream: ActiveStream = {
          buffer: [],
          socketRef: { current: socket },
          pendingPromptRef: { current: null, timer: null },
          userAborted: false,
        };
        activeStreams.set(sessionId, stream);

        /** 发送事件到当前 socket + 缓冲（跨 socket 生存） */
        function streamSend(data: string): void {
          stream.buffer.push(data);
          const s = stream.socketRef.current;
          if (s && s.readyState === 1) {
            try {
              s.send(data);
            } catch {
              /* socket closed between check and send — ignore */
            }
          }
        }

        // Build tool execution context
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
              relPath = relative(tmpDir, abs).replace(/\\/g, "/");
            } else {
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
            streamSend(JSON.stringify({ type: "file", url, filename }));
          },
          streamText: (text: string) => {
            streamSend(JSON.stringify({ type: "text", text }));
          },
          todoNotify: (items: Array<{ text: string; done: boolean }>) => {
            streamSend(JSON.stringify({ type: "todo_update", items }));
          },
          promptUser: (question: string) => {
            return new Promise<string>((resolvePrompt) => {
              const timer = setTimeout(
                () => {
                  stream.pendingPromptRef.current = null;
                  stream.pendingPromptRef.timer = null;
                  resolvePrompt("[用户未在 5 分钟内回答]");
                },
                5 * 60 * 1000,
              );
              stream.pendingPromptRef.current = (answer: string) => {
                clearTimeout(timer);
                resolvePrompt(answer);
              };
              stream.pendingPromptRef.timer = timer;
              streamSend(JSON.stringify({ type: "prompt", question }));
            });
          },
          notifyUser: async (message: string) => {
            streamSend(
              JSON.stringify({ type: "tool_progress", text: message }),
            );
          },
        };

        context.originalUserText = parsed.content.replace(
          /\[Uploaded:\s*([^\]]*)\]\(\/files\/[^)]+\)/g,
          "[$1]",
        );
        const userContent = await parseUserContent(parsed.content);

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
          cacheCreationTokens?: number;
          cacheReadTokens?: number;
          durationMs?: number;
          toolCallCount?: number;
        } = {};

        // ── 消费事件流（不受 socket 断连影响） ──
        try {
          for await (const event of eventStream) {
            if (stream.userAborted) break;
            switch (event.type) {
              case "tool_call": {
                const data = event.data as { name: string; input: unknown };
                streamSend(
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
                streamSend(
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
                streamSend(
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
                  cacheCreationTokens: data.message.cacheCreationTokens,
                  cacheReadTokens: data.message.cacheReadTokens,
                  durationMs: data.message.durationMs,
                  toolCallCount: data.message.toolCallCount,
                };
                break;
              }
              case "error": {
                const data = event.data as {
                  message?: string;
                  error?: string;
                };
                streamSend(
                  JSON.stringify({
                    type: "error",
                    error: data.message || data.error || "Unknown error",
                  }),
                );
                break;
              }
              case "handoff": {
                const hData = event.data as {
                  fromAgent: string;
                  toAgent: string;
                  toAgentName: string;
                  reason: string;
                };
                streamSend(
                  JSON.stringify({
                    type: "handoff",
                    fromAgent: hData.fromAgent,
                    toAgent: hData.toAgent,
                    toAgentName: hData.toAgentName,
                    reason: hData.reason,
                  }),
                );
                break;
              }
              case "thinking":
                streamSend(JSON.stringify({ type: "thinking" }));
                break;
              default:
                break;
            }
          }

          streamSend(JSON.stringify({ type: "done", ...usageStats }));
        } catch (err: unknown) {
          Sentry.captureException(err);
          const message = err instanceof Error ? err.message : String(err);
          streamSend(JSON.stringify({ type: "error", error: message }));
          streamSend(JSON.stringify({ type: "done" }));
        } finally {
          activeStreams.delete(sessionId);
        }
      } catch (err: unknown) {
        Sentry.captureException(err);
        const message = err instanceof Error ? err.message : String(err);
        safeSendTo(socket, JSON.stringify({ type: "error", error: message }));
        safeSendTo(socket, JSON.stringify({ type: "done" }));
        activeStreams.delete(sessionId);
      }
    });
  });
}

/** Safe send to a specific socket — silently drops if not OPEN */
function safeSendTo(socket: import("ws").WebSocket, data: string): void {
  if (socket.readyState === 1) {
    try {
      socket.send(data);
    } catch {
      /* ignore */
    }
  }
}
