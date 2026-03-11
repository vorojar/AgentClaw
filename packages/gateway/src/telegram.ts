import { Bot } from "grammy";
import * as Sentry from "@sentry/node";
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

/** Map Telegram chat ID → AgentClaw session ID */
const chatSessionMap = new Map<number, string>();

/** Pending ask_user prompts: chatId → resolve function for the next user message */
const pendingPrompts = new Map<number, (answer: string) => void>();

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp"]);

const VIDEO_EXTENSIONS = new Set(["mp4", "mkv", "avi", "mov", "webm"]);

/**
 * Create a sendFile callback for a specific chat.
 * Sends images via sendPhoto (inline preview) and other files via sendDocument.
 */
/** Max file size (bytes) to send inline via Telegram Bot API. Larger files get a download link. */
const MAX_SEND_SIZE = 50 * 1024 * 1024; // 50 MB

function createSendFile(
  bot: Bot,
  chatId: number,
  sentFiles?: Array<{ url: string; filename: string }>,
): (path: string, caption?: string) => Promise<void> {
  return async (filePath: string, caption?: string) => {
    const { createReadStream, statSync } = await import("node:fs");
    const { basename } = await import("node:path");
    const { InputFile } = await import("grammy");
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const filename = basename(filePath);
    const url = `/files/${encodeURIComponent(filename)}`;

    // Track for persistence (agent-loop will generate markdown links)
    sentFiles?.push({ url, filename });

    // Large files: send download link instead of inline upload
    try {
      const size = statSync(filePath).size;
      if (size > MAX_SEND_SIZE) {
        const port = process.env.PORT || "3100";
        const host = process.env.PUBLIC_URL || `http://localhost:${port}`;
        const sizeMB = (size / 1024 / 1024).toFixed(1);
        await bot.api.sendMessage(
          chatId,
          `📎 ${caption || filename} (${sizeMB}MB)\n${host}${url}`,
        );
        return;
      }
    } catch {
      // stat failed — try sending anyway
    }

    const inputFile = new InputFile(createReadStream(filePath), filename);

    if (IMAGE_EXTENSIONS.has(ext)) {
      await bot.api.sendPhoto(chatId, inputFile, { caption });
    } else if (VIDEO_EXTENSIONS.has(ext)) {
      await bot.api.sendVideo(chatId, inputFile, { caption });
    } else {
      await bot.api.sendDocument(chatId, inputFile, { caption });
    }
  };
}

/** Telegram Bot API base URL */
const TG_API_BASE = "https://api.telegram.org";

/**
 * Start a Telegram bot that forwards messages to the AgentClaw orchestrator.
 * Returns the bot instance for later cleanup.
 */
