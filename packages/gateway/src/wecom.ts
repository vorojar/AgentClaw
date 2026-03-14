/**
 * WeCom (企业微信) 智能机器人渠道
 *
 * 接入方式：WebSocket 长连接（无需公网 IP）
 * - 使用 @wecom/aibot-node-sdk WSClient 建立长连接
 * - 自动心跳 + 指数退避重连
 *
 * 回复方式：
 * 1. 流式回复（replyStream）— 支持 Markdown
 * 2. 主动推送（sendMessage）— 支持 broadcast
 *
 * 环境变量：
 *   WECOM_BOT_ID     — 机器人 ID
 *   WECOM_BOT_SECRET — 机器人 Secret
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import * as Sentry from "@sentry/node";
import { WSClient } from "@wecom/aibot-node-sdk";
import type {
  WsFrame,
  BaseMessage,
  TextMessage,
  ImageMessage,
  VoiceMessage,
  FileMessage,
  MixedMessage,
} from "@wecom/aibot-node-sdk";
import type { AppContext } from "./bootstrap.js";
import type {
  Message,
  ContentBlock,
  ToolExecutionContext,
} from "@agentclaw/types";
import {
  extractText,
  stripFileMarkdown,
  splitMessage,
  broadcastSessionActivity,
} from "./utils.js";
import { PLATFORM_HINTS } from "./platform-hints.js";

// ─── Types ──────────────────────────────────────────────────────────

export interface WeComConfig {
  botId: string;
  secret: string;
}

// ─── Module-level state ─────────────────────────────────────────────

/** Map WeCom chatid → AgentClaw session ID */
const chatSessionMap = new Map<string, string>();

/** Pending ask_user prompts: chatKey → resolve */
const pendingPrompts = new Map<string, (answer: string) => void>();

/** Upload directory for downloaded files */
const UPLOAD_DIR = resolve(process.cwd(), "data", "uploads");

/** WSClient instance (for broadcast) */
let _wsClient: WSClient | null = null;

/** Chat keys we have seen (for broadcast via sendMessage) */
const knownChats = new Map<string, { chatid: string; chattype: string }>();

// ─── Helpers ────────────────────────────────────────────────────────

/** Derive a unique chat key from a message (single chat uses userid, group uses chatid) */
function chatKey(msg: BaseMessage): string {
  return msg.chattype === "group" && msg.chatid
    ? msg.chatid
    : msg.from.userid;
}

/** Download and decrypt a file using the SDK */
async function downloadWithSdk(
  client: WSClient,
  url: string,
  aesKey?: string,
): Promise<{ buffer: Buffer; filename?: string } | null> {
  try {
    return await client.downloadFile(url, aesKey);
  } catch (err) {
    console.error("[wecom] Failed to download file:", err);
    return null;
  }
}

// ─── Message handling ───────────────────────────────────────────────

