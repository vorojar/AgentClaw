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
      Sentry.captureException(err);
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
      console.error(
        "[health-check] 定时检查失败:",
        err instanceof Error ? err.message : err,
      );
    }
  });

  // Task Runner: 扫描 Google Tasks，LLM 判断可执行性，自动执行
  let taskRunnerBusy = false;
  // 缓存已判断过的任务 ID → true=可执行 / false=跳过
  const taskDecisions = new Map<string, boolean>();
  const taskRunner = setInterval(async () => {
    if (taskRunnerBusy) return;
    taskRunnerBusy = true;
    try {
      const res = await runGws([
        "tasks", "tasks", "list",
        "--params", JSON.stringify({ tasklist: "@default", showCompleted: false, maxResults: 20 }),
      ]);
      if (!res.ok) {
        console.error("[task-runner] Google Tasks 获取失败:", res.error);
        return;
      }
      const data = res.data as { items?: { id: string; title: string; notes?: string; status: string }[] };
      const tasks = (data?.items || []).filter((t) => t.status === "needsAction");

      for (const task of tasks) {
        // 跳过已判断为不可执行的任务
        if (taskDecisions.get(task.id) === false) continue;

        // 首次遇到的任务：让 LLM 判断是否可执行
        if (!taskDecisions.has(task.id)) {
          console.log(`[task-runner] 判断任务可执行性: ${task.title}`);
          try {
            const session = await ctx.orchestrator.createSession();
            const judgePrompt = `你是一个任务执行判断器。判断以下任务是否是你（AI助手）可以通过工具（搜索、发邮件、写文件、调API等）自动执行的。
如果可以执行，回复"YES"。如果是需要人类亲自做的事（买东西、出门、运动等），回复"NO"。只回复YES或NO。

任务标题: ${task.title}${task.notes ? `\n任务备注: ${task.notes}` : ""}`;
            let answer = "";
            for await (const event of ctx.orchestrator.processInputStream(session.id, judgePrompt)) {
              if (event.type === "response_chunk") {
                answer += (event.data as { text: string }).text;
              }
            }
            const canExecute = answer.trim().toUpperCase().startsWith("YES");
            taskDecisions.set(task.id, canExecute);
            if (!canExecute) {
              console.log(`[task-runner] 跳过人类任务: ${task.title}`);
              continue;
            }
          } catch (err) {
            console.error(`[task-runner] 判断失败: ${task.title}`, err);
            continue;
          }
        }

        // 执行任务
        console.log(`[task-runner] 执行任务: ${task.title}`);
        try {
          const session = await ctx.orchestrator.createSession();
          const prompt = task.notes
            ? `${task.title}\n\n${task.notes}`
            : task.title;

          let result = "";
          for await (const event of ctx.orchestrator.processInputStream(session.id, prompt)) {
            if (event.type === "response_chunk") {
              result += (event.data as { text: string }).text;
            }
          }

          // 完成后标记 Google Tasks 为 completed
          await runGws([
            "tasks", "tasks", "patch",
            "--params", JSON.stringify({ tasklist: "@default", task: task.id }),
            "--json", JSON.stringify({ status: "completed" }),
          ]);
          taskDecisions.delete(task.id);

          const summary = result.trim().slice(0, 200) || "已完成";
          await broadcastAll(`✅ 任务「${task.title}」已完成：${summary}`);
          console.log(`[task-runner] ✅ 完成: ${task.title}`);
        } catch (err) {
          Sentry.captureException(err);
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[task-runner] ❌ 失败: ${task.title}`, msg);
          await broadcastAll(`❌ 任务「${task.title}」执行失败：${msg}`);
        }
      }
    } catch (err) {
      console.error("[task-runner] 扫描失败:", err);
    } finally {
      taskRunnerBusy = false;
    }
  }, 60_000); // 每 60 秒扫描一次

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
    clearInterval(taskRunner);
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
