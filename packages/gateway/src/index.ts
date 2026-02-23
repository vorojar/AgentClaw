import "dotenv/config";
import { bootstrap } from "./bootstrap.js";
import { createServer } from "./server.js";
import { TaskScheduler } from "./scheduler.js";
import { startTelegramBot } from "./telegram.js";
import { startWhatsAppBot } from "./whatsapp.js";
import { HeartbeatManager } from "./heartbeat.js";
import { getWsClients } from "./ws.js";

export { bootstrap } from "./bootstrap.js";
export type { AppContext, AppRuntimeConfig } from "./bootstrap.js";
export { createServer } from "./server.js";
export type { ServerOptions } from "./server.js";
export { TaskScheduler } from "./scheduler.js";
export type { ScheduledTask } from "./scheduler.js";
export { startTelegramBot } from "./telegram.js";
export { startWhatsAppBot } from "./whatsapp.js";
export { HeartbeatManager } from "./heartbeat.js";
export type { HeartbeatConfig, HeartbeatDeps } from "./heartbeat.js";

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

  // Unified broadcast: send text to all active gateways (Telegram + WhatsApp + WebSocket)
  const broadcastAll = async (text: string) => {
    await telegramBot
      ?.broadcast(text)
      .catch((err) => console.error("[broadcast] Telegram failed:", err));
    await whatsappBot
      ?.broadcast(text)
      .catch((err) => console.error("[broadcast] WhatsApp failed:", err));
    // Broadcast to all WebSocket clients
    for (const ws of getWsClients()) {
      try {
        ws.send(JSON.stringify({ type: "broadcast", text }));
      } catch {
        // client may have disconnected
      }
    }
  };

  // Scheduler: one-shot reminders broadcast directly; recurring tasks run through orchestrator
  ctx.scheduler.setOnTaskFire(async (task) => {
    if (task.oneShot) {
      // Reminder — just broadcast the message to all channels
      const text = `⏰ 提醒：${task.action}`;
      console.log(`[scheduler] Reminder fired: "${task.action}"`);
      await broadcastAll(text);
      return;
    }

    // Recurring task — run through orchestrator
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

      await broadcastAll(text);
    } catch (err) {
      const msg = `❌ 定时任务「${task.name}」执行失败: ${err instanceof Error ? err.message : String(err)}`;
      console.error("[scheduler]", msg);
      await broadcastAll(msg);
    }
  });

  // Heartbeat: periodic self-check for pending tasks/reminders
  const heartbeat = new HeartbeatManager(
    {
      enabled: process.env.HEARTBEAT_ENABLED === "true",
      intervalMinutes: parseInt(process.env.HEARTBEAT_INTERVAL || "5", 10),
    },
    {
      orchestrator: ctx.orchestrator,
      scheduler: ctx.scheduler,
      memoryStore: ctx.memoryStore,
      broadcast: broadcastAll,
    },
  );
  heartbeat.start();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[gateway] Received ${signal}, shutting down...`);
    heartbeat.stop();
    try {
      telegramBot?.stop();
    } catch {}
    try {
      whatsappBot?.stop();
    } catch {}
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
