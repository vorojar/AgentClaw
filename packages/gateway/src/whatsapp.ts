import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  downloadMediaMessage,
  type WASocket,
  type WAMessage,
  type BaileysEventMap,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
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
  errorMessage,
} from "./utils.js";

/** Map WhatsApp JID → AgentClaw session ID */
const chatSessionMap = new Map<string, string>();

/** Pending ask_user prompts: JID → resolve function for the next user message */
const pendingPrompts = new Map<string, (answer: string) => void>();

/** Recently processed message IDs for deduplication */
const processedMessages = new Set<string>();
const MAX_PROCESSED_CACHE = 1000;

/** Message IDs sent by the bot itself — used to distinguish bot replies from self-chat */
const botSentMessages = new Set<string>();
const MAX_BOT_SENT_CACHE = 500;

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp"]);

const VIDEO_EXTENSIONS = new Set(["mp4", "mkv", "avi", "mov", "webm"]);

/** Send a text message and track its ID so self-chat doesn't re-trigger the bot */
async function botSendText(
  sock: WASocket,
  jid: string,
  text: string,
): Promise<void> {
  const sent = await sock.sendMessage(jid, { text });
  if (sent?.key?.id) trackBotMessageId(sent.key.id);
}

/** Send a voice note (ptt) and track its ID */
async function botSendVoice(
  sock: WASocket,
  jid: string,
  audioPath: string,
): Promise<void> {
  const { readFileSync } = await import("node:fs");
  const sent = await sock.sendMessage(jid, {
    audio: readFileSync(audioPath),
    mimetype: "audio/ogg; codecs=opus",
    ptt: true,
  });
  if (sent?.key?.id) trackBotMessageId(sent.key.id);
}

/** Max file size (bytes) to send inline via WhatsApp. Larger files get a download link. */
const MAX_SEND_SIZE = 50 * 1024 * 1024; // 50 MB

function createSendFile(
  sock: WASocket,
  jid: string,
  sentFiles: Array<{ url: string; filename: string }>,
): (path: string, caption?: string) => Promise<void> {
  return async (filePath: string, caption?: string) => {
    const { readFileSync, statSync } = await import("node:fs");
    const { basename } = await import("node:path");
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const filename = basename(filePath);
    const fileUrl = `/files/${encodeURIComponent(filename)}`;

    // Large files: send download link instead of inline upload
    try {
      const size = statSync(filePath).size;
      if (size > MAX_SEND_SIZE) {
        const port = process.env.PORT || "3100";
        const host = process.env.PUBLIC_URL || `http://localhost:${port}`;
        const sizeMB = (size / 1024 / 1024).toFixed(1);
        const linkText = `📎 ${caption || filename} (${sizeMB}MB)\n${host}${fileUrl}`;
        const sent = await sock.sendMessage(jid, { text: linkText });
        if (sent?.key?.id) trackBotMessageId(sent.key.id);
        sentFiles.push({ url: fileUrl, filename });
        return;
      }
    } catch {
      // stat failed — try sending anyway
    }

    let sent;

    if (IMAGE_EXTENSIONS.has(ext)) {
      sent = await sock.sendMessage(jid, {
        image: readFileSync(filePath),
        caption,
      });
    } else if (VIDEO_EXTENSIONS.has(ext)) {
      sent = await sock.sendMessage(jid, {
        video: readFileSync(filePath),
        caption,
      });
    } else {
      sent = await sock.sendMessage(jid, {
        document: readFileSync(filePath),
        mimetype: "application/octet-stream",
        fileName: filename,
        caption,
      });
    }

    if (sent?.key?.id) trackBotMessageId(sent.key.id);
    sentFiles.push({ url: fileUrl, filename });
  };
}

/** Track a processed message ID, evicting old entries when cache is full */
function trackMessageId(id: string): void {
  if (processedMessages.size >= MAX_PROCESSED_CACHE) {
    const first = processedMessages.values().next().value;
    if (first) processedMessages.delete(first);
  }
  processedMessages.add(id);
}

/** Track a message ID sent by the bot */
function trackBotMessageId(id: string): void {
  if (botSentMessages.size >= MAX_BOT_SENT_CACHE) {
    const first = botSentMessages.values().next().value;
    if (first) botSentMessages.delete(first);
  }
  botSentMessages.add(id);
}

