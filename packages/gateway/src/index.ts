import * as Sentry from "@sentry/node";

// Sentry 错误监控：仅在配置了 DSN 时初始化，否则零开销
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "production",
    tracesSampleRate: 0.2,
  });
}

import "dotenv/config";
import { Cron } from "croner";
import { bootstrap } from "./bootstrap.js";
import { createServer } from "./server.js";
import { HeartbeatManager } from "./heartbeat.js";
import { getWsClients } from "./ws.js";
import { ChannelManager } from "./channel-manager.js";
import { runGws } from "./gws.js";
import { collectResponse, errorMessage } from "./utils.js";
import { TaskManager } from "@agentclaw/core";

export { bootstrap } from "./bootstrap.js";
export type { AppContext, AppRuntimeConfig } from "./bootstrap.js";
export { createServer } from "./server.js";
export type { ServerOptions } from "./server.js";
export { TaskScheduler } from "./scheduler.js";
export type { ScheduledTask } from "./scheduler.js";
export { startTelegramBot } from "./telegram.js";
export { startWhatsAppBot } from "./whatsapp.js";
export { startDingTalkBot } from "./dingtalk.js";
export type { DingTalkConfig } from "./dingtalk.js";
export { startFeishuBot } from "./feishu.js";
export type { FeishuConfig } from "./feishu.js";
export { startQQBot } from "./qqbot.js";
export type { QQBotConfig } from "./qqbot.js";
export { HeartbeatManager } from "./heartbeat.js";
export type { HeartbeatConfig, HeartbeatDeps } from "./heartbeat.js";
export { runHealthChecks, formatHealthResults } from "./health-check.js";
export type { HealthCheckResult } from "./health-check.js";
export { ChannelManager } from "./channel-manager.js";
export type { ChannelInfo } from "./channel-manager.js";

async function main(): Promise<void> {
  const port = parseInt(process.env.PORT || "3100", 10);
  const host = process.env.HOST || "0.0.0.0";

  console.log("[gateway] Bootstrapping...");
  const ctx = await bootstrap();

  // Channel Manager: unified lifecycle for all bot channels
  const channelManager = new ChannelManager(ctx);

  console.log("[gateway] Creating server...");
  const app = await createServer({ ctx, scheduler: ctx.scheduler, channelManager });

  // Start listening
  try {
    await app.listen({ port, host });
    console.log(`[gateway] Server listening on http://${host}:${port}`);
  } catch (err) {
    Sentry.captureException(err);
    console.error("[gateway] Failed to start server:", err);
    process.exit(1);
  }

  // Start all configured channels
  await channelManager.startAll();

  // Unified broadcast: send text to all active channels + WebSocket clients
  const broadcastAll = async (text: string) => {
    await channelManager.broadcast(text);
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
      console.log(`[scheduler] Reminder fired: "${task.action}"`);
      await broadcastAll(`⏰ 提醒：${task.action}`);
      return;
    }

    console.log(
      `[scheduler] Running task "${task.name}" through orchestrator...`,
    );
    try {
      const text = await collectResponse(ctx.orchestrator, task.action);
      await broadcastAll(text.trim() || `✅ 定时任务「${task.name}」已执行完成。`);
    } catch (err) {
      Sentry.captureException(err);
      const msg = `❌ 定时任务「${task.name}」执行失败: ${errorMessage(err)}`;
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

  // 每小时健康检查：检测服务状态变化并通知用户
  const healthJob = new Cron("0 * * * *", async () => {
    try {
      const changed = await ctx.refreshHealth();
      if (changed.length > 0) {
        const lines = changed.map(
          (r) => `${r.ok ? "✅" : "❌"} ${r.name}：${r.message}`,
        );
        const text = `[服务状态变化]\n${lines.join("\n")}`;
        console.log(`[health-check] ${text}`);
        await broadcastAll(text);
      } else {
        console.log("[health-check] 定时检查完成，无状态变化");
      }
    } catch (err) {
      console.error("[health-check] 定时检查失败:", errorMessage(err));
    }
  });

  // TaskManager: 捕获、分诊、执行、决策的统一任务管理
  const taskManager = new TaskManager(
    ctx.memoryStore,
    ctx.orchestrator,
    broadcastAll,
    { scanIntervalMs: 60_000, maxConcurrent: 1 },
  );
  // 挂载到 ctx 供 API 路由使用
  (ctx as unknown as Record<string, unknown>).taskManager = taskManager;
  taskManager.startScanner();

  // 优雅关停
  const shutdown = async (signal: string) => {
    console.log(`[shutdown] Received ${signal}, closing gracefully...`);

    // 超时保护：10 秒后强制退出
    const forceExit = setTimeout(() => {
      console.error("[shutdown] Force exit after timeout");
      process.exit(1);
    }, 10_000);
    forceExit.unref(); // 不阻止进程自然退出

    heartbeat.stop();
    healthJob.stop();
    taskManager.stopScanner();
    channelManager.stopAll();
    ctx.scheduler.stopAll();

    try {
      await app.close();
      console.log("[shutdown] Server closed");
    } catch (err) {
      console.error("[shutdown] Error during close:", err);
    }
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  Sentry.captureException(err);
  console.error("[gateway] Fatal error:", err);
  process.exit(1);
});
