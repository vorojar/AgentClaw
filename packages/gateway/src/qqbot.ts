import * as Sentry from "@sentry/node";
import { WebSocket } from "ws";
import type { AppContext } from "./bootstrap.js";
import type {
  Message,
  ToolExecutionContext,
} from "@agentclaw/types";
import {
  extractText,
  stripFileMarkdown,
  splitMessage,
  broadcastSessionActivity,
} from "./utils.js";

// ── QQ Bot API Constants ───────────────────────────

const QQ_API_BASE = "https://api.sgroup.qq.com";
const QQ_AUTH_URL = "https://bots.qq.com/app/getAppAccessToken";

/** WebSocket OpCodes */
const OP = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
} as const;

/** Intent bitmasks */
const INTENTS = {
  GROUP_AND_C2C_EVENT: 1 << 25,
  PUBLIC_GUILD_MESSAGES: 1 << 30,
  DIRECT_MESSAGE: 1 << 12,
} as const;

/** Passive reply tracking: msg_id → { expiry, seq } */
interface ReplyTracker {
  msgId: string;
  expiry: number;
  seq: number;
}

// ── Types ──────────────────────────────────────────

export interface QQBotConfig {
  appId: string;
  appSecret: string;
  /** Use sandbox environment (default: false) */
  sandbox?: boolean;
}

interface QQMessageEvent {
  id: string;
  content: string;
  timestamp: string;
  author: {
    id: string;
    username?: string;
    member_openid?: string;
    user_openid?: string;
  };
  group_openid?: string;
  attachments?: Array<{ url: string; content_type?: string; filename?: string }>;
}

// ── Token Manager ──────────────────────────────────

class TokenManager {
  private token = "";
  private expiresAt = 0;
  constructor(
    private appId: string,
    private appSecret: string,
  ) {}