/** Get or create a session for the given JID */
async function ensureSession(
  sock: WASocket,
  appCtx: AppContext,
  jid: string,
): Promise<string | null> {
  const existing = chatSessionMap.get(jid);
  if (existing) return existing;

  try {
    const session = await appCtx.orchestrator.createSession();
    chatSessionMap.set(jid, session.id);
    appCtx.memoryStore.saveChatTarget("whatsapp", jid, session.id);
    return session.id;
  } catch (err) {
    console.error("[whatsapp] Failed to create session:", err);
    await botSendText(sock, jid, "❌ Failed to start session. Please try again.");
    return null;
  }
}

/** Create ToolExecutionContext for WhatsApp messages */
function createToolContext(
  sock: WASocket,
  jid: string,
): { context: ToolExecutionContext; sentFiles: Array<{ url: string; filename: string }> } {
  const sentFiles: Array<{ url: string; filename: string }> = [];
  const context: ToolExecutionContext = {
    sentFiles,
    promptUser: async (question: string) => {
      await botSendText(sock, jid, `❓ ${question}`);
      return new Promise<string>((resolve) => {
        pendingPrompts.set(jid, resolve);
      });
    },
    notifyUser: async (message: string) => {
      await botSendText(sock, jid, message);
    },
    sendFile: createSendFile(sock, jid, sentFiles),
  };
  return { context, sentFiles };
}

/**
 * Shared event-processing loop for all WhatsApp message types.
 * Streams tool status and response text, with optional voice-only mode.
 */
async function processEventStream(
  sock: WASocket,
  jid: string,
  eventStream: AsyncIterable<{ type: string; data: unknown }>,
  isVoice = false,
): Promise<void> {
  let accumulatedText = "";
  let sendBuffer = "";
  let bufferStartTime = 0;
  let activeSkill = "";
  const FLUSH_INTERVAL = 3000;

  const flushBuffer = async (): Promise<void> => {
    if (!sendBuffer.trim()) return;
    sendBuffer = stripFileMarkdown(sendBuffer);
    if (!sendBuffer.trim()) return;
    for (const chunk of splitMessage(sendBuffer)) {
      await botSendText(sock, jid, chunk);
    }
    sendBuffer = "";
    bufferStartTime = 0;
  };

  for await (const event of eventStream) {
    switch (event.type) {
      case "tool_call": {
        if (!isVoice) await flushBuffer();
        const data = event.data as {
          name: string;
          input: Record<string, unknown>;
        };
        if (data.name === "use_skill") {
          activeSkill = (data.input.name as string) || "";
          if (!isVoice) await botSendText(sock, jid, `⚙️ use_skill: ${activeSkill}`);
          break;
        }
        let label: string;
        if (data.name === "web_search") {
          label = `🔍 ${(data.input as { query?: string }).query ?? "searching"}...`;
        } else if (data.name === "bash") {
          label = activeSkill ? `⚙️ bash: ${activeSkill}` : "⚙️ bash";
        } else {
          label = `⚙️ ${data.name}`;
        }
        if (!isVoice) await botSendText(sock, jid, label);
        break;
      }
      case "response_chunk": {
        const data = event.data as { text: string };
        accumulatedText += data.text;
        if (!sendBuffer) bufferStartTime = Date.now();
        sendBuffer += data.text;
        if (
          !isVoice &&
          (sendBuffer.includes("\n\n") ||
            (bufferStartTime && Date.now() - bufferStartTime > FLUSH_INTERVAL))
        ) {
          await flushBuffer();
        }
        break;
      }
      case "response_complete": {
        const data = event.data as { message: Message };
        if (!accumulatedText) {
          accumulatedText = extractText(data.message.content);
          sendBuffer = accumulatedText;
        }
        break;
      }
    }
  }

  if (isVoice) {
    const cleanedText = stripFileMarkdown(accumulatedText).trim();
    if (cleanedText) {
      const { textToSpeech } = await import("./tts.js");
      const ogg = await textToSpeech(cleanedText);
      if (ogg) {
        await botSendVoice(sock, jid, ogg);
      } else {
        sendBuffer = cleanedText;
        await flushBuffer();
      }
    } else {
      await botSendText(sock, jid, "(empty response)");
    }
  } else {
    await flushBuffer();
    if (!accumulatedText.trim()) {
      await botSendText(sock, jid, "(empty response)");
    }
  }
}

/**
 * Process any WhatsApp message through the orchestrator with shared error handling.
 */
