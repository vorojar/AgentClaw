import * as lark from "@larksuiteoapi/node-sdk";
import * as Sentry from "@sentry/node";
import type { AppContext } from "./bootstrap.js";
import type {
  Message,
  ContentBlock,
  ToolExecutionContext,
} from "@agentclaw/types";
import { getWsClients } from "./ws.js";

/** Map Feishu chat_id → AgentClaw session ID */
const chatSessionMap = new Map<string, string>();

/** Pending ask_user prompts: chat_id → resolve */
const pendingPrompts = new Map<string, (answer: string) => void>();

function broadcastSessionActivity(sessionId: string): void {
  const msg = JSON.stringify({
    type: "session_activity",
    sessionId,
    channel: "feishu",
  });
  for (const ws of getWsClients()) {
    try {
      ws.send(msg);
    } catch {}
  }
}

function extractText(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function stripFileMarkdown(text: string): string {
  return text.replace(/!?\[[^\]]*\]\([^)]*\/files\/[^)]+\)\n?/g, "");
}

function splitMessage(text: string, maxLen = 4000): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitIdx = remaining.lastIndexOf("\n", maxLen);
    if (splitIdx <= 0) splitIdx = remaining.lastIndexOf(" ", maxLen);
    if (splitIdx <= 0) splitIdx = maxLen;
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }
  return chunks;
}

export interface FeishuConfig {
  appId: string;
  appSecret: string;
  /** Comma-separated open_id whitelist. If empty, ALL users are blocked. */
  allowedUsers?: string;
}

/** Send a text message to a Feishu chat */
async function sendText(
  client: lark.Client,
  chatId: string,
  text: string,
): Promise<void> {
  await client.im.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: chatId,
      content: JSON.stringify({ text }),
      msg_type: "text",
    },
  });
}

/**
 * Start a Feishu (Lark) bot using WebSocket mode (no public IP required).
 * Returns stop/broadcast handles for integration with the gateway lifecycle.
 */
