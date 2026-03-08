/**
 * WeCom (企业微信) 智能机器人渠道
 *
 * 接入方式：HTTP 回调（需要公网 URL）
 * - GET  /api/wecom/callback — URL 验证
 * - POST /api/wecom/callback — 接收消息/事件
 *
 * 回复方式：
 * 1. 被动回复（HTTP 响应体）— 支持流式消息
 * 2. 主动回复（POST response_url）— 异步长任务 fallback
 *
 * 加解密：AES-256-CBC + PKCS#7(32 字节块) + SHA1 签名
 *
 * 环境变量：
 *   WECOM_BOT_TOKEN          — 回调 Token（用于签名验证）
 *   WECOM_BOT_ENCODING_AES_KEY — 43 字符 EncodingAESKey
 */

import { createHash, createCipheriv, createDecipheriv } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, extname } from "node:path";
import * as Sentry from "@sentry/node";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "./bootstrap.js";
import type {
  ContentBlock,
  ToolExecutionContext,
} from "@agentclaw/types";
import {
  extractText,
  stripFileMarkdown,
  splitMessage,
  broadcastSessionActivity,
} from "./utils.js";

// ─── Types ──────────────────────────────────────────────────────────

export interface WeComConfig {
  token: string;
  encodingAesKey: string;
}

/** Incoming message from WeCom callback */
interface WeComMessage {
  msgtype: string;
  text?: { content: string };
  image?: { img_url: string };
  voice?: { content: string };
  file?: { file_url: string; file_name: string };
  mixed?: { msg_item: Array<{ msgtype: string; content: string }> };
  msgid: string;
  chatid: string;
  chattype: string; // "single" | "group"
  from: { userid: string; name?: string };
  aibotid?: string;
  response_url?: string;
  stream?: { id: string };
}

/** Incoming event from WeCom callback */
interface WeComEvent {
  event_type: string;
  chatid?: string;
  chattype?: string;
  from?: { userid: string; name?: string };
  response_url?: string;
  aibotid?: string;
  // stream refresh event
  stream?: { id: string };
}

// ─── Module-level state ─────────────────────────────────────────────

/** Map WeCom chatid → AgentClaw session ID */
const chatSessionMap = new Map<string, string>();

/** Pending ask_user prompts: chatid → resolve */
const pendingPrompts = new Map<string, (answer: string) => void>();

/**
 * Active stream sessions: streamId → { resolve, content, chatid }
 * When WeCom sends a stream refresh event, we resolve the pending stream
 * and the agent loop can continue pushing content.
 */
interface StreamSession {
  chatid: string;
  content: string;
  finished: boolean;
  pendingResolve?: () => void;
}
const activeStreams = new Map<string, StreamSession>();

// Upload directory for downloaded files
const UPLOAD_DIR = resolve(process.cwd(), "data", "uploads");

// ─── AES Crypto (WeCom 智能机器人 JSON 加解密) ────────────────────

class WeComCrypto {
  private key: Buffer;
  private iv: Buffer;
  private token: string;

  constructor(token: string, encodingAesKey: string) {
    this.token = token;
    // EncodingAESKey is 43 chars Base64, decode to 32 bytes
    this.key = Buffer.from(encodingAesKey + "=", "base64");
    this.iv = this.key.subarray(0, 16);
  }

  /** SHA1 signature: sort([token, timestamp, nonce, encrypt]) → sha1 */
  sign(timestamp: string, nonce: string, encrypt: string): string {
    const parts = [this.token, timestamp, nonce, encrypt].sort();
    return createHash("sha1").update(parts.join("")).digest("hex");
  }

  /** Verify msg_signature */
  verify(
    msgSignature: string,
    timestamp: string,
    nonce: string,
    encrypt: string,
  ): boolean {
    return this.sign(timestamp, nonce, encrypt) === msgSignature;
  }