export async function startTelegramBot(
  token: string,
  appCtx: AppContext,
): Promise<{ stop: () => void; broadcast: (text: string) => Promise<void> }> {
  const bot = new Bot(token);

  /** Call sendMessageDraft (not yet in grammy) via raw HTTP */
  async function sendMessageDraft(
    chatId: number,
    draftId: number,
    text: string,
  ): Promise<void> {
    // Telegram limit: 1-4096 chars; show tail if overflowing
    if (text.length > 4096) {
      text = "…" + text.slice(-(4096 - 1));
    }
    try {
      await fetch(`${TG_API_BASE}/bot${token}/sendMessageDraft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, draft_id: draftId, text }),
      });
    } catch {
      // Draft update failed (network etc.), non-critical — ignore
    }
  }

  // Restore chat targets from database (survive restarts)
  try {
    const targets = appCtx.memoryStore.getChatTargets("telegram");
    for (const t of targets) {
      chatSessionMap.set(Number(t.targetId), t.sessionId ?? "");
    }
    if (targets.length > 0) {
      console.log(
        `[telegram] Restored ${targets.length} chat target(s) from database`,
      );
    }
  } catch (err) {
    console.error("[telegram] Failed to restore chat targets:", err);
  }

  // ── /start ──────────────────────────────────────
  bot.command("start", async (ctx) => {
    await ctx.reply(
      "👋 Hi! I'm *AgentClaw* — your AI assistant\\.\n\n" +
        "Just send me a message and I'll help you out\\.\n\n" +
        "Commands:\n" +
        "/new — Start a new conversation\n" +
        "/help — Show this help",
      { parse_mode: "MarkdownV2" },
    );
  });

  // ── /help ───────────────────────────────────────
  bot.command("help", async (ctx) => {
    await ctx.reply(
      "🤖 *AgentClaw Bot*\n\n" +
        "Send any text message and I'll respond\\.\n\n" +
        "/new — Start fresh \\(new session\\)\n" +
        "/help — Show this help",
      { parse_mode: "MarkdownV2" },
    );
  });

  // ── /new ────────────────────────────────────────
  bot.command("new", async (ctx) => {
    const chatId = ctx.chat.id;
    chatSessionMap.delete(chatId);
    await ctx.reply("🔄 New conversation started. Send me a message!");
  });

  // ── Shared processing pipeline ──────────────────
  interface ProcessOptions {
    chatId: number;
    input: string | ContentBlock[];
    replyFn: (text: string) => Promise<unknown>;
    /** Use streaming buffer/flush (default true). Set false for file messages. */
    streaming?: boolean;
    /** Send TTS voice reply instead of text (for voice messages). */
    isVoice?: boolean;
    /** Label for error logs (e.g. "文件", "photo"). */
    label?: string;
  }

  async function processAndReply(opts: ProcessOptions): Promise<void> {
    const {
      chatId,
      input,
      replyFn,
      streaming = true,
      isVoice = false,
      label = "message",
    } = opts;

    // Get or create session
    let sessionId = chatSessionMap.get(chatId);
    if (!sessionId) {
      try {
        const session = await appCtx.orchestrator.createSession({
          platformHint: PLATFORM_HINTS.telegram,
        });
        sessionId = session.id;
        chatSessionMap.set(chatId, sessionId);
        appCtx.memoryStore.saveChatTarget(
          "telegram",
          String(chatId),
          sessionId,
        );
      } catch (err) {
        console.error("[telegram] Failed to create session:", err);
        await replyFn("❌ Failed to start session. Please try again.");
        return;
      }
    }

    // Typing indicator
    await bot.api.sendChatAction(chatId, "typing");
    const typingInterval = setInterval(() => {
      bot.api.sendChatAction(chatId, "typing").catch(() => {});
    }, 4000);

    try {
      const sentFiles: Array<{ url: string; filename: string }> = [];
      const toolContext: ToolExecutionContext = {
        sentFiles,
        promptUser: async (question: string) => {
          await replyFn(`❓ ${question}`);
          return new Promise<string>((resolve) => {
            // 5 分钟超时，防止 Promise 永远挂起
            const timer = setTimeout(() => {
              pendingPrompts.delete(chatId);
              resolve("[用户未在 5 分钟内回答]");
            }, 5 * 60 * 1000);
            pendingPrompts.set(chatId, (answer: string) => {
              clearTimeout(timer);
              resolve(answer);
            });
          });
        },
        notifyUser: async (message: string) => {
          await bot.api.sendMessage(chatId, message);
        },
        sendFile: createSendFile(bot, chatId, sentFiles),
      };

      const eventStream = appCtx.orchestrator.processInputStream(
        sessionId,
        input,
        toolContext,
      );

      let accumulatedText = "";
      let activeSkill = "";
      // Draft streaming state
      const draftId = streaming ? Date.now() % 2147483647 || 1 : 0;
      let draftPrefix = ""; // tool-call status lines shown above draft
      let lastDraftTime = 0;
      const DRAFT_THROTTLE = 300; // ms — avoid flooding Telegram API

      const updateDraft = async (force = false) => {
        if (!streaming || !draftId) return;
        const now = Date.now();
        if (!force && now - lastDraftTime < DRAFT_THROTTLE) return;
        const displayText = stripFileMarkdown(
          (draftPrefix ? draftPrefix + "\n\n" : "") + accumulatedText,
        ).trim();
        if (!displayText) return;
        lastDraftTime = now;
        await sendMessageDraft(chatId, draftId, displayText);
      };

      for await (const event of eventStream) {
        switch (event.type) {
          case "tool_call": {
            const data = event.data as {
              name: string;
              input: Record<string, unknown>;
            };
            if (data.name === "use_skill") {
              activeSkill = (data.input.name as string) || "";
              draftPrefix += `⚙️ use_skill: ${activeSkill}\n`;
            } else if (data.name === "web_search") {
              draftPrefix += `🔍 ${(data.input as { query?: string }).query ?? "searching"}...\n`;
            } else if (data.name === "bash") {
              draftPrefix += activeSkill
                ? `⚙️ bash: ${activeSkill}\n`
                : "⚙️ bash\n";
            } else {
              draftPrefix += `⚙️ ${data.name}\n`;
            }
            if (streaming) await updateDraft(true);
            else await replyFn(draftPrefix.trim().split("\n").pop()!);
            break;
          }
          case "response_chunk": {
            const data = event.data as { text: string };
            accumulatedText += data.text;
            if (streaming) void updateDraft();
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

      clearInterval(typingInterval);

      // Clear draft by sending empty-ish (Telegram will hide it when final message arrives)
      // Then send the definitive message
      accumulatedText = stripFileMarkdown(accumulatedText);

      if (!accumulatedText.trim()) {
        await replyFn("(empty response)");
        broadcastSessionActivity(sessionId!, "telegram");
        return;
      }

      // Send final message(s)
      if (isVoice) {
        const { textToSpeech } = await import("./tts.js");
        const ogg = await textToSpeech(accumulatedText);
        if (ogg) {
          const { createReadStream } = await import("node:fs");
          const { InputFile } = await import("grammy");
          await bot.api.sendVoice(chatId, new InputFile(createReadStream(ogg)));
        } else {
          for (const chunk of splitMessage(accumulatedText))
            await replyFn(chunk);
        }
      } else {
        for (const chunk of splitMessage(accumulatedText)) await replyFn(chunk);
      }

      broadcastSessionActivity(sessionId!, "telegram");
    } catch (err) {
      clearInterval(typingInterval);
      Sentry.captureException(err);
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[telegram] Error processing ${label}:`, errMsg);
      if (errMsg.includes("Session not found")) {
        chatSessionMap.delete(chatId);
        await replyFn("⚠️ Session expired. Send your message again.");
        return;
      }
      await replyFn(`❌ Error: ${errMsg.slice(0, 200)}`);
    }
  }

  // ── File message helper (document, video, audio, voice) ──
  async function handleFileMessage(
    chatId: number,
    caption: string,
    replyFn: (text: string) => Promise<unknown>,
    fileId: string,
    fileName: string,
    fileType: string,
    isVoice = false,
  ) {
    const file = await bot.api.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    const response = await fetch(fileUrl);
    const buf = Buffer.from(await response.arrayBuffer());

    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const uploadsDir = join(process.cwd(), "data", "uploads");
    mkdirSync(uploadsDir, { recursive: true });
    const filePath = join(uploadsDir, fileName);
    writeFileSync(filePath, buf);

    let text: string;

    // Auto-transcribe voice/audio at framework level
    if (isVoice) {
      try {
        const { execSync } = await import("node:child_process");
        const scriptPath = join(process.cwd(), "scripts", "transcribe.py").replace(/\\/g, "/");
        const result = execSync(`python "${scriptPath}" "${filePath.replace(/\\/g, "/")}"`, {
          encoding: "utf-8",
          timeout: 30000,
        }).trim();
        text = result
          ? `[用户语音转文字: ${result}]${caption ? `\n用户附言: ${caption}` : ""}`
          : `[用户发送了语音，转录为空]`;
      } catch {
        // Fallback: let LLM handle it
        text = `[用户发送了${fileType}: ${fileName}, 已保存到 ${filePath.replace(/\\/g, "/")}]${caption ? `\n用户附言: ${caption}` : ""}`;
      }
    } else {
      text = `[用户发送了${fileType}: ${fileName}, 已保存到 ${filePath.replace(/\\/g, "/")}]${caption ? `\n用户附言: ${caption}` : ""}`;
    }

    await processAndReply({
      chatId,
      input: text,
      replyFn,
      streaming: false,
      isVoice,
      label: fileType,
    });
  }

  // ── Document messages ──────────────────────────
  bot.on("message:document", async (ctx) => {
    const doc = ctx.message.document;
    const fileName = doc.file_name ?? `file_${Date.now()}`;
    await handleFileMessage(
      ctx.chat.id,
      ctx.message.caption ?? "",
      (t) => ctx.reply(t),
      doc.file_id,
      fileName,
      "文件",
    );
  });

  // ── Video messages ─────────────────────────────
  bot.on("message:video", async (ctx) => {
    const video = ctx.message.video;
    const ext = video.mime_type?.split("/")[1]?.split(";")[0].trim() ?? "mp4";
    const fileName =
      (video as unknown as { file_name?: string }).file_name ??
      `video_${Date.now()}.${ext}`;
    await handleFileMessage(
      ctx.chat.id,
      ctx.message.caption ?? "",
      (t) => ctx.reply(t),
      video.file_id,
      fileName,
      "视频",
    );
  });

  // ── Animation (GIF) messages ───────────────────
  bot.on("message:animation", async (ctx) => {
    const anim = ctx.message.animation;
    const fileName =
      (anim as unknown as { file_name?: string }).file_name ??
      `animation_${Date.now()}.mp4`;
    await handleFileMessage(
      ctx.chat.id,
      ctx.message.caption ?? "",
      (t) => ctx.reply(t),
      anim.file_id,
      fileName,
      "动图",
    );
  });

  // ── Audio messages ─────────────────────────────
  bot.on("message:audio", async (ctx) => {
    const audio = ctx.message.audio;
    const ext = audio.mime_type?.split("/")[1]?.split(";")[0].trim() ?? "mp3";
    const fileName = audio.file_name ?? `audio_${Date.now()}.${ext}`;
    await handleFileMessage(
      ctx.chat.id,
      ctx.message.caption ?? "",
      (t) => ctx.reply(t),
      audio.file_id,
      fileName,
      "音频",
    );
  });

  // ── Voice messages ─────────────────────────────
  bot.on("message:voice", async (ctx) => {
    const voice = ctx.message.voice;
    const fileName = `voice_${Date.now()}.ogg`;
    await handleFileMessage(
      ctx.chat.id,
      ctx.message.caption ?? "",
      (t) => ctx.reply(t),
      voice.file_id,
      fileName,
      "语音",
      true,
    );
  });

  // ── Text messages ───────────────────────────────
  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;

    // If there's a pending ask_user prompt for this chat, resolve it and return
    const pendingResolve = pendingPrompts.get(chatId);
    if (pendingResolve) {
      pendingPrompts.delete(chatId);
      pendingResolve(text);
      return;
    }

    await processAndReply({
      chatId,
      input: text,
      replyFn: (t) => ctx.reply(t),
      label: "text",
    });
  });

  // ── 图片消息处理 ──────────────────────────────────
  bot.on("message:photo", async (ctx) => {
    const chatId = ctx.chat.id;
    const photos = ctx.message.photo;
    const largestPhoto = photos[photos.length - 1];
    const caption = ctx.message.caption ?? "请描述这张图片";

    try {
      // 下载图片并转换为 base64
      const file = await bot.api.getFile(largestPhoto.file_id);
      if (!file.file_path) {
        await ctx.reply("❌ 无法获取图片文件路径。");
        return;
      }

      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
      const response = await fetch(fileUrl);
      if (!response.ok) {
        await ctx.reply("❌ 下载图片失败。");
        return;
      }

      const imageBuffer = Buffer.from(await response.arrayBuffer());
      const base64Data = imageBuffer.toString("base64");

      const ext = file.file_path.split(".").pop()?.toLowerCase() ?? "jpg";
      const mimeMap: Record<string, string> = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        gif: "image/gif",
        webp: "image/webp",
      };
      const mediaType = mimeMap[ext] ?? "image/jpeg";

      // 保存图片到本地磁盘
      const { mkdirSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const uploadsDir = join(process.cwd(), "data", "uploads");
      mkdirSync(uploadsDir, { recursive: true });
      const localImagePath = join(uploadsDir, `photo_${Date.now()}.${ext}`);
      writeFileSync(localImagePath, imageBuffer);

      const contentBlocks: ContentBlock[] = [
        { type: "image", data: base64Data, mediaType },
        {
          type: "text",
          text: `[用户发送了图片，已保存到 ${localImagePath.replace(/\\/g, "/")}]\n${caption}`,
        },
      ];

      await processAndReply({
        chatId,
        input: contentBlocks,
        replyFn: (t) => ctx.reply(t),
        label: "photo",
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[telegram] Error downloading photo:", errMsg);
      await ctx.reply(`❌ Error: ${errMsg.slice(0, 200)}`);
    }
  });

  // ── Error handler ───────────────────────────────
  bot.catch((err) => {
    Sentry.captureException(err.error ?? err);
    console.error("[telegram] Bot error:", err.message);
  });

  // Start the bot
  await bot.init();
  console.log(
    `[telegram] Bot started: @${bot.botInfo.username} (${bot.botInfo.id})`,
  );
  bot.start({ drop_pending_updates: true });

  return {
    stop: () => bot.stop().catch(() => {}),
    broadcast: async (text: string) => {
      for (const [chatId] of chatSessionMap) {
        await bot.api.sendMessage(chatId, text).catch((err) => {
          console.error(`[telegram] Failed to broadcast to ${chatId}:`, err);
        });
      }
    },
  };
}
