import { DWClient, TOPIC_ROBOT, EventAck } from "dingtalk-stream-sdk-nodejs";
import type { DWClientDownStream } from "dingtalk-stream-sdk-nodejs";
import * as Sentry from "@sentry/node";
import type { AppContext } from "./bootstrap.js";
import type {
  Message,
  ContentBlock,
  ToolExecutionContext,
} from "@agentclaw/types";
import { getWsClients } from "./ws.js";

/** Map DingTalk conversationId → AgentClaw session ID */
const chatSessionMap = new Map<string, string>();

/** Extra info needed for broadcast via OpenAPI */
interface ChatInfo {
  conversationType: string; // '1' = 单聊, '2' = 群聊
  senderStaffId: string;
  robotCode: string;
}
const chatInfoMap = new Map<string, ChatInfo>();

/** Pending ask_user prompts: conversationId → resolve */
const pendingPrompts = new Map<string, (answer: string) => void>();

function broadcastSessionActivity(sessionId: string): void {
  const msg = JSON.stringify({
    type: "session_activity",
    sessionId,
    channel: "dingtalk",
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

function splitMessage(text: string, maxLen = 5000): string[] {
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

/** Reply to a DingTalk message via sessionWebhook */
async function replyText(sessionWebhook: string, text: string): Promise<void> {
  await fetch(sessionWebhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      msgtype: "text",
      text: { content: text },
    }),
  });
}

/** DingTalk OpenAPI base URL */
const DINGTALK_API = "https://api.dingtalk.com/v1.0";

export interface DingTalkConfig {
  clientId: string;
  clientSecret: string;
  /** Comma-separated staffId whitelist. If empty, ALL users are blocked. */
  allowedUsers?: string;
}

/**
 * Start a DingTalk bot using Stream mode (no public IP required).
 * Returns stop/broadcast handles for integration with the gateway lifecycle.
 */
export async function startDingTalkBot(
  config: DingTalkConfig,
  appCtx: AppContext,
): Promise<{ stop: () => void; broadcast: (text: string) => Promise<void> }> {
  // User whitelist — if not configured, block everyone (safe by default)
  const allowedUsers = new Set(
    (config.allowedUsers ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  if (allowedUsers.size === 0) {
    console.warn(
      "[dingtalk] WARNING: DINGTALK_ALLOWED_USERS is empty — all messages will be rejected. Set it to a comma-separated list of staffId values.",
    );
  } else {
    console.log(
      `[dingtalk] User whitelist: ${allowedUsers.size} user(s) allowed`,
    );
  }

  const client = new DWClient({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });

  // Restore chat targets from database
  try {
    const targets = appCtx.memoryStore.getChatTargets("dingtalk");
    for (const t of targets) {
      chatSessionMap.set(t.targetId, t.sessionId ?? "");
    }
    if (targets.length > 0) {
      console.log(
        `[dingtalk] Restored ${targets.length} chat target(s) from database`,
      );
    }
  } catch (err) {
    console.error("[dingtalk] Failed to restore chat targets:", err);
  }

  // Register robot message callback
  client.registerCallbackListener(
    TOPIC_ROBOT,
    async (res: DWClientDownStream) => {
      const msg = JSON.parse(res.data) as {
        conversationId: string;
        conversationType: string;
        senderStaffId: string;
        senderNick: string;
        sessionWebhook: string;
        robotCode: string;
        msgtype: string;
        text?: { content: string };
        msgId: string;
      };

      const {
        conversationId,
        conversationType,
        senderStaffId,
        sessionWebhook,
        robotCode,
        msgtype,
        text,
      } = msg;

      // Whitelist check — reject unauthorized users
      if (!senderStaffId || !allowedUsers.has(senderStaffId)) {
        console.log(
          `[dingtalk] Blocked message from unauthorized user: ${senderStaffId} (${msg.senderNick})`,
        );
        await replyText(
          sessionWebhook,
          "Access denied. This bot is restricted to authorized users only.",
        );
        client.send(res.headers.messageId, { status: EventAck.SUCCESS });
        return;
      }

      // Store chat info for broadcast
      chatInfoMap.set(conversationId, {
        conversationType,
        senderStaffId,
        robotCode,
      });

      // Extract user text
      let userText: string;
      if (msgtype === "text" && text) {
        userText = text.content.trim();
      } else {
        userText = `[收到非文本消息，类型: ${msgtype}]`;
      }

      // Check for pending ask_user prompt
      const pendingResolve = pendingPrompts.get(conversationId);
      if (pendingResolve) {
        pendingPrompts.delete(conversationId);
        pendingResolve(userText);
        client.send(res.headers.messageId, { status: EventAck.SUCCESS });
        return;
      }

      // Get or create session
      let sessionId = chatSessionMap.get(conversationId);
      if (!sessionId) {
        try {
          const session = await appCtx.orchestrator.createSession();
          sessionId = session.id;
          chatSessionMap.set(conversationId, sessionId);
          appCtx.memoryStore.saveChatTarget(
            "dingtalk",
            conversationId,
            sessionId,
          );
        } catch (err) {
          console.error("[dingtalk] Failed to create session:", err);
          await replyText(sessionWebhook, "Failed to start session.");
          client.send(res.headers.messageId, { status: EventAck.SUCCESS });
          return;
        }
      }

      // Process message through orchestrator
      try {
        const sentFiles: Array<{ url: string; filename: string }> = [];
        const toolContext: ToolExecutionContext = {
          sentFiles,
          promptUser: async (question: string) => {
            await replyText(sessionWebhook, `? ${question}`);
            return new Promise<string>((resolve) => {
              pendingPrompts.set(conversationId, resolve);
            });
          },
          notifyUser: async (message: string) => {
            await replyText(sessionWebhook, message);
          },
          sendFile: async (filePath: string, caption?: string) => {
            const { basename } = await import("node:path");
            const filename = basename(filePath);
            const url = `/files/${encodeURIComponent(filename)}`;
            sentFiles.push({ url, filename });
            const port = process.env.PORT || "3100";
            const host = process.env.PUBLIC_URL || `http://localhost:${port}`;
            await replyText(
              sessionWebhook,
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
          await replyText(sessionWebhook, chunk);
        }

        broadcastSessionActivity(sessionId);
      } catch (err) {
        Sentry.captureException(err);
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error("[dingtalk] Error processing message:", errMsg);
        if (errMsg.includes("Session not found")) {
          chatSessionMap.delete(conversationId);
          await replyText(sessionWebhook, "Session expired. Please resend.");
        } else {
          await replyText(sessionWebhook, `Error: ${errMsg.slice(0, 200)}`);
        }
      }

      // Acknowledge message receipt
      client.send(res.headers.messageId, { status: EventAck.SUCCESS });
    },
  );

  await client.connect();
  console.log("[dingtalk] Bot connected via Stream mode");

  return {
    stop: () => {
      try {
        client.disconnect();
      } catch {}
    },
    broadcast: async (text: string) => {
      const accessToken = (
        client as unknown as { config: { access_token?: string } }
      ).config.access_token;
      if (!accessToken) {
        console.warn("[dingtalk] No access token for broadcast");
        return;
      }

      for (const [convId, info] of chatInfoMap) {
        try {
          if (info.conversationType === "2") {
            // Group message
            await fetch(`${DINGTALK_API}/robot/groupMessages/send`, {
              method: "POST",
              headers: {
                "x-acs-dingtalk-access-token": accessToken,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                robotCode: info.robotCode,
                openConversationId: convId,
                msgKey: "sampleText",
                msgParam: JSON.stringify({ content: text }),
              }),
            });
          } else {
            // 1:1 message
            await fetch(`${DINGTALK_API}/robot/oToMessages/batchSend`, {
              method: "POST",
              headers: {
                "x-acs-dingtalk-access-token": accessToken,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                robotCode: info.robotCode,
                userIds: [info.senderStaffId],
                msgKey: "sampleText",
                msgParam: JSON.stringify({ content: text }),
              }),
            });
          }
        } catch (err) {
          console.error(`[dingtalk] Failed to broadcast to ${convId}:`, err);
        }
      }
    },
  };
}