  /** Decrypt ciphertext → plaintext message string */
  decrypt(encrypted: string): string {
    const cipher = Buffer.from(encrypted, "base64");
    const decipher = createDecipheriv("aes-256-cbc", this.key, this.iv);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(cipher), decipher.final()]);

    // Remove PKCS#7 padding (block size = 32)
    const padLen = decrypted[decrypted.length - 1];
    const unpadded = decrypted.subarray(0, decrypted.length - padLen);

    // Format: random(16) + msg_len(4, big-endian) + msg + receiveid
    const msgLen = unpadded.readUInt32BE(16);
    const msg = unpadded.subarray(20, 20 + msgLen).toString("utf-8");
    return msg;
  }

  /** Encrypt plaintext message → ciphertext (for passive reply) */
  encrypt(msg: string, receiveid = ""): string {
    // random(16) + msg_len(4, big-endian) + msg + receiveid
    const random = Buffer.from(
      Array.from({ length: 16 }, () =>
        Math.floor(Math.random() * 256),
      ),
    );
    const msgBuf = Buffer.from(msg, "utf-8");
    const receiveidBuf = Buffer.from(receiveid, "utf-8");
    const msgLenBuf = Buffer.alloc(4);
    msgLenBuf.writeUInt32BE(msgBuf.length, 0);

    const plaintext = Buffer.concat([random, msgLenBuf, msgBuf, receiveidBuf]);

    // PKCS#7 padding to block size 32
    const blockSize = 32;
    const padLen = blockSize - (plaintext.length % blockSize);
    const padding = Buffer.alloc(padLen, padLen);
    const padded = Buffer.concat([plaintext, padding]);

    const cipher = createCipheriv("aes-256-cbc", this.key, this.iv);
    cipher.setAutoPadding(false);
    const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
    return encrypted.toString("base64");
  }

  /** Build encrypted reply JSON body */
  buildReply(
    msgJson: string,
    nonce: string,
  ): { encrypt: string; msgsignature: string; timestamp: number; nonce: string } {
    const encrypted = this.encrypt(msgJson);
    const timestamp = Math.floor(Date.now() / 1000);
    const msgsignature = this.sign(String(timestamp), nonce, encrypted);
    return { encrypt: encrypted, msgsignature, timestamp, nonce };
  }
}

// ─── Register Fastify routes ────────────────────────────────────────

export function registerWeComRoutes(
  app: FastifyInstance,
  appCtx: AppContext,
): void {
  const token = process.env.WECOM_BOT_TOKEN;
  const encodingAesKey = process.env.WECOM_BOT_ENCODING_AES_KEY;

  if (!token || !encodingAesKey) return; // Not configured, skip

  const crypto = new WeComCrypto(token, encodingAesKey);

  // ── GET: URL verification ──
  app.get<{
    Querystring: {
      msg_signature: string;
      timestamp: string;
      nonce: string;
      echostr: string;
    };
  }>("/api/wecom/callback", async (request, reply) => {
    const { msg_signature, timestamp, nonce, echostr } = request.query;

    // Verify signature
    if (!crypto.verify(msg_signature, timestamp, nonce, echostr)) {
      console.error("[wecom] URL verification failed: signature mismatch");
      return reply.code(403).send("Signature mismatch");
    }

    // Decrypt echostr to get plaintext
    try {
      const plaintext = crypto.decrypt(echostr);
      console.log("[wecom] URL verification succeeded");
      return reply.code(200).type("text/plain").send(plaintext);
    } catch (err) {
      console.error("[wecom] URL verification decrypt failed:", err);
      return reply.code(500).send("Decrypt failed");
    }
  });

  // ── POST: receive messages/events ──
  app.post<{
    Querystring: {
      msg_signature: string;
      timestamp: string;
      nonce: string;
    };
    Body: { encrypt: string };
  }>("/api/wecom/callback", async (request, reply) => {
    const { msg_signature, timestamp, nonce } = request.query;
    const { encrypt } = request.body;

    // Verify signature
    if (!crypto.verify(msg_signature, timestamp, nonce, encrypt)) {
      console.error("[wecom] Callback signature mismatch");
      return reply.code(403).send("Signature mismatch");
    }

    // Decrypt
    let payload: Record<string, unknown>;
    try {
      const json = crypto.decrypt(encrypt);
      payload = JSON.parse(json);
    } catch (err) {
      console.error("[wecom] Decrypt/parse failed:", err);
      return reply.code(400).send("Decrypt failed");
    }

    // Route by event type
    const eventType = payload.event_type as string | undefined;
    const msgtype = payload.msgtype as string | undefined;

    // Stream refresh event — wake up pending stream
    if (eventType === "stream_refresh" || (payload.stream && !msgtype)) {
      const streamId = (payload.stream as { id: string })?.id;
      if (streamId) {
        const session = activeStreams.get(streamId);
        if (session?.pendingResolve) {
          session.pendingResolve();
        }
      }
      // Return empty to acknowledge
      return reply.code(200).send("");
    }

    // Enter-chat event (welcome message)
    if (eventType === "enter_chat") {
      const event = payload as unknown as WeComEvent;
      const chatid = event.chatid || "";
      console.log(`[wecom] User entered chat: ${chatid}`);

      // Reply welcome text
      const welcomeMsg = JSON.stringify({
        msgtype: "text",
        text: { content: "你好！有什么可以帮你的吗？" },
      });
      const replyBody = crypto.buildReply(welcomeMsg, nonce);
      return reply.code(200).send(replyBody);
    }

    // User message
    if (msgtype) {
      const msg = payload as unknown as WeComMessage;
      // Process in background, reply with stream
      handleUserMessage(msg, nonce, crypto, appCtx, reply);
      return; // reply is handled inside handleUserMessage
    }

    // Unknown event — acknowledge
    return reply.code(200).send("");
  });
}

