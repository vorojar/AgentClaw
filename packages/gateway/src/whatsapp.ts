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

const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "bmp",
]);

const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "mkv",
  "avi",
  "mov",
  "webm",
]);

function extractText(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Strip markdown image/link references to /files/ (already delivered via send_file) */
function stripFileMarkdown(text: string): string {
  return text.replace(/!?\[[^\]]*\]\([^)]*\/files\/[^)]+\)\n?/g, "");
}

/**
 * Split a long message into chunks that fit WhatsApp's display.
 * Uses same limit as Telegram (4096 chars) for readability.
 */
function splitMessage(text: string, maxLen = 4096): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    let splitIdx = remaining.lastIndexOf("\n", maxLen);
    if (splitIdx <= 0) {
      splitIdx = remaining.lastIndexOf(" ", maxLen);
    }
    if (splitIdx <= 0) {
      splitIdx = maxLen;
    }

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return chunks;
}

/** Send a text message and track its ID so self-chat doesn't re-trigger the bot */
async function botSendText(sock: WASocket, jid: string, text: string): Promise<void> {
  const sent = await sock.sendMessage(jid, { text });
  if (sent?.key?.id) trackBotMessageId(sent.key.id);
}

/** Send a voice note (ptt) and track its ID */
async function botSendVoice(sock: WASocket, jid: string, audioPath: string): Promise<void> {
  const { readFileSync } = await import("node:fs");
  const sent = await sock.sendMessage(jid, {
    audio: readFileSync(audioPath),
    mimetype: "audio/ogg; codecs=opus",
    ptt: true,
  });
  if (sent?.key?.id) trackBotMessageId(sent.key.id);
}

/**
 * Create a sendFile callback for a specific WhatsApp chat.
 */
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

/**
 * Process a text message from WhatsApp.
 */