async function handleMessage(
  client: WSClient,
  frame: WsFrame<BaseMessage>,
  appCtx: AppContext,
): Promise<void> {
  const msg = frame.body!;
  const key = chatKey(msg);
  const userId = msg.from.userid;

  // Track chat for broadcast
  knownChats.set(key, {
    chatid: msg.chatid || msg.from.userid,
    chattype: msg.chattype,
  });

  // Extract text and content blocks
  let userText = "";
  const contentBlocks: ContentBlock[] = [];

  switch (msg.msgtype) {
    case "text": {
      const tm = msg as TextMessage;
      userText = tm.text?.content || "";
      break;
    }
    case "voice": {
      const vm = msg as VoiceMessage;
      userText = vm.voice?.content || "[语音消息]";
      break;
    }
    case "image": {
      const im = msg as ImageMessage;
      if (im.image?.url) {
        const result = await downloadWithSdk(
          client,
          im.image.url,
          im.image.aeskey,
        );
        if (result) {
          contentBlocks.push({
            type: "image",
            data: result.buffer.toString("base64"),
            mediaType: "image/jpeg",
          });
        }
      }
      userText = "[图片]";
      break;
    }
    case "file": {
      const fm = msg as FileMessage;
      if (fm.file?.url) {
        try {
          const result = await downloadWithSdk(
            client,
            fm.file.url,
            fm.file.aeskey,
          );
          if (result) {
            mkdirSync(UPLOAD_DIR, { recursive: true });
            const safeName = `${Date.now()}_${(result.filename || "file").replace(/[^a-zA-Z0-9._-]/g, "_")}`;
            const savePath = resolve(UPLOAD_DIR, safeName);
            writeFileSync(savePath, result.buffer);
            userText = `[用户发送了文件: ${result.filename || "file"}，已保存到 ${savePath}]`;
          }
        } catch (err) {
          console.error("[wecom] Failed to save file:", err);
          userText = "[用户发送了文件]";
        }
      }
      break;
    }
    case "mixed": {
      const mm = msg as MixedMessage;
      if (mm.mixed?.msg_item) {
        for (const item of mm.mixed.msg_item) {
          if (item.msgtype === "text" && item.text?.content) {
            userText += item.text.content;
          } else if (item.msgtype === "image" && item.image?.url) {
            const result = await downloadWithSdk(
              client,
              item.image.url,
              item.image.aeskey,
            );
            if (result) {
              contentBlocks.push({
                type: "image",
                data: result.buffer.toString("base64"),
                mediaType: "image/jpeg",
              });
            }
          }
        }
      }
      break;
    }
    default:
      userText = `[不支持的消息类型: ${msg.msgtype}]`;
  }

  // /new command — reset session
  if (userText.trim() === "/new" || userText.trim() === "新会话") {
    chatSessionMap.delete(key);
    const streamId = `wecom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      await client.replyStream(frame, streamId, "会话已重置，请开始新的对话。", true);
    } catch (err) {
      console.error("[wecom] Failed to reply /new:", err);
    }
    return;
  }

  // Check pending ask_user
  const pendingResolve = pendingPrompts.get(key);
  if (pendingResolve) {
    pendingPrompts.delete(key);
    pendingResolve(userText || "[图片]");
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
  let sessionId = chatSessionMap.get(key);
  if (!sessionId) {
    const session = await appCtx.orchestrator.createSession({
      channel: "wecom",
      chatid: key,
      userId,
      platformHint: PLATFORM_HINTS.wecom,
    });
    sessionId = session.id;
    chatSessionMap.set(key, sessionId);
    appCtx.memoryStore.saveChatTarget("wecom", key, sessionId);
  }

  // Build tool context
  const sentFiles: Array<{ url: string; filename: string }> = [];
  const toolContext: ToolExecutionContext = {
    sentFiles,
    originalUserText: typeof input === "string" ? input : userText,
    promptUser: async (question: string) => {
      // Send question via stream reply
      const qStreamId = `wecom_q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      try {
        await client.replyStream(frame, qStreamId, `❓ ${question}`, true);
      } catch {}
      return new Promise<string>((resolve) => {
        const timer = setTimeout(() => {
          pendingPrompts.delete(key);
          resolve("[用户未在 5 分钟内回答]");
        }, 5 * 60 * 1000);
        pendingPrompts.set(key, (answer: string) => {
          clearTimeout(timer);
          resolve(answer);
        });
      });
    },
    notifyUser: async (message: string) => {
      // Use sendMessage for notifications (doesn't consume the reply slot)
      const chatid = msg.chatid || msg.from.userid;
      try {
        await client.sendMessage(chatid, {
          msgtype: "markdown",
          markdown: { content: message },
        });
      } catch (err) {
        console.error("[wecom] Failed to notify user:", err);
      }
    },
    sendFile: async (filePath: string, caption?: string) => {
      const filename = basename(filePath);
      const fileUrl = `/files/${encodeURIComponent(filename)}`;
      sentFiles.push({ url: fileUrl, filename });
      const port = process.env.PORT || "3100";
      const host = process.env.PUBLIC_URL || `http://localhost:${port}`;
      const chatid = msg.chatid || msg.from.userid;
      try {
        await client.sendMessage(chatid, {
          msgtype: "markdown",
          markdown: { content: `📎 ${caption || filename}\n${host}${fileUrl}` },
        });
      } catch (err) {
        console.error("[wecom] Failed to send file link:", err);
      }
    },
  };

  // Process through orchestrator with streaming
  console.log(
    `[wecom] Processing message from ${userId} in chat ${key}`,
  );

  const streamId = `wecom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const eventStream = appCtx.orchestrator.processInputStream(
      sessionId,
      input,
      toolContext,
    );

    let accumulatedText = "";
    let lastSentLength = 0;
    let chunkCount = 0;

    for await (const event of eventStream) {
      if (event.type === "response_chunk") {
        const { text } = event.data as { text: string };
        accumulatedText += text;
        chunkCount++;

        // Stream incremental updates every ~20 chunks or 500 chars
        if (
          chunkCount % 20 === 0 ||
          accumulatedText.length - lastSentLength > 500
        ) {
          const current = stripFileMarkdown(accumulatedText).trim();
          if (current && current.length > lastSentLength) {
            try {
              await client.replyStream(frame, streamId, current, false);
              lastSentLength = current.length;
            } catch {
              // Stream send failed, will send final
            }
          }
        }
      } else if (event.type === "response_complete" && !accumulatedText) {
        accumulatedText = extractText(
          (event.data as { message: Message }).message.content,
        );
      }
    }

    // Final text
    let finalText = stripFileMarkdown(accumulatedText).trim();
    if (!finalText) {
      finalText = "（无回复内容）";
    }

    // Send final stream (finish=true)
    // WeCom stream content max 20480 bytes
    if (Buffer.byteLength(finalText, "utf-8") > 20480) {
      // Too long — split and send via sendMessage
      const chunks = splitMessage(finalText, 15000);
      // Send first chunk as stream finish
      await client.replyStream(frame, streamId, chunks[0], true);
      // Send remaining chunks via sendMessage
      const chatid = msg.chatid || msg.from.userid;
      for (let i = 1; i < chunks.length; i++) {
        try {
          await client.sendMessage(chatid, {
            msgtype: "markdown",
            markdown: { content: chunks[i] },
          });
        } catch (err) {
          console.error("[wecom] Failed to send overflow chunk:", err);
        }
      }
    } else {
      await client.replyStream(frame, streamId, finalText, true);
    }

    // Broadcast session activity to Web UI
    broadcastSessionActivity(sessionId, "wecom");
  } catch (err) {
    Sentry.captureException(err);
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[wecom] Error processing message:", errMsg);

    // Session expired after restart — clear stale mapping and prompt retry
    if (errMsg.includes("Session not found")) {
      chatSessionMap.delete(key);
      try {
        await client.replyStream(frame, streamId, "会话已过期，请重新发送消息。", true);
      } catch {}
      return;
    }

    try {
      await client.replyStream(
        frame,
        streamId,
        "抱歉，处理消息时出现错误，请稍后再试。",
        true,
      );
    } catch {
      // Last resort failed
    }
  }
}

// ─── Channel lifecycle ──────────────────────────────────────────────

export async function startWeComBot(
  config: WeComConfig,
  appCtx: AppContext,
): Promise<{ stop: () => void; broadcast: (text: string) => Promise<void> }> {
  const client = new WSClient({
    botId: config.botId,
    secret: config.secret,
    maxReconnectAttempts: -1, // Infinite reconnect
  });

  _wsClient = client;

  // Restore chat targets from database
  try {
    const targets = appCtx.memoryStore.getChatTargets("wecom");
    for (const t of targets) {
      chatSessionMap.set(t.targetId, t.sessionId ?? "");
      // We don't know chattype from DB, default to single
      knownChats.set(t.targetId, { chatid: t.targetId, chattype: "single" });
    }
    if (targets.length > 0) {
      console.log(
        `[wecom] Restored ${targets.length} chat target(s) from database`,
      );
    }
  } catch (err) {
    console.error("[wecom] Failed to restore chat targets:", err);
  }

  // Event handlers
  client.on("authenticated", () => {
    console.log("[wecom] WebSocket authenticated successfully");
  });

  client.on("disconnected", (reason) => {
    console.warn("[wecom] WebSocket disconnected:", reason);
  });

  client.on("reconnecting", (attempt) => {
    console.log(`[wecom] Reconnecting... attempt ${attempt}`);
  });

  client.on("error", (error) => {
    console.error("[wecom] WebSocket error:", error.message);
    Sentry.captureException(error);
  });

  // Message handler — handle all message types
  client.on("message", (frame: WsFrame<BaseMessage>) => {
    handleMessage(client, frame, appCtx).catch((err) => {
      Sentry.captureException(err);
      console.error("[wecom] Unhandled error in message handler:", err);
    });
  });

  // Enter-chat event — send welcome message
  client.on("event.enter_chat", (frame) => {
    client
      .replyWelcome(frame, {
        msgtype: "text",
        text: { content: "你好！有什么可以帮你的吗？" },
      })
      .catch((err) => {
        console.error("[wecom] Failed to send welcome:", err);
      });
  });

  // Connect
  client.connect();
  console.log("[wecom] Smart bot channel started (WebSocket long connection mode)");

  return {
    stop: () => {
      console.log("[wecom] Channel stopping...");
      client.disconnect();
      _wsClient = null;
      chatSessionMap.clear();
      pendingPrompts.clear();
      knownChats.clear();
    },
    broadcast: async (text: string) => {
      // Send to all known chats via sendMessage
      for (const [, info] of knownChats) {
        try {
          await client.sendMessage(info.chatid, {
            msgtype: "markdown",
            markdown: { content: text },
          });
        } catch (err) {
          console.error(
            `[wecom] Failed to broadcast to ${info.chatid}:`,
            err,
          );
        }
      }
    },
  };
}