async function processMessage(
  sock: WASocket,
  appCtx: AppContext,
  jid: string,
  input: string | ContentBlock[],
  label: string,
  isVoice = false,
): Promise<void> {
  const sessionId = await ensureSession(sock, appCtx, jid);
  if (!sessionId) return;

  await sock.sendPresenceUpdate("composing", jid).catch(() => {});

  try {
    const { context } = createToolContext(sock, jid);
    const eventStream = appCtx.orchestrator.processInputStream(
      sessionId,
      input,
      context,
    );
    await processEventStream(sock, jid, eventStream, isVoice);
    await sock.sendPresenceUpdate("paused", jid).catch(() => {});
  } catch (err) {
    await sock.sendPresenceUpdate("paused", jid).catch(() => {});

    const errMsg = errorMessage(err);
    console.error(
      `[whatsapp] Error processing ${label}:`,
      errMsg,
      "\n",
      err instanceof Error ? err.stack : "",
    );

    if (errMsg.includes("Session not found")) {
      chatSessionMap.delete(jid);
      await botSendText(sock, jid, "⚠️ Session expired. Send your message again.").catch(() => {});
      return;
    }

    await botSendText(sock, jid, `❌ Error: ${errMsg.slice(0, 200)}`).catch(() => {});
  }
}

/**
 * Start the WhatsApp bot that forwards messages to the AgentClaw orchestrator.
 * Uses baileys (direct WhatsApp Web protocol) with QR code auth.
 *
 * Returns a stop function for graceful shutdown.
 */
