import { Bot } from "grammy";
import type { AppContext } from "./bootstrap.js";
import type { TaskScheduler } from "./scheduler.js";
import type {
  Message,
  ContentBlock,
  AgentEvent,
  ToolExecutionContext,
} from "@agentclaw/types";

/** Map Telegram chat ID → AgentClaw session ID */
const chatSessionMap = new Map<number, string>();

/** Pending ask_user prompts: chatId → resolve function for the next user message */
const pendingPrompts = new Map<number, (answer: string) => void>();

function extractText(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * Split a long message into chunks that fit Telegram's 4096-char limit.
 * Tries to split at newline boundaries for readability.
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

    // Try to split at a newline
    let splitIdx = remaining.lastIndexOf("\n", maxLen);
    if (splitIdx <= 0) {
      // No good newline, split at space
      splitIdx = remaining.lastIndexOf(" ", maxLen);
    }
    if (splitIdx <= 0) {
      // No good boundary, hard cut
      splitIdx = maxLen;
    }

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return chunks;
}

/**
 * Start a Telegram bot that forwards messages to the AgentClaw orchestrator.
 * Returns the bot instance for later cleanup.
 */
export async function startTelegramBot(
  token: string,
  appCtx: AppContext,
  scheduler?: TaskScheduler,
): Promise<Bot> {
  const bot = new Bot(token);

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

  // ── Document messages ──────────────────────────
  bot.on("message:document", async (ctx) => {
    const chatId = ctx.chat.id;
    const doc = ctx.message.document;

    // Download file
    const file = await ctx.api.getFile(doc.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${token}/` + file.file_path;

    const response = await fetch(fileUrl);
    const buffer = Buffer.from(await response.arrayBuffer());

    // Save to temp directory
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const tmpDir = join(process.cwd(), "data", "uploads");
    mkdirSync(tmpDir, { recursive: true });

    const fileName = doc.file_name ?? `file_${Date.now()}`;
    const filePath = join(tmpDir, fileName);
    writeFileSync(filePath, buffer);

    // Forward to orchestrator as text message describing the file
    const caption = ctx.message.caption ?? "";
    const text = `[用户发送了文件: ${fileName}, 已保存到 ${filePath}]${caption ? `\n用户附言: ${caption}` : ""}`;

    // Get or create session (same pattern as text handler)
    let sessionId = chatSessionMap.get(chatId);
    if (!sessionId) {
      try {
        const session = await appCtx.orchestrator.createSession();
        sessionId = session.id;
        chatSessionMap.set(chatId, sessionId);
      } catch (err) {
        console.error("[telegram] Failed to create session:", err);
        await ctx.reply("❌ Failed to start session. Please try again.");
        return;
      }
    }

    await ctx.api.sendChatAction(chatId, "typing");
    const typingInterval = setInterval(() => {
      ctx.api.sendChatAction(chatId, "typing").catch(() => {});
    }, 4000);

    try {
      const toolContext: ToolExecutionContext = {
        promptUser: async (question: string) => {
          await ctx.reply(`❓ ${question}`);
          return new Promise<string>((resolve) => {
            pendingPrompts.set(chatId, resolve);
          });
        },
        notifyUser: async (message: string) => {
          await bot.api.sendMessage(chatId, message);
        },
        sendFile: async (path: string, fileCaption?: string) => {
          const { createReadStream } = await import("node:fs");
          const { InputFile } = await import("grammy");
          await bot.api.sendDocument(chatId, new InputFile(createReadStream(path)), {
            caption: fileCaption,
          });
        },
      };

      const eventStream = appCtx.orchestrator.processInputStream(
        sessionId,
        text,
        toolContext,
      );

      let accumulatedText = "";
      for await (const event of eventStream) {
        switch (event.type) {
          case "tool_call": {
            const data = event.data as { name: string; input: Record<string, unknown> };
            const label = `⚙️ 正在执行: ${data.name}...`;
            await ctx.reply(label);
            break;
          }
          case "response_chunk": {
            const data = event.data as { text: string };
            accumulatedText += data.text;
            break;
          }
          case "response_complete": {
            if (!accumulatedText) {
              const data = event.data as { message: Message };
              accumulatedText = extractText(data.message.content);
            }
            break;
          }
        }
      }

      clearInterval(typingInterval);

      if (!accumulatedText.trim()) {
        await ctx.reply("(empty response)");
        return;
      }

      const chunks = splitMessage(accumulatedText);
      for (const chunk of chunks) {
        await ctx.reply(chunk);
      }
    } catch (err) {
      clearInterval(typingInterval);
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[telegram] Error processing document:", errMsg);
      if (errMsg.includes("Session not found")) {
        chatSessionMap.delete(chatId);
        await ctx.reply("⚠️ Session expired. Send your message again.");
        return;
      }
      await ctx.reply(`❌ Error: ${errMsg.slice(0, 200)}`);
    }
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

    // Get or create session
    let sessionId = chatSessionMap.get(chatId);
    if (!sessionId) {
      try {
        const session = await appCtx.orchestrator.createSession();
        sessionId = session.id;
        chatSessionMap.set(chatId, sessionId);
      } catch (err) {
        console.error("[telegram] Failed to create session:", err);
        await ctx.reply("❌ Failed to start session. Please try again.");
        return;
      }
    }

    // Show typing indicator
    await ctx.api.sendChatAction(chatId, "typing");

    // Keep typing indicator alive during long operations
    const typingInterval = setInterval(() => {
      ctx.api.sendChatAction(chatId, "typing").catch(() => {});
    }, 4000);

    try {
      // Build execution context with Telegram-specific callbacks
      const toolContext: ToolExecutionContext = {
        promptUser: async (question: string) => {
          await ctx.reply(`❓ ${question}`);
          return new Promise<string>((resolve) => {
            pendingPrompts.set(chatId, resolve);
          });
        },
        notifyUser: async (message: string) => {
          await bot.api.sendMessage(chatId, message);
        },
        sendFile: async (path: string, fileCaption?: string) => {
          const { createReadStream } = await import("node:fs");
          const { InputFile } = await import("grammy");
          await bot.api.sendDocument(chatId, new InputFile(createReadStream(path)), {
            caption: fileCaption,
          });
        },
      };

      const eventStream = appCtx.orchestrator.processInputStream(
        sessionId,
        text,
        toolContext,
      );

      let accumulatedText = "";

      for await (const event of eventStream) {
        switch (event.type) {
          case "tool_call": {
            const data = event.data as {
              name: string;
              input: Record<string, unknown>;
            };
            const label =
              data.name === "web_search"
                ? `🔍 正在搜索: ${(data.input as { query?: string }).query ?? data.name}...`
                : `⚙️ 正在执行: ${data.name}...`;
            await ctx.reply(label);
            break;
          }
          case "response_chunk": {
            const data = event.data as { text: string };
            accumulatedText += data.text;
            break;
          }
          case "response_complete": {
            if (!accumulatedText) {
              const data = event.data as { message: Message };
              accumulatedText = extractText(data.message.content);
            }
            break;
          }
        }
      }

      clearInterval(typingInterval);

      if (!accumulatedText.trim()) {
        await ctx.reply("(empty response)");
        return;
      }

      // Split and send
      const chunks = splitMessage(accumulatedText);
      for (const chunk of chunks) {
        await ctx.reply(chunk);
      }
    } catch (err) {
      clearInterval(typingInterval);

      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[telegram] Error processing message:", errMsg);

      // If session not found, clear mapping and retry
      if (errMsg.includes("Session not found")) {
        chatSessionMap.delete(chatId);
        await ctx.reply("⚠️ Session expired. Send your message again.");
        return;
      }

      await ctx.reply(`❌ Error: ${errMsg.slice(0, 200)}`);
    }
  });

  // ── 图片消息处理 ──────────────────────────────────
  bot.on("message:photo", async (ctx) => {
    const chatId = ctx.chat.id;

    // 获取最大尺寸的图片（数组最后一个）
    const photos = ctx.message.photo;
    const largestPhoto = photos[photos.length - 1];
    const fileId = largestPhoto.file_id;

    // 用户可能同时发送图片+文字（caption），也可能只发图片
    const caption = ctx.message.caption ?? "请描述这张图片";

    // Get or create session
    let sessionId = chatSessionMap.get(chatId);
    if (!sessionId) {
      try {
        const session = await appCtx.orchestrator.createSession();
        sessionId = session.id;
        chatSessionMap.set(chatId, sessionId);
      } catch (err) {
        console.error("[telegram] Failed to create session:", err);
        await ctx.reply("❌ Failed to start session. Please try again.");
        return;
      }
    }

    // Show typing indicator
    await ctx.api.sendChatAction(chatId, "typing");

    const typingInterval = setInterval(() => {
      ctx.api.sendChatAction(chatId, "typing").catch(() => {});
    }, 4000);

    try {
      // 下载图片并转换为 base64
      const file = await bot.api.getFile(fileId);
      const filePath = file.file_path;
      if (!filePath) {
        clearInterval(typingInterval);
        await ctx.reply("❌ 无法获取图片文件路径。");
        return;
      }

      const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
      const response = await fetch(fileUrl);
      if (!response.ok) {
        clearInterval(typingInterval);
        await ctx.reply("❌ 下载图片失败。");
        return;
      }

      const arrayBuffer = await response.arrayBuffer();
      const base64Data = Buffer.from(arrayBuffer).toString("base64");

      // 根据文件扩展名判断 MIME 类型
      const ext = filePath.split(".").pop()?.toLowerCase() ?? "jpg";
      const mimeMap: Record<string, string> = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        gif: "image/gif",
        webp: "image/webp",
      };
      const mediaType = mimeMap[ext] ?? "image/jpeg";

      // 构造多模态输入：ImageContent + TextContent
      const contentBlocks: ContentBlock[] = [
        {
          type: "image",
          data: base64Data,
          mediaType,
        },
        {
          type: "text",
          text: caption,
        },
      ];

      // Build execution context with Telegram-specific callbacks
      const toolContext: ToolExecutionContext = {
        promptUser: async (question: string) => {
          await ctx.reply(`❓ ${question}`);
          return new Promise<string>((resolve) => {
            pendingPrompts.set(chatId, resolve);
          });
        },
        notifyUser: async (message: string) => {
          await bot.api.sendMessage(chatId, message);
        },
        sendFile: async (path: string, fileCaption?: string) => {
          const { createReadStream } = await import("node:fs");
          const { InputFile } = await import("grammy");
          await bot.api.sendDocument(chatId, new InputFile(createReadStream(path)), {
            caption: fileCaption,
          });
        },
      };

      const eventStream = appCtx.orchestrator.processInputStream(
        sessionId,
        contentBlocks,
        toolContext,
      );

      let accumulatedText = "";

      for await (const event of eventStream) {
        switch (event.type) {
          case "tool_call": {
            const data = event.data as {
              name: string;
              input: Record<string, unknown>;
            };
            const label =
              data.name === "web_search"
                ? `🔍 正在搜索: ${(data.input as { query?: string }).query ?? data.name}...`
                : `⚙️ 正在执行: ${data.name}...`;
            await ctx.reply(label);
            break;
          }
          case "response_chunk": {
            const data = event.data as { text: string };
            accumulatedText += data.text;
            break;
          }
          case "response_complete": {
            if (!accumulatedText) {
              const data = event.data as { message: Message };
              accumulatedText = extractText(data.message.content);
            }
            break;
          }
        }
      }

      clearInterval(typingInterval);

      if (!accumulatedText.trim()) {
        await ctx.reply("(empty response)");
        return;
      }

      // Split and send
      const chunks = splitMessage(accumulatedText);
      for (const chunk of chunks) {
        await ctx.reply(chunk);
      }
    } catch (err) {
      clearInterval(typingInterval);

      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[telegram] Error processing photo message:", errMsg);

      if (errMsg.includes("Session not found")) {
        chatSessionMap.delete(chatId);
        await ctx.reply("⚠️ Session expired. Send your message again.");
        return;
      }

      await ctx.reply(`❌ Error: ${errMsg.slice(0, 200)}`);
    }
  });

  // ── Error handler ───────────────────────────────
  bot.catch((err) => {
    console.error("[telegram] Bot error:", err.message);
  });

  // Wire up scheduled task notifications to Telegram
  if (scheduler) {
    scheduler.setOnTaskFire((task) => {
      // Send to ALL active Telegram chats
      for (const [chatId] of chatSessionMap) {
        bot.api.sendMessage(chatId, `⏰ 定时任务: ${task.action}`).catch((err) => {
          console.error(`[telegram] Failed to notify chat ${chatId}:`, err);
        });
      }
    });
  }

  // Start the bot
  await bot.init();
  console.log(
    `[telegram] Bot started: @${bot.botInfo.username} (${bot.botInfo.id})`,
  );
  bot.start();

  return bot;
}