// ─── Message handling ───────────────────────────────────────────────

async function handleUserMessage(
  msg: WeComMessage,
  nonce: string,
  crypto: WeComCrypto,
  appCtx: AppContext,
  reply: any,
): Promise<void> {
  const chatid = msg.chatid;
  const userId = msg.from?.userid || "unknown";
  const responseUrl = msg.response_url;

  // Extract text from various message types
  let userText = "";
  const contentBlocks: ContentBlock[] = [];

  switch (msg.msgtype) {
    case "text":
      userText = msg.text?.content || "";
      break;
    case "voice":
      // Voice is already transcribed by WeCom
      userText = msg.voice?.content || "[语音消息]";
      break;
    case "image": {
      // Download image and create multimodal content
      const imgUrl = msg.image?.img_url;
      if (imgUrl) {
        try {
          const imgData = await downloadWeComFile(imgUrl, crypto);
          if (imgData) {
            contentBlocks.push({
              type: "image",
              data: imgData.base64,
              mediaType: imgData.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            });
          }
        } catch (err) {
          console.error("[wecom] Failed to download image:", err);
        }
      }
      userText = userText || "[图片]";
      break;
    }
    case "file": {
      const fileUrl = msg.file?.file_url;
      const fileName = msg.file?.file_name || "file";
      if (fileUrl) {
        try {
          const saved = await downloadAndSaveFile(fileUrl, fileName, crypto);
          userText = `[用户发送了文件: ${fileName}，已保存到 ${saved}]`;
        } catch (err) {
          console.error("[wecom] Failed to download file:", err);
          userText = `[用户发送了文件: ${fileName}]`;
        }
      }
      break;
    }
    case "mixed": {
      // 图文混排消息
      if (msg.mixed?.msg_item) {
        for (const item of msg.mixed.msg_item) {
          try {
            const parsed = JSON.parse(item.content);
            if (item.msgtype === "text" && parsed.content) {
              userText += parsed.content;
            } else if (item.msgtype === "image" && parsed.img_url) {
              const imgData = await downloadWeComFile(parsed.img_url, crypto);
              if (imgData) {
                contentBlocks.push({
                  type: "image",
                  data: imgData.base64,
                  mediaType: imgData.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
                });
              }
            }
          } catch {
            // Skip malformed items
          }
        }
      }
      break;
    }
    default:
      userText = `[不支持的消息类型: ${msg.msgtype}]`;
  }

  // Check for /new command
  if (userText.trim() === "/new" || userText.trim() === "新会话") {
    chatSessionMap.delete(chatid);
    const replyMsg = JSON.stringify({
      msgtype: "text",
      text: { content: "会话已重置，请开始新的对话。" },
    });
    const replyBody = crypto.buildReply(replyMsg, nonce);
    reply.code(200).send(replyBody);
    return;
  }

  // Check pending ask_user
  const pendingResolve = pendingPrompts.get(chatid);
  if (pendingResolve) {
    pendingPrompts.delete(chatid);
    pendingResolve(userText);
    reply.code(200).send("");
    return;
  }

  // Build input
  let input: string | ContentBlock[];
  if (contentBlocks.length > 0) {
    if (userText && userText !== "[图片]") {
      contentBlocks.push({ type: "text", text: userText });
    }
    input = contentBlocks;
  } else {
    input = userText;
  }

  // Get or create session
  let sessionId = chatSessionMap.get(chatid);
  if (!sessionId) {
    const session = await appCtx.orchestrator.createSession({
      channel: "wecom",
      chatid,
      userId,
    });
    sessionId = session.id;
    chatSessionMap.set(chatid, sessionId);
    appCtx.memoryStore.saveChatTarget("wecom", chatid, sessionId);
  }

  // Build tool context
  const sentFiles: Array<{ url: string; filename: string }> = [];
  const toolContext: ToolExecutionContext = {
    sentFiles,
    originalUserText: typeof input === "string" ? input : userText,
    promptUser: async (question: string) => {
      // Send question via response_url if available, or queue for next stream
      if (responseUrl) {
        await postResponseUrl(responseUrl, `❓ ${question}`);
      }
      return new Promise<string>((resolve) => {
        const timer = setTimeout(() => {
          pendingPrompts.delete(chatid);
          resolve("[用户未在 5 分钟内回答]");
        }, 5 * 60 * 1000);
        pendingPrompts.set(chatid, (answer: string) => {
          clearTimeout(timer);
          resolve(answer);
        });
      });
    },
    notifyUser: async (message: string) => {
      if (responseUrl) {
        await postResponseUrl(responseUrl, message).catch(() => {});
      }
    },
    sendFile: async (filePath: string, caption?: string) => {
      // WeCom 智能机器人被动回复不支持文件，通过 response_url 发送链接
      const filename = filePath.split(/[\\/]/).pop() || "file";
      const fileUrl = `/files/${filename}`;
      sentFiles.push({ url: fileUrl, filename });
      if (responseUrl && caption) {
        await postResponseUrl(responseUrl, `📎 ${caption}: ${fileUrl}`).catch(
          () => {},
        );
      }
    },
  };

  // Process through orchestrator with streaming
  console.log(
    `[wecom] Processing message from ${userId} in chat ${chatid}`,
  );

  try {
    // Generate a unique stream ID
    const streamId = `wecom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // First reply: start the stream
    let accumulatedText = "";
    let toolStatusLines: string[] = [];
    let firstReply = true;

    const eventStream = appCtx.orchestrator.processInputStream(
      sessionId,
      input,
      toolContext,
    );

    for await (const event of eventStream) {
      if (event.type === "tool_call") {
        const { name } = event.data as { name: string };
        const icon =
          name === "web_search"
            ? "🔍"
            : name === "use_skill"
              ? "⚡"
              : "⚙️";
        toolStatusLines.push(`${icon} ${name}`);
      } else if (event.type === "response_chunk") {
        const { text } = event.data as { text: string };
        accumulatedText += text;
      }
    }

    // Final text
    let finalText = accumulatedText.trim();
    finalText = stripFileMarkdown(finalText);

    if (!finalText) {
      finalText = toolStatusLines.length > 0
        ? `已执行: ${toolStatusLines.join(", ")}`
        : "（无回复内容）";
    }

    // Send reply
    if (firstReply) {
      // Use passive reply (stream mode for long text, text for short)
      if (finalText.length > 20480) {
        // Too long for single stream, use markdown via response_url
        if (responseUrl) {
          const chunks = splitMessage(finalText, 20000);
          for (const chunk of chunks) {
            await postResponseUrl(responseUrl, chunk);
          }
        }
        // Still need to reply something to the callback
        const replyMsg = JSON.stringify({
          msgtype: "text",
          text: { content: "回复内容较长，已通过消息发送。" },
        });
        const replyBody = crypto.buildReply(replyMsg, nonce);
        reply.code(200).send(replyBody);
      } else {
        // Use stream mode for the passive reply — supports markdown
        const replyMsg = JSON.stringify({
          msgtype: "stream",
          stream: {
            id: streamId,
            finish: true,
            content: finalText,
          },
        });
        const replyBody = crypto.buildReply(replyMsg, nonce);
        reply.code(200).send(replyBody);
      }
      firstReply = false;
    }

    // Broadcast session activity to Web UI
    broadcastSessionActivity(sessionId, "wecom");
  } catch (err) {
    Sentry.captureException(err);
    console.error("[wecom] Error processing message:", err);

    const errorText = "抱歉，处理消息时出现错误，请稍后再试。";
    const replyMsg = JSON.stringify({
      msgtype: "text",
      text: { content: errorText },
    });
    const replyBody = crypto.buildReply(replyMsg, nonce);
    reply.code(200).send(replyBody);
  }
}

// ─── File download helpers ──────────────────────────────────────────

async function downloadWeComFile(
  url: string,
  crypto: WeComCrypto,
): Promise<{ base64: string; mediaType: string } | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    const contentType = resp.headers.get("content-type") || "image/jpeg";
    return {
      base64: buf.toString("base64"),
      mediaType: contentType,
    };
  } catch {
    return null;
  }
}

async function downloadAndSaveFile(
  url: string,
  filename: string,
  crypto: WeComCrypto,
): Promise<string> {
  mkdirSync(UPLOAD_DIR, { recursive: true });
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  const safeName = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const savePath = resolve(UPLOAD_DIR, safeName);
  writeFileSync(savePath, buf);
  return savePath;
}

// ─── Active reply via response_url ──────────────────────────────────

async function postResponseUrl(
  responseUrl: string,
  content: string,
): Promise<void> {
  try {
    const body = JSON.stringify({
      msgtype: "markdown",
      markdown: { content },
    });
    const resp = await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!resp.ok) {
      console.error(
        `[wecom] response_url POST failed: ${resp.status} ${resp.statusText}`,
      );
    }
  } catch (err) {
    console.error("[wecom] response_url POST error:", err);
  }
}

// ─── Channel lifecycle ──────────────────────────────────────────────

export async function startWeComBot(
  config: WeComConfig,
  appCtx: AppContext,
): Promise<{ stop: () => void; broadcast: (text: string) => Promise<void> }> {
  console.log("[wecom] Smart bot channel started (HTTP callback mode)");

  // Restore chat targets from database
  try {
    const targets = appCtx.memoryStore.getChatTargets("wecom");
    for (const t of targets) {
      chatSessionMap.set(t.targetId, t.sessionId ?? "");
    }
    if (targets.length > 0) {
      console.log(
        `[wecom] Restored ${targets.length} chat target(s) from database`,
      );
    }
  } catch (err) {
    console.error("[wecom] Failed to restore chat targets:", err);
  }

  return {
    stop: () => {
      console.log("[wecom] Channel stopped");
      chatSessionMap.clear();
      pendingPrompts.clear();
      activeStreams.clear();
    },
    broadcast: async (text: string) => {
      // WeCom 智能机器人无法主动推送消息（只能被动回复或用 response_url）
      // broadcast 功能暂不支持
      console.log("[wecom] Broadcast not supported for smart bot mode");
    },
  };
}