async function handleTextMessage(
  sock: WASocket,
  appCtx: AppContext,
  jid: string,
  text: string,
): Promise<void> {
  // If there's a pending ask_user prompt for this chat, resolve it and return
  const pendingResolve = pendingPrompts.get(jid);
  if (pendingResolve) {
    pendingPrompts.delete(jid);
    pendingResolve(text);
    return;
  }

  // Get or create session
  let sessionId = chatSessionMap.get(jid);
  if (!sessionId) {
    try {
      const session = await appCtx.orchestrator.createSession();
      sessionId = session.id;
      chatSessionMap.set(jid, sessionId);
    } catch (err) {
      console.error("[whatsapp] Failed to create session:", err);
      await botSendText(sock, jid, "❌ Failed to start session. Please try again.");
      return;
    }
  }

  // Show composing indicator (non-critical, don't let it crash)
  await sock.sendPresenceUpdate("composing", jid).catch(() => {});

  try {
    const sentFiles: Array<{ url: string; filename: string }> = [];
    const toolContext: ToolExecutionContext = {
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

    const eventStream = appCtx.orchestrator.processInputStream(
      sessionId,
      text,
      toolContext,
    );

    let accumulatedText = "";
    let sendBuffer = "";
    let bufferStartTime = 0;
    let activeSkill = "";
    const FLUSH_INTERVAL = 3000;

    const flushBuffer = async () => {
      if (!sendBuffer.trim()) return;
      sendBuffer = stripFileMarkdown(sendBuffer);
      if (!sendBuffer.trim()) return;
      const chunks = splitMessage(sendBuffer);
      for (const chunk of chunks) {
        await botSendText(sock, jid, chunk);
      }
      sendBuffer = "";
      bufferStartTime = 0;
    };

    for await (const event of eventStream) {
      switch (event.type) {
        case "tool_call": {
          await flushBuffer();
          const data = event.data as {
            name: string;
            input: Record<string, unknown>;
          };
          if (data.name === "use_skill") {
            activeSkill = (data.input.name as string) || "";
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
          await botSendText(sock, jid, label);
          break;
        }
        case "response_chunk": {
          const data = event.data as { text: string };
          accumulatedText += data.text;
          if (!sendBuffer) bufferStartTime = Date.now();
          sendBuffer += data.text;
          if (sendBuffer.includes("\n\n") || (bufferStartTime && Date.now() - bufferStartTime > FLUSH_INTERVAL)) {
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

    await flushBuffer();
    await sock.sendPresenceUpdate("paused", jid).catch(() => {});

    if (!accumulatedText.trim()) {
      await botSendText(sock, jid, "(empty response)");
    }
  } catch (err) {
    await sock.sendPresenceUpdate("paused", jid).catch(() => {});

    const errMsg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : "";
    console.error("[whatsapp] Error processing text message:", errMsg, "\n", stack);

    if (errMsg.includes("Session not found")) {
      chatSessionMap.delete(jid);
      await botSendText(sock, jid, "⚠️ Session expired. Send your message again.").catch(() => {});
      return;
    }

    await botSendText(sock, jid, `❌ Error: ${errMsg.slice(0, 200)}`).catch(() => {});
  }
}

/**
 * Process an image message from WhatsApp.
 */
async function handleImageMessage(
  sock: WASocket,
  appCtx: AppContext,
  jid: string,
  msg: WAMessage,
  caption: string,
): Promise<void> {
  // Get or create session
  let sessionId = chatSessionMap.get(jid);
  if (!sessionId) {
    try {
      const session = await appCtx.orchestrator.createSession();
      sessionId = session.id;
      chatSessionMap.set(jid, sessionId);
    } catch (err) {
      console.error("[whatsapp] Failed to create session:", err);
      await botSendText(sock, jid, "❌ Failed to start session. Please try again.");
      return;
    }
  }

  await sock.sendPresenceUpdate("composing", jid).catch(() => {});

  try {
    // Download image from WhatsApp
    const buffer = await downloadMediaMessage(msg, "buffer", {});
    const imageBuffer = buffer as Buffer;
    const base64Data = imageBuffer.toString("base64");

    // Determine MIME type from the image message
    const imgMsg = msg.message?.imageMessage;
    const mimetype = imgMsg?.mimetype ?? "image/jpeg";
    const ext = mimetype.split("/")[1]?.split(";")[0].trim() ?? "jpg";

    // Save to local disk
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const uploadsDir = join(process.cwd(), "data", "uploads");
    mkdirSync(uploadsDir, { recursive: true });
    const localImageName = `wa_photo_${Date.now()}.${ext}`;
    const localImagePath = join(uploadsDir, localImageName);
    writeFileSync(localImagePath, imageBuffer);

    // Build multimodal content blocks
    const contentBlocks: ContentBlock[] = [
      {
        type: "image",
        data: base64Data,
        mediaType: mimetype,
      },
      {
        type: "text",
        text: `[用户发送了图片，已保存到 ${localImagePath.replace(/\\/g, "/")}]\n${caption || "请描述这张图片"}`,
      },
    ];

    const sentFiles: Array<{ url: string; filename: string }> = [];
    const toolContext: ToolExecutionContext = {
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

    const eventStream = appCtx.orchestrator.processInputStream(
      sessionId,
      contentBlocks,
      toolContext,
    );

    let accumulatedText = "";
    let sendBuffer = "";
    let bufferStartTime = 0;
    let activeSkill = "";
    const FLUSH_INTERVAL = 3000;

    const flushBuffer = async () => {
      if (!sendBuffer.trim()) return;
      sendBuffer = stripFileMarkdown(sendBuffer);
      if (!sendBuffer.trim()) return;
      const chunks = splitMessage(sendBuffer);
      for (const chunk of chunks) {
        await botSendText(sock, jid, chunk);
      }
      sendBuffer = "";
      bufferStartTime = 0;
    };

    for await (const event of eventStream) {
      switch (event.type) {
        case "tool_call": {
          await flushBuffer();
          const data = event.data as {
            name: string;
            input: Record<string, unknown>;
          };
          if (data.name === "use_skill") {
            activeSkill = (data.input.name as string) || "";
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
          await botSendText(sock, jid, label);
          break;
        }
        case "response_chunk": {
          const data = event.data as { text: string };
          accumulatedText += data.text;
          if (!sendBuffer) bufferStartTime = Date.now();
          sendBuffer += data.text;
          if (sendBuffer.includes("\n\n") || (bufferStartTime && Date.now() - bufferStartTime > FLUSH_INTERVAL)) {
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

    await flushBuffer();
    await sock.sendPresenceUpdate("paused", jid).catch(() => {});

    if (!accumulatedText.trim()) {
      await botSendText(sock, jid, "(empty response)");
    }
  } catch (err) {
    await sock.sendPresenceUpdate("paused", jid).catch(() => {});

    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[whatsapp] Error processing image:", errMsg, "\n", err instanceof Error ? err.stack : "");

    if (errMsg.includes("Session not found")) {
      chatSessionMap.delete(jid);
      await botSendText(sock, jid, "⚠️ Session expired. Send your message again.").catch(() => {});
      return;
    }

    await botSendText(sock, jid, `❌ Error: ${errMsg.slice(0, 200)}`).catch(() => {});
  }
}

/**
 * Process a document/file message from WhatsApp.
 */
async function handleDocumentMessage(
  sock: WASocket,
  appCtx: AppContext,
  jid: string,
  msg: WAMessage,
  caption: string,
  fileName: string,
  fileType: string,
  isVoice = false,
): Promise<void> {
  // Get or create session
  let sessionId = chatSessionMap.get(jid);
  if (!sessionId) {
    try {
      const session = await appCtx.orchestrator.createSession();
      sessionId = session.id;
      chatSessionMap.set(jid, sessionId);
    } catch (err) {
      console.error("[whatsapp] Failed to create session:", err);
      await botSendText(sock, jid, "❌ Failed to start session. Please try again.");
      return;
    }
  }

  await sock.sendPresenceUpdate("composing", jid).catch(() => {});

  try {
    // Download media
    const buffer = await downloadMediaMessage(msg, "buffer", {});
    const fileBuffer = buffer as Buffer;

    // Save to uploads directory
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const tmpDir = join(process.cwd(), "data", "uploads");
    mkdirSync(tmpDir, { recursive: true });
    const filePath = join(tmpDir, fileName);
    writeFileSync(filePath, fileBuffer);

    const text = `[用户发送了${fileType}: ${fileName}, 已保存到 ${filePath.replace(/\\/g, "/")}]${caption ? `\n用户附言: ${caption}` : ""}`;

    const sentFiles: Array<{ url: string; filename: string }> = [];
    const toolContext: ToolExecutionContext = {
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

    const eventStream = appCtx.orchestrator.processInputStream(
      sessionId,
      text,
      toolContext,
    );

    let accumulatedText = "";
    let sendBuffer = "";
    let bufferStartTime = 0;
    let activeSkill = "";
    const FLUSH_INTERVAL = 3000;

    const flushBuffer = async () => {
      if (!sendBuffer.trim()) return;
      sendBuffer = stripFileMarkdown(sendBuffer);
      if (!sendBuffer.trim()) return;
      const chunks = splitMessage(sendBuffer);
      for (const chunk of chunks) {
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
          if (!isVoice) {
            await botSendText(sock, jid, label);
          }
          break;
        }
        case "response_chunk": {
          const data = event.data as { text: string };
          accumulatedText += data.text;
          if (!sendBuffer) bufferStartTime = Date.now();
          sendBuffer += data.text;
          if (!isVoice && (sendBuffer.includes("\n\n") || (bufferStartTime && Date.now() - bufferStartTime > FLUSH_INTERVAL))) {
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
    await sock.sendPresenceUpdate("paused", jid).catch(() => {});
  } catch (err) {
    await sock.sendPresenceUpdate("paused", jid).catch(() => {});

    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[whatsapp] Error processing ${fileType}:`, errMsg, "\n", err instanceof Error ? err.stack : "");

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
    child() { return silentLogger; },
    trace: noop, debug: noop, info: noop, warn: noop,
    error(obj: unknown, msg?: string) {
      console.error("[whatsapp]", msg ?? obj);
    },
  };

  function createSocket(): WASocket {
    const s = makeWASocket({
      auth: state,
      browser: Browsers.ubuntu("AgentClaw"),
      logger: silentLogger as any,
    });
    return s;
  }

  sock = createSocket();

  // ── Event binding ──────────────────────────────
  function bindEvents(s: WASocket): void {
    s.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      // Display QR code in terminal when available
      if (qr) {
        console.log("[whatsapp] Scan this QR code with your WhatsApp app:");
        qrcode.generate(qr, { small: true });
      }

      if (connection === "close") {
        const statusCode =
          (lastDisconnect?.error as { output?: { statusCode?: number } })
            ?.output?.statusCode;
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
        // Only handle "notify" type (real incoming messages)
        if (type !== "notify") return;

        for (const msg of messages) {
          const msgId = msg.key.id;

          // Skip messages sent by the bot itself (avoid infinite loop in self-chat)
          if (msgId && botSentMessages.has(msgId)) continue;

          // Only respond in self-chat (own JID) — ignore all other conversations
          const jid = msg.key.remoteJid;
          if (!jid || !sock.user) continue;
          const ownPN = sock.user.id.split(":")[0] + "@s.whatsapp.net";
          const ownLID = (sock.user as { lid?: string }).lid?.split(":")[0] + "@lid";
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
              await handleImageMessage(sock, appCtx, jid, msg, caption);
              continue;
            }

            // ── Document message ──
            if (message.documentMessage) {
              const fileName =
                message.documentMessage.fileName ??
                `file_${Date.now()}`;
              const caption = message.documentMessage.caption ?? "";
              await handleDocumentMessage(
                sock, appCtx, jid, msg, caption, fileName, "文件",
              );
              continue;
            }

            // ── Video message ──
            if (message.videoMessage) {
              const ext =
                message.videoMessage.mimetype?.split("/")[1]?.split(";")[0].trim() ?? "mp4";
              const fileName = `video_${Date.now()}.${ext}`;
              const caption = message.videoMessage.caption ?? "";
              await handleDocumentMessage(
                sock, appCtx, jid, msg, caption, fileName, "视频",
              );
              continue;
            }

            // ── Audio message ──
            if (message.audioMessage) {
              const ext =
                message.audioMessage.mimetype?.split("/")[1]?.split(";")[0].trim() ?? "ogg";
              const fileName = `audio_${Date.now()}.${ext}`;
              await handleDocumentMessage(
                sock, appCtx, jid, msg, "", fileName, "语音", true,
              );
              continue;
            }

            // ── Text message ──
            const text =
              message.conversation ??
              message.extendedTextMessage?.text;
            if (text) {
              // Handle commands
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

              await handleTextMessage(sock, appCtx, jid, text);
            }
          } catch (err) {
            console.error("[whatsapp] Unhandled error processing message:", err instanceof Error ? err.stack : err);
            await botSendText(sock, jid, "❌ Internal error. Please try again.").catch(() => {});
          }
        }
      },
    );
  }

  // Bind events on the initial socket
  bindEvents(sock);

  console.log("[whatsapp] WhatsApp bot initializing... Scan the QR code with your phone.");

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
