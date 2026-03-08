import { Cron } from "croner";
import type { Orchestrator, MemoryStore, Message } from "@agentclaw/types";
import type { TaskScheduler, ScheduledTask } from "./scheduler.js";

export interface HeartbeatConfig {
  intervalMinutes: number;
  enabled: boolean;
}

export interface HeartbeatDeps {
  orchestrator: Orchestrator;
  scheduler: TaskScheduler;
  memoryStore: MemoryStore;
  broadcast: (text: string) => Promise<void>;
}

export class HeartbeatManager {
  private config: HeartbeatConfig;
  private deps: HeartbeatDeps;
  private job: Cron | null = null;

  constructor(config: HeartbeatConfig, deps: HeartbeatDeps) {
    this.config = config;
    this.deps = deps;
  }

  start(): void {
    if (!this.config.enabled) {
      console.log("[heartbeat] Disabled, skipping.");
      return;
    }

    const cronExpr = `*/${this.config.intervalMinutes} * * * *`;
    console.log(
      `[heartbeat] Starting with interval ${this.config.intervalMinutes}m (cron: ${cronExpr})`,
    );

    this.job = new Cron(cronExpr, () => {
      this.tick().catch((err) => {
        console.error("[heartbeat] Tick error:", err);
      });
    });
  }

  stop(): void {
    if (this.job) {
      this.job.stop();
      this.job = null;
      console.log("[heartbeat] Stopped.");
    }
  }

  async tick(): Promise<void> {
    // 1. 检查待决策任务，直接广播（不过 LLM，省 token）
    await this.checkDecisions();

    // 2. 定时任务 + 记忆提醒（走 LLM）
    const { shouldCall, tasks, memories } = await this.shouldCallLLM();

    if (!shouldCall) {
      console.log("[heartbeat] Tick skipped (nothing to do)");
      return;
    }

    console.log(
      `[heartbeat] Tick: ${tasks.length} scheduled task(s), ${memories.length} memory item(s) — calling LLM`,
    );

    // Build summary of pending items
    const tasksSummary = tasks
      .map(
        (t) =>
          `- [定时任务] "${t.name}" (cron: ${t.cron}, action: ${t.action})${t.nextRunAt ? ` 下次执行: ${t.nextRunAt.toLocaleString("zh-CN")}` : ""}`,
      )
      .join("\n");

    const memoriesSummary = memories
      .map((m) => `- [记忆] ${m.content}`)
      .join("\n");

    const now = new Date().toLocaleString("zh-CN", {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "long",
      hour12: false,
    });

    const prompt = `现在是 ${now}。你是一个后台守护进程。
检查以下待办事项，决定是否需要执行或提醒用户。
如果无事可做，只回复 "[无事可报]"。

待办事项：
${tasksSummary}${memoriesSummary ? "\n" + memoriesSummary : ""}`;

    try {
      const session = await this.deps.orchestrator.createSession();
      let text = "";
      let tokensIn = 0;
      let tokensOut = 0;
      let model = "";

      for await (const event of this.deps.orchestrator.processInputStream(
        session.id,
        prompt,
      )) {
        if (event.type === "response_chunk") {
          text += (event.data as { text: string }).text;
        } else if (event.type === "response_complete") {
          const msg = (event.data as { message: Message }).message;
          tokensIn = msg.tokensIn ?? 0;
          tokensOut = msg.tokensOut ?? 0;
          model = msg.model ?? "";
        }
      }

      text = text.trim();

      const usage = `${tokensIn} in / ${tokensOut} out${model ? ` (${model})` : ""}`;

      if (!text || text.includes("[无事可报]")) {
        console.log(`[heartbeat] LLM says nothing to report. Tokens: ${usage}`);
        return;
      }

      console.log(`[heartbeat] Broadcasting response... Tokens: ${usage}`);
      await this.deps.broadcast(text);
    } catch (err) {
      console.error("[heartbeat] LLM call failed:", err);
    }
  }

  /** 检查 waiting_decision 状态的任务，有则直接广播提醒 */
  private async checkDecisions(): Promise<void> {
    try {
      const store = this.deps.memoryStore as any;
      if (!store.listTasks) return;
      const { items } = store.listTasks({ status: "waiting_decision" }, 10);
      if (items.length === 0) return;

      const taskList = items.map((t: any) => `  - ${t.title}`).join("\n");
      const text = `⏳ 你有 ${items.length} 个任务等待决策：\n${taskList}\n\n请在 Tasks 页面的 Decisions 标签中处理。`;

      console.log(
        `[heartbeat] ${items.length} task(s) waiting for decision, broadcasting reminder`,
      );
      await this.deps.broadcast(text);
    } catch (err) {
      console.error("[heartbeat] Decision check failed:", err);
    }
  }

  private async shouldCallLLM(): Promise<{
    shouldCall: boolean;
    tasks: ScheduledTask[];
    memories: Array<{ content: string }>;
  }> {
    // Check scheduled tasks (exclude heartbeat's own tasks)
    const allTasks = this.deps.scheduler.list();
    const enabledTasks = allTasks.filter((t) => t.enabled);

    // Check memory store for reminders / important episodic memories
    let memories: Array<{ content: string }> = [];
    try {
      const results = await this.deps.memoryStore.search({
        query: "提醒 reminder todo 待办",
        type: "episodic",
        limit: 10,
        minImportance: 0.7,
      });
      memories = results.map((r) => ({ content: r.entry.content }));
    } catch {
      // memoryStore.search might fail if no embeddings — that's fine
    }

    return {
      shouldCall: enabledTasks.length > 0 || memories.length > 0,
      tasks: enabledTasks,
      memories,
    };
  }
}