  async getToken(): Promise<string> {
    // Refresh 120s before expiry
    if (this.token && Date.now() < this.expiresAt - 120_000) {
      return this.token;
    }
    const res = await fetch(QQ_AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId: this.appId, clientSecret: this.appSecret }),
    });
    if (!res.ok) {
      throw new Error(`QQ auth failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.token = data.access_token;
    this.expiresAt = Date.now() + data.expires_in * 1000;
    console.log(`[qqbot] Token refreshed, expires in ${data.expires_in}s`);
    return this.token;
  }
}

// ── HTTP API Client ────────────────────────────────

class QQApiClient {
  constructor(
    private tokenManager: TokenManager,
    private apiBase: string,
  ) {}

  private async request(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    const token = await this.tokenManager.getToken();
    const res = await fetch(`${this.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `QQBot ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`QQ API ${method} ${path} failed: ${res.status} ${text}`);
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return res.json();
    }
    return {};
  }

  /** Send a C2C (private) message */
  async sendC2CMessage(
    openid: string,
    content: string,
    msgId?: string,
    msgSeq?: number,
  ): Promise<void> {
    await this.request("POST", `/v2/users/${openid}/messages`, {
      content,
      msg_type: 0,
      ...(msgId ? { msg_id: msgId, msg_seq: msgSeq ?? 1 } : {}),
    });
  }

  /** Send a group message */
  async sendGroupMessage(
    groupOpenid: string,
    content: string,
    msgId?: string,
    msgSeq?: number,
  ): Promise<void> {
    await this.request("POST", `/v2/groups/${groupOpenid}/messages`, {
      content,
      msg_type: 0,
      ...(msgId ? { msg_id: msgId, msg_seq: msgSeq ?? 1 } : {}),
    });
  }

  /** Get WebSocket gateway URL */
  async getGateway(): Promise<string> {
    const data = (await this.request("GET", "/gateway")) as { url: string };
    return data.url;
  }
}

// ── Main Entry ─────────────────────────────────────

/** Map chat key → AgentClaw session ID */
const chatSessionMap = new Map<string, string>();

/** Pending ask_user prompts */
const pendingPrompts = new Map<string, (answer: string) => void>();

/** Recent message IDs for passive reply (5 min TTL) */
const replyTrackers = new Map<string, ReplyTracker>();

export async function startQQBot(
  config: QQBotConfig,
  appCtx: AppContext,
): Promise<{ stop: () => void; broadcast: (text: string) => Promise<void> }> {
  const apiBase = config.sandbox
    ? "https://sandbox.api.sgroup.qq.com"
    : QQ_API_BASE;
  const tokenManager = new TokenManager(config.appId, config.appSecret);
  const api = new QQApiClient(tokenManager, apiBase);

  let stopped = false;
  let ws: WebSocket | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let lastSeq: number | null = null;
  let sessionId = "";
  let resumeUrl = "";

  // Restore chat targets from database
  try {
    const targets = appCtx.memoryStore.getChatTargets("qqbot");
    for (const t of targets) {
      chatSessionMap.set(t.targetId, t.sessionId ?? "");
    }
    if (targets.length > 0) {
      console.log(`[qqbot] Restored ${targets.length} chat target(s)`);
    }
  } catch (err) {
    console.error("[qqbot] Failed to restore chat targets:", err);
  }

  // ── Reply helpers ─────────────────────────────

  function getChatKey(msg: QQMessageEvent): string {
    if (msg.group_openid) return `group:${msg.group_openid}`;
    return `c2c:${msg.author.user_openid || msg.author.member_openid || msg.author.id}`;
  }

  function trackReply(chatKey: string, msgId: string): void {
    replyTrackers.set(chatKey, {
      msgId,
      expiry: Date.now() + 5 * 60 * 1000,
      seq: 1,
    });
  }

  async function sendReply(
    chatKey: string,
    text: string,
  ): Promise<void> {
    const tracker = replyTrackers.get(chatKey);
    const msgId = tracker && tracker.expiry > Date.now() ? tracker.msgId : undefined;
    const msgSeq = tracker ? ++tracker.seq : undefined;

    try {
      if (chatKey.startsWith("group:")) {
        const groupOpenid = chatKey.slice(6);
        await api.sendGroupMessage(groupOpenid, text, msgId, msgSeq);
      } else {
        const openid = chatKey.slice(4);
        await api.sendC2CMessage(openid, text, msgId, msgSeq);
      }
    } catch (err) {
      console.error(`[qqbot] Send failed (${chatKey}):`, err);
    }
  }

  // ── Message processing ────────────────────────

  async function processMessage(
    chatKey: string,
    msg: QQMessageEvent,
  ): Promise<void> {
    // Strip @bot mention from content
    let text = (msg.content || "").replace(/<@!\d+>/g, "").trim();

    // Handle attachments (voice, image, video, file)
    if (msg.attachments?.length) {
      const { mkdirSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const uploadsDir = join(process.cwd(), "data", "uploads");
      mkdirSync(uploadsDir, { recursive: true });

      for (const att of msg.attachments) {
        const ct = (att.content_type || "").toLowerCase();
        let fileType = "文件";
        let ext = "bin";
        const isVoice = ct.includes("voice") || ct.includes("audio") || ct.includes("silk");
        if (isVoice) {
          fileType = "语音";
          ext = ct.includes("silk") ? "silk" : "ogg";
        } else if (ct.includes("image")) {
          fileType = "图片";
          ext = ct.split("/")[1]?.split(";")[0] || "png";
        } else if (ct.includes("video")) {
          fileType = "视频";
          ext = ct.split("/")[1]?.split(";")[0] || "mp4";
        }

        const fileName = att.filename || `${fileType}_${Date.now()}.${ext}`;
        // QQ attachment URLs may omit protocol
        const url = att.url.startsWith("//") ? `https:${att.url}` : att.url;

        try {
          const res = await fetch(url);
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            const filePath = join(uploadsDir, fileName).replace(/\\/g, "/");
            writeFileSync(filePath, buf);

            // Auto-transcribe voice messages at framework level
            if (isVoice) {
              try {
                const { execSync } = await import("node:child_process");
                const scriptPath = join(process.cwd(), "scripts", "transcribe.py").replace(/\\/g, "/");
                const result = execSync(`python "${scriptPath}" "${filePath}"`, {
                  encoding: "utf-8",
                  timeout: 30000,
                }).trim();
                if (result) {
                  text += `\n[用户语音转文字: ${result}]`;
                } else {
                  text += `\n[用户发送了语音，转录为空]`;
                }
              } catch {
                text += `\n[用户发送了语音: ${fileName}, 已保存到 ${filePath}]`;
              }
            } else {
              text += `\n[用户发送了${fileType}: ${fileName}, 已保存到 ${filePath}]`;
            }
          } else {
            text += `\n[用户发送了${fileType}, 下载失败: HTTP ${res.status}]`;
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          text += `\n[用户发送了${fileType}, 下载失败: ${errMsg}]`;
        }
      }
    }

    if (!text) return;

    // Track for passive reply
    trackReply(chatKey, msg.id);

    // Check pending prompt
    const pendingResolve = pendingPrompts.get(chatKey);
    if (pendingResolve) {
      pendingPrompts.delete(chatKey);
      pendingResolve(text);
      return;
    }

    // Get or create session
    let sid = chatSessionMap.get(chatKey);
    if (!sid) {
      try {
        const session = await appCtx.orchestrator.createSession();
        sid = session.id;
        chatSessionMap.set(chatKey, sid);
        appCtx.memoryStore.saveChatTarget("qqbot", chatKey, sid);
      } catch (err) {
        console.error("[qqbot] Failed to create session:", err);
        await sendReply(chatKey, "❌ 会话创建失败，请重试。");
        return;
      }
    }

    try {
      const sentFiles: Array<{ url: string; filename: string }> = [];
      const toolContext: ToolExecutionContext = {
        sentFiles,
        promptUser: async (question: string) => {
          await sendReply(chatKey, `❓ ${question}`);
          return new Promise<string>((resolve) => {
            const timer = setTimeout(() => {
              pendingPrompts.delete(chatKey);
              resolve("[用户未在 5 分钟内回答]");
            }, 5 * 60 * 1000);
            pendingPrompts.set(chatKey, (answer: string) => {
              clearTimeout(timer);
              resolve(answer);
            });
          });
        },
        notifyUser: async (message: string) => {
          await sendReply(chatKey, message);
        },
        sendFile: async (filePath: string, caption?: string) => {
          const { basename } = await import("node:path");
          const filename = basename(filePath);
          const url = `/files/${encodeURIComponent(filename)}`;
          sentFiles.push({ url, filename });
          const port = process.env.PORT || "3100";
          const host = process.env.PUBLIC_URL || `http://localhost:${port}`;
          await sendReply(chatKey, `📎 ${caption || filename}\n${host}${url}`);
        },
      };

      const eventStream = appCtx.orchestrator.processInputStream(
        sid,
        text,
        toolContext,
      );

      let accumulatedText = "";

      for await (const event of eventStream) {
        switch (event.type) {
          case "response_chunk": {
            const data = event.data as { text: string };
            accumulatedText += data.text;
            break;
          }
          case "response_complete": {
            const data = event.data as { message: Message };
            if (!accumulatedText) {
              accumulatedText = extractText(data.message.content);
            }
            break;
          }
        }
      }

      accumulatedText = stripFileMarkdown(accumulatedText).trim();
      if (!accumulatedText) accumulatedText = "(empty response)";

      for (const chunk of splitMessage(accumulatedText, 2000)) {
        await sendReply(chatKey, chunk);
      }

      broadcastSessionActivity(sid, "qqbot");
    } catch (err) {
      Sentry.captureException(err);
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[qqbot] Error processing message:", errMsg);
      if (errMsg.includes("Session not found")) {
        chatSessionMap.delete(chatKey);
        await sendReply(chatKey, "⚠️ 会话已过期，请重新发送消息。");
        return;
      }
      await sendReply(chatKey, `❌ Error: ${errMsg.slice(0, 200)}`);
    }
  }

  // ── WebSocket Gateway ─────────────────────────

  function startHeartbeat(interval: number): void {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ op: OP.HEARTBEAT, d: lastSeq }));
      }
    }, interval);
  }

  function handleDispatch(eventType: string, data: QQMessageEvent): void {
    if (
      eventType === "C2C_MESSAGE_CREATE" ||
      eventType === "GROUP_AT_MESSAGE_CREATE"
    ) {
      const chatKey = getChatKey(data);
      processMessage(chatKey, data).catch((err) => {
        console.error(`[qqbot] processMessage error:`, err);
      });
    }
  }

  async function connect(url?: string): Promise<void> {
    if (stopped) return;

    const gatewayUrl = url || (await api.getGateway());
    console.log(`[qqbot] Connecting to ${gatewayUrl}`);

    ws = new WebSocket(gatewayUrl);

    ws.on("open", () => {
      console.log("[qqbot] WebSocket connected");
    });

    ws.on("message", (raw) => {
      try {
        const payload = JSON.parse(raw.toString()) as {
          op: number;
          d: Record<string, unknown>;
          s?: number;
          t?: string;
        };

        if (payload.s) lastSeq = payload.s;

        switch (payload.op) {
          case OP.HELLO: {
            const interval = (payload.d as { heartbeat_interval: number })
              .heartbeat_interval;
            startHeartbeat(interval);

            if (sessionId && resumeUrl) {
              // Resume
              ws!.send(
                JSON.stringify({
                  op: OP.RESUME,
                  d: {
                    token: `QQBot ${tokenManager.getToken()}`,
                    session_id: sessionId,
                    seq: lastSeq,
                  },
                }),
              );
            } else {
              // Identify
              const intents =
                INTENTS.GROUP_AND_C2C_EVENT |
                INTENTS.PUBLIC_GUILD_MESSAGES |
                INTENTS.DIRECT_MESSAGE;

              tokenManager.getToken().then((token) => {
                ws!.send(
                  JSON.stringify({
                    op: OP.IDENTIFY,
                    d: {
                      token: `QQBot ${token}`,
                      intents,
                      shard: [0, 1],
                    },
                  }),
                );
              });
            }
            break;
          }

          case OP.DISPATCH: {
            const eventType = payload.t ?? "";
            if (eventType === "READY") {
              const readyData = payload.d as {
                session_id: string;
                user: { username: string; id: string };
              };
              sessionId = readyData.session_id;
              console.log(
                `[qqbot] Ready! Bot: ${readyData.user?.username} (${readyData.user?.id})`,
              );
            } else if (eventType === "RESUMED") {
              console.log("[qqbot] Session resumed");
            } else {
              handleDispatch(eventType, payload.d as unknown as QQMessageEvent);
            }
            break;
          }

          case OP.HEARTBEAT_ACK:
            // OK
            break;

          case OP.RECONNECT:
            console.log("[qqbot] Server requested reconnect");
            ws?.close();
            break;

          case OP.INVALID_SESSION: {
            console.log("[qqbot] Invalid session, re-identifying");
            sessionId = "";
            // Reconnect after brief delay
            setTimeout(() => connect(), 2000);
            break;
          }
        }
      } catch (err) {
        console.error("[qqbot] Failed to parse WS message:", err);
      }
    });

    ws.on("error", (err) => {
      console.error("[qqbot] WebSocket error:", err.message);
    });

    ws.on("close", (code) => {
      console.log(`[qqbot] WebSocket closed (code=${code})`);
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }

      if (!stopped) {
        // Reconnect with exponential backoff
        const delay = sessionId ? 3000 : 5000;
        console.log(`[qqbot] Reconnecting in ${delay / 1000}s...`);
        setTimeout(() => {
          if (!stopped) {
            connect(sessionId && resumeUrl ? resumeUrl : undefined);
          }
        }, delay);
      }
    });
  }

  // ── Start ────────────────────────────────────

  await connect();

  // Periodically clean expired reply trackers
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, tracker] of replyTrackers) {
      if (tracker.expiry < now) replyTrackers.delete(key);
    }
  }, 60_000);

  return {
    stop: () => {
      stopped = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      clearInterval(cleanupTimer);
      ws?.close();
    },
    broadcast: async (text: string) => {
      for (const [chatKey] of chatSessionMap) {
        await sendReply(chatKey, text);
      }
    },
  };
}