export async function startWhatsAppBot(
  appCtx: AppContext,
): Promise<{ stop: () => void; broadcast: (text: string) => Promise<void> }> {
  const { join } = await import("node:path");
  const authDir = join(process.cwd(), "data", "whatsapp-auth");

  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  let sock: WASocket;
  let stopped = false;

  // Silent logger — only forward errors to console
  const noop = () => {};
  const silentLogger = {
    level: "error",
    child() {
      return silentLogger;
    },
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error(obj: unknown, msg?: string) {
      console.error("[whatsapp]", msg ?? obj);
    },
  };

  // Restore chat targets from database (survive restarts)
  try {
    const targets = appCtx.memoryStore.getChatTargets("whatsapp");
    for (const t of targets) {
      chatSessionMap.set(t.targetId, t.sessionId ?? "");
    }
    if (targets.length > 0) {
      console.log(
        `[whatsapp] Restored ${targets.length} chat target(s) from database`,
      );
    }
  } catch (err) {
    console.error("[whatsapp] Failed to restore chat targets:", err);
  }

  function createSocket(): WASocket {
    return makeWASocket({
      auth: state,
      browser: Browsers.ubuntu("AgentClaw"),
      logger: silentLogger as any,
    });
  }

  sock = createSocket();

  // ── Event binding ──────────────────────────────
  function bindEvents(s: WASocket): void {
    s.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log("[whatsapp] Scan this QR code with your WhatsApp app:");
        qrcode.generate(qr, { small: true });
      }

      if (connection === "close") {
        const statusCode = (
          lastDisconnect?.error as { output?: { statusCode?: number } }
        )?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log(
          `[whatsapp] Connection closed (status=${statusCode}). ${shouldReconnect ? "Reconnecting in 3s..." : "Logged out — please restart and re-scan QR."}`,
        );

        if (shouldReconnect && !stopped) {
          setTimeout(() => {
            if (!stopped) {
              sock = createSocket();
              bindEvents(sock);
            }
          }, 3000);
        }
      } else if (connection === "open") {
        console.log("[whatsapp] Connected successfully!");
      }
    });

    s.ev.on("creds.update", saveCreds);

    s.ev.on(
      "messages.upsert",
      async ({ messages, type }: BaileysEventMap["messages.upsert"]) => {
        if (type !== "notify") return;

        for (const msg of messages) {
          const msgId = msg.key.id;

          // Skip messages sent by the bot itself
          if (msgId && botSentMessages.has(msgId)) continue;

          // Only respond in self-chat
          const jid = msg.key.remoteJid;
          if (!jid || !sock.user) continue;
          const ownPN = sock.user.id.split(":")[0] + "@s.whatsapp.net";
          const rawLid = (sock.user as { lid?: string }).lid;
          const ownLID = rawLid ? rawLid.split(":")[0] + "@lid" : null;
          if (jid !== ownPN && jid !== ownLID) continue;

          // Dedup
          if (!msgId || processedMessages.has(msgId)) continue;
          trackMessageId(msgId);

          const message = msg.message;
          if (!message) continue;

          try {
            // ── Image message ──
            if (message.imageMessage) {
              const caption = message.imageMessage.caption ?? "";
              const buffer = await downloadMediaMessage(msg, "buffer", {});
              const imageBuffer = buffer as Buffer;

              const imgMsg = msg.message?.imageMessage;
              const mimetype = imgMsg?.mimetype ?? "image/jpeg";
              const ext = mimetype.split("/")[1]?.split(";")[0].trim() ?? "jpg";

              const { mkdirSync, writeFileSync } = await import("node:fs");
              const { join } = await import("node:path");
              const uploadsDir = join(process.cwd(), "data", "uploads");
              mkdirSync(uploadsDir, { recursive: true });
              const localImagePath = join(uploadsDir, `wa_photo_${Date.now()}.${ext}`);
              writeFileSync(localImagePath, imageBuffer);

              const contentBlocks: ContentBlock[] = [
                { type: "image", data: imageBuffer.toString("base64"), mediaType: mimetype },
                {
                  type: "text",
                  text: `[用户发送了图片，已保存到 ${localImagePath.replace(/\\/g, "/")}]\n${caption || "请描述这张图片"}`,
                },
              ];

              await processMessage(sock, appCtx, jid, contentBlocks, "image");
              continue;
            }

            // ── Document message ──
            if (message.documentMessage) {
              const fileName = message.documentMessage.fileName ?? `file_${Date.now()}`;
              const caption = message.documentMessage.caption ?? "";
              await handleMediaMessage(sock, appCtx, jid, msg, caption, fileName, "文件");
              continue;
            }

            // ── Video message ──
            if (message.videoMessage) {
              const ext = message.videoMessage.mimetype?.split("/")[1]?.split(";")[0].trim() ?? "mp4";
              const caption = message.videoMessage.caption ?? "";
              await handleMediaMessage(sock, appCtx, jid, msg, caption, `video_${Date.now()}.${ext}`, "视频");
              continue;
            }

            // ── Audio message ──
            if (message.audioMessage) {
              const ext = message.audioMessage.mimetype?.split("/")[1]?.split(";")[0].trim() ?? "ogg";
              await handleMediaMessage(sock, appCtx, jid, msg, "", `audio_${Date.now()}.${ext}`, "语音", true);
              continue;
            }

            // ── Text message ──
            const text = message.conversation ?? message.extendedTextMessage?.text;
            if (text) {
              const trimmed = text.trim();
              if (trimmed === "/new") {
                chatSessionMap.delete(jid);
                await botSendText(sock, jid, "🔄 New conversation started. Send me a message!");
                continue;
              }
              if (trimmed === "/help") {
                await botSendText(
                  sock,
                  jid,
                  "👋 我是 AgentClaw — 你的 AI 助手。\n\n直接发消息即可对话，支持文字和图片。\n\n/new — 开始新对话\n/help — 显示此帮助",
                );
                continue;
              }

              // Check for pending ask_user prompt
              const pendingResolve = pendingPrompts.get(jid);
              if (pendingResolve) {
                pendingPrompts.delete(jid);
                pendingResolve(text);
                continue;
              }

              await processMessage(sock, appCtx, jid, text, "text");
            }
          } catch (err) {
            console.error(
              "[whatsapp] Unhandled error processing message:",
              err instanceof Error ? err.stack : err,
            );
            await botSendText(sock, jid, "❌ Internal error. Please try again.").catch(() => {});
          }
        }
      },
    );
  }

  bindEvents(sock);

  console.log(
    "[whatsapp] WhatsApp bot initializing... Scan the QR code with your phone.",
  );

  return {
    stop: () => {
      stopped = true;
      sock.end(undefined);
    },
    broadcast: async (text: string) => {
      for (const [jid] of chatSessionMap) {
        await botSendText(sock, jid, text).catch((err) => {
          console.error(`[whatsapp] Failed to broadcast to ${jid}:`, err);
        });
      }
    },
  };
}

/**
 * Download media, save to uploads dir, and process through orchestrator.
 * Shared handler for document, video, and audio messages.
 */
async function handleMediaMessage(
  sock: WASocket,
  appCtx: AppContext,
  jid: string,
  msg: WAMessage,
  caption: string,
  fileName: string,
  fileType: string,
  isVoice = false,
): Promise<void> {
  const buffer = await downloadMediaMessage(msg, "buffer", {});
  const fileBuffer = buffer as Buffer;

  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const uploadsDir = join(process.cwd(), "data", "uploads");
  mkdirSync(uploadsDir, { recursive: true });
  const filePath = join(uploadsDir, fileName);
  writeFileSync(filePath, fileBuffer);

  const text = `[用户发送了${fileType}: ${fileName}, 已保存到 ${filePath.replace(/\\/g, "/")}]${caption ? `\n用户附言: ${caption}` : ""}`;
  await processMessage(sock, appCtx, jid, text, fileType, isVoice);
}
