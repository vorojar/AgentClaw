import "dotenv/config";
import { bootstrap } from "./bootstrap.js";
import { createServer } from "./server.js";
import { TaskScheduler } from "./scheduler.js";
import { startTelegramBot } from "./telegram.js";
import { startWhatsAppBot } from "./whatsapp.js";

export { bootstrap } from "./bootstrap.js";
export type { AppContext, AppRuntimeConfig } from "./bootstrap.js";
export { createServer } from "./server.js";
export type { ServerOptions } from "./server.js";
export { TaskScheduler } from "./scheduler.js";
export type { ScheduledTask } from "./scheduler.js";
export { startTelegramBot } from "./telegram.js";
export { startWhatsAppBot } from "./whatsapp.js";

async function main(): Promise<void> {
  const port = parseInt(process.env.PORT || "3100", 10);
  const host = process.env.HOST || "0.0.0.0";

  console.log("[gateway] Bootstrapping...");
  const ctx = await bootstrap();

  console.log("[gateway] Creating server...");
  const app = await createServer({ ctx, scheduler: ctx.scheduler });

  // Start listening
  try {
    await app.listen({ port, host });
    console.log(`[gateway] Server listening on http://${host}:${port}`);
  } catch (err) {
    console.error("[gateway] Failed to start server:", err);
    process.exit(1);
  }

  // Telegram bot (optional — only starts if TELEGRAM_BOT_TOKEN is set)
  let telegramBot: Awaited<ReturnType<typeof startTelegramBot>> | undefined;
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  if (telegramToken) {
    try {
      telegramBot = await startTelegramBot(telegramToken, ctx);
    } catch (err) {
      console.error("[gateway] Failed to start Telegram bot:", err);
    }
  }

  // WhatsApp bot (optional — only starts if WHATSAPP_ENABLED is "true")
  let whatsappBot: Awaited<ReturnType<typeof startWhatsAppBot>> | undefined;
  const whatsappEnabled = process.env.WHATSAPP_ENABLED === "true";
  if (whatsappEnabled) {
    try {
      whatsappBot = await startWhatsAppBot(ctx);
    } catch (err) {
      console.error("[gateway] Failed to start WhatsApp bot:", err);
    }
  }

  // Scheduler: run orchestrator on task fire, broadcast results to all gateways
  ctx.scheduler.setOnTaskFire(async (task) => {
    console.log(
      `[scheduler] Running task "${task.name}" through orchestrator...`,
    );
    try {
      const session = await ctx.orchestrator.createSession();
      let text = "";

      for await (const event of ctx.orchestrator.processInputStream(
        session.id,
        task.action,
      )) {
        if (event.type === "response_chunk") {
          text += (event.data as { text: string }).text;
        }
      }

      if (!text.trim()) {
        text = `✅ 定时任务「${task.name}」已执行完成。`;
      }

      // Broadcast to all active gateways
      await telegramBot
        ?.broadcast(text)
        .catch((err) =>
          console.error("[scheduler] Telegram broadcast failed:", err),
        );
      await whatsappBot
        ?.broadcast(text)
        .catch((err) =>
          console.error("[scheduler] WhatsApp broadcast failed:", err),
        );
    } catch (err) {
      const msg = `❌ 定时任务「${task.name}」执行失败: ${err instanceof Error ? err.message : String(err)}`;
      console.error("[scheduler]", msg);
      await telegramBot?.broadcast(msg).catch(() => {});
      await whatsappBot?.broadcast(msg).catch(() => {});
    }
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[gateway] Received ${signal}, shutting down...`);
    telegramBot?.stop();
    whatsappBot?.stop();
    ctx.scheduler.stopAll();
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[gateway] Fatal error:", err);
  process.exit(1);
});