export async function startFeishuBot(
  config: FeishuConfig,
  appCtx: AppContext,
): Promise<{ stop: () => void; broadcast: (text: string) => Promise<void> }> {
  const baseConfig = {
    appId: config.appId,
    appSecret: config.appSecret,
  };

  // User whitelist — if not configured, block everyone (safe by default)
  const allowedUsers = new Set(
    (config.allowedUsers ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  if (allowedUsers.size === 0) {
    console.warn(
      "[feishu] WARNING: FEISHU_ALLOWED_USERS is empty — all messages will be rejected. Set it to a comma-separated list of open_id values.",
    );
  } else {
    console.log(
      `[feishu] User whitelist: ${allowedUsers.size} user(s) allowed`,
    );
  }

  // Client for sending messages
  const client = new lark.Client(baseConfig);

  // Restore chat targets from database
  try {
    const targets = appCtx.memoryStore.getChatTargets("feishu");
    for (const t of targets) {
      chatSessionMap.set(t.targetId, t.sessionId ?? "");
    }
    if (targets.length > 0) {
      console.log(
        `[feishu] Restored ${targets.length} chat target(s) from database`,
      );
    }
  } catch (err) {
    console.error("[feishu] Failed to restore chat targets:", err);
  }

  // Background message processing (must not block the event callback)
  async function handleMessage(data: {
    sender: { sender_id?: { open_id?: string }; sender_type: string };
    message: {
      message_id: string;
      chat_id: string;
      chat_type: string;
      message_type: string;
      content: string;
    };
  }): Promise<void> {
    const { sender, message } = data;
    const { chat_id, message_type, content } = message;
    const openId = sender?.sender_id?.open_id ?? "";

    // Whitelist check — reject unauthorized users
    if (!openId || !allowedUsers.has(openId)) {
      console.log(`[feishu] Blocked message from unauthorized user: ${openId}`);
      await sendText(
        client,
        chat_id,
        "Access denied. This bot is restricted to authorized users only.",
      );
      return;
    }

    // Only handle text messages for now
    let userText: string;
    if (message_type === "text") {
      try {
        userText = (JSON.parse(content) as { text: string }).text.trim();
      } catch {
        userText = content;
      }
    } else {
      userText = `[收到非文本消息，类型: ${message_type}]`;
    }

    // Strip @bot mentions from group messages
    // Feishu sends @bot as @_user_1 in text
    userText = userText.replace(/@_user_\d+/g, "").trim();

    if (!userText) return;

    // Check for pending ask_user prompt
    const pendingResolve = pendingPrompts.get(chat_id);
    if (pendingResolve) {
      pendingPrompts.delete(chat_id);
      pendingResolve(userText);
      return;
    }

    // Get or create session
    let sessionId = chatSessionMap.get(chat_id);
    if (!sessionId) {
      try {
        const session = await appCtx.orchestrator.createSession();
        sessionId = session.id;
        chatSessionMap.set(chat_id, sessionId);
        appCtx.memoryStore.saveChatTarget("feishu", chat_id, sessionId);
      } catch (err) {
        console.error("[feishu] Failed to create session:", err);
        await sendText(client, chat_id, "Failed to start session.");
        return;
      }
    }

    // Process message through orchestrator
    try {
      const sentFiles: Array<{ url: string; filename: string }> = [];
      const toolContext: ToolExecutionContext = {
        sentFiles,
        promptUser: async (question: string) => {
          await sendText(client, chat_id, `? ${question}`);
          return new Promise<string>((resolve) => {
            pendingPrompts.set(chat_id, resolve);
          });
        },
        notifyUser: async (msg: string) => {
          await sendText(client, chat_id, msg);
        },
        sendFile: async (filePath: string, caption?: string) => {
          const { basename } = await import("node:path");
          const filename = basename(filePath);
          const url = `/files/${encodeURIComponent(filename)}`;
          sentFiles.push({ url, filename });
          const port = process.env.PORT || "3100";
          const host = process.env.PUBLIC_URL || `http://localhost:${port}`;
          await sendText(
            client,
            chat_id,
            `${caption || filename}\n${host}${url}`,
          );
        },
      };

      const eventStream = appCtx.orchestrator.processInputStream(
        sessionId,
        userText,
        toolContext,
      );

      let accumulatedText = "";
      for await (const event of eventStream) {
        if (event.type === "response_chunk") {
          accumulatedText += (event.data as { text: string }).text;
        } else if (event.type === "response_complete" && !accumulatedText) {
          accumulatedText = extractText(
            (event.data as { message: Message }).message.content,
          );
        }
      }

      accumulatedText = stripFileMarkdown(accumulatedText);
      if (!accumulatedText.trim()) {
        accumulatedText = "(empty response)";
      }

      for (const chunk of splitMessage(accumulatedText)) {
        await sendText(client, chat_id, chunk);
      }

      broadcastSessionActivity(sessionId);
    } catch (err) {
      Sentry.captureException(err);
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[feishu] Error processing message:", errMsg);
      if (errMsg.includes("Session not found")) {
        chatSessionMap.delete(chat_id);
        await sendText(client, chat_id, "Session expired. Please resend.");
      } else {
        await sendText(client, chat_id, `Error: ${errMsg.slice(0, 200)}`);
      }
    }
  }

  // Event dispatcher — callback must return within 3s, so we process in background
  const eventDispatcher = new lark.EventDispatcher({}).register({
    "im.message.receive_v1": (data) => {
      console.log(
        `[feishu] Message from ${data.sender?.sender_id?.open_id ?? "unknown"} in ${data.message.chat_id}`,
      );
      handleMessage(data).catch((err) => {
        console.error("[feishu] Unhandled error in handleMessage:", err);
      });
    },
  });

  // WSClient for receiving events via WebSocket
  const wsClient = new lark.WSClient({
    ...baseConfig,
    loggerLevel: lark.LoggerLevel.warn,
  });

  await wsClient.start({ eventDispatcher });
  console.log("[feishu] Bot connected via WebSocket mode");

  return {
    stop: () => {
      try {
        wsClient.close();
      } catch {}
    },
    broadcast: async (text: string) => {
      for (const [chatId] of chatSessionMap) {
        try {
          await sendText(client, chatId, text);
        } catch (err) {
          console.error(`[feishu] Failed to broadcast to ${chatId}:`, err);
        }
      }
    },
  };
}
