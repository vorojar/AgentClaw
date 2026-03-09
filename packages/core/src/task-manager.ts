import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

// ─── Duck-typed 接口，避免直接依赖 @agentclaw/memory ───

interface TaskStore {
  addTask(task: any): void;
  getTask(id: string): any | null;
  updateTask(id: string, updates: any): boolean;
  listTasks(
    filters?: any,
    limit?: number,
    offset?: number,
  ): { items: any[]; total: number };
  getTaskStats(): any;
}

interface TaskOrchestrator {
  createSession(metadata?: Record<string, unknown>): Promise<{ id: string }>;
  processInputStream(
    sessionId: string,
    input: string | any[],
    context: any,
  ): AsyncIterable<{ type: string; data?: any }>;
}

export interface TaskManagerConfig {
  /** 扫描间隔，单位毫秒，默认 60000 */
  scanIntervalMs?: number;
  /** 最大并发执行数，默认 1 */
  maxConcurrent?: number;
  /** 自动分诊：captureTask 时若 executor=agent 则直接入队，默认 true */
  autoTriage?: boolean;
}

/** captureTask 中 LLM 返回的结构化解析结果 */
interface ParsedTask {
  title: string;
  description?: string;
  deadline?: string;
  priority?: "urgent" | "high" | "normal" | "low";
  executor?: "agent" | "human";
}

export class TaskManager {
  private store: TaskStore;
  private orchestrator: TaskOrchestrator;
  private broadcast: (text: string) => Promise<void>;
  private config: Required<TaskManagerConfig>;
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private running = 0;

  constructor(
    store: TaskStore,
    orchestrator: TaskOrchestrator,
    broadcast: (text: string) => Promise<void>,
    config?: TaskManagerConfig,
  ) {
    this.store = store;
    this.orchestrator = orchestrator;
    this.broadcast = broadcast;
    this.config = {
      scanIntervalMs: config?.scanIntervalMs ?? 60_000,
      maxConcurrent: config?.maxConcurrent ?? 1,
      autoTriage: config?.autoTriage ?? true,
    };
  }

  // ─── 1. 捕获 —— 从自然语言创建任务 ───

  async captureTask(text: string, source: string): Promise<any> {
    const parsed = await this.parseWithLLM(text);

    const id = randomUUID();
    const isAgent = parsed.executor === "agent";
    // autoTriage 且 executor=agent → 直接入队；否则保持 todo
    const status =
      this.config.autoTriage && isAgent ? "queued" : "todo";

    this.store.addTask({
      id,
      title: parsed.title,
      description: parsed.description ?? "",
      status,
      priority: parsed.priority ?? "medium",
      dueDate: parsed.deadline ?? null,
      assignee: isAgent ? "agent" : "human",
      createdBy: source,
      executor: parsed.executor ?? "human",
      source,
    });

    if (parsed.deadline) {
      this.store.updateTask(id, { deadline: parsed.deadline });
    }

    return this.store.getTask(id);
  }

  // ─── 2. 分诊 —— 判断任务由谁执行 ───

  async triageTask(taskId: string): Promise<void> {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error(`任务不存在: ${taskId}`);

    const session = await this.orchestrator.createSession({
      purpose: "triage",
    });

    const prompt = [
      "判断以下任务是否可以由 AI Agent 自主完成（无需人类介入）。",
      "只返回一个 JSON 对象，格式：{\"executor\": \"agent\" | \"human\" | \"uncertain\"}",
      "",
      `任务标题：${task.title}`,
      `任务描述：${task.description || "无"}`,
    ].join("\n");

    let responseText = "";
    for await (const event of this.orchestrator.processInputStream(
      session.id,
      prompt,
      {},
    )) {
      if (event.type === "response_complete") {
        responseText = extractText(event.data);
      }
    }

    const decision = safeParseJSON(responseText);
    const executor = decision?.executor ?? "human";

    if (executor === "agent") {
      this.store.updateTask(taskId, { executor: "agent", status: "queued" });
    } else if (executor === "uncertain") {
      this.store.updateTask(taskId, {
        executor: "unknown",
        status: "waiting_decision",
      });
    } else {
      // human 或其他 → 保持 todo
      this.store.updateTask(taskId, { executor: "human", status: "todo" });
    }
  }

  // ─── 3. 执行队列处理 ───

  async processQueue(): Promise<void> {
    if (this.running >= this.config.maxConcurrent) return;

    // 取 status=queued 的任务，按 priority 排序（urgent > high > normal > low）
    const { items } = this.store.listTasks({ status: "queued" }, 50);

    // 按 priority 权重排序
    const priorityWeight: Record<string, number> = {
      urgent: 0,
      high: 1,
      normal: 2,
      medium: 2,
      low: 3,
    };
    items.sort(
      (a: any, b: any) =>
        (priorityWeight[a.priority] ?? 1) - (priorityWeight[b.priority] ?? 1),
    );

    for (const task of items) {
      if (this.running >= this.config.maxConcurrent) break;
      // 仅执行 executor=agent 的任务
      if (task.executor !== "agent" && task.assignee !== "agent") continue;

      // fire-and-forget，但追踪并发数
      this.executeTask(task.id).catch((err) => {
        console.error(`[task-manager] 执行任务 ${task.id} 失败:`, err);
      });
    }
  }

  // ─── 4. 执行单个任务 ───

  async executeTask(taskId: string): Promise<void> {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error(`任务不存在: ${taskId}`);

    // 标记为执行中
    this.store.updateTask(taskId, { status: "running", progress: 0 });
    this.running++;

    try {
      const session = await this.orchestrator.createSession({
        purpose: "task-execution",
        taskId,
      });

      // 将 sessionId 关联到任务
      this.store.updateTask(taskId, { sessionId: session.id });

      const workDir = resolve(process.cwd(), "data", "tmp");
      const prompt = [
        "请执行以下任务，完成后给出简洁的结果总结。",
        "",
        `任务：${task.title}`,
        task.description ? `详情：${task.description}` : "",
        "",
        `[工作目录：${workDir}]`,
      ]
        .filter(Boolean)
        .join("\n");

      let resultText = "";
      for await (const event of this.orchestrator.processInputStream(
        session.id,
        prompt,
        {},
      )) {
        if (event.type === "response_complete") {
          resultText = extractText(event.data);
        }
      }

      // 执行成功
      this.store.updateTask(taskId, {
        status: "done",
        progress: 100,
        result: resultText || "已完成",
        completedAt: new Date().toISOString(),
      });

      await this.broadcast(
        `✅ 任务完成：${task.title}\n结果：${(resultText || "已完成").slice(0, 200)}`,
      ).catch(() => {});
    } catch (err: any) {
      // 执行失败
      const errMsg = err?.message ?? String(err);
      this.store.updateTask(taskId, {
        status: "failed",
        result: `执行失败: ${errMsg}`,
        progress: 0,
      });

      await this.broadcast(
        `❌ 任务失败：${task.title}\n错误：${errMsg.slice(0, 200)}`,
      ).catch(() => {});
    } finally {
      this.running--;
    }
  }

  // ─── 5. 请求决策 ───

  async requestDecision(
    taskId: string,
    context: string,
    options: string[],
  ): Promise<void> {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error(`任务不存在: ${taskId}`);

    this.store.updateTask(taskId, {
      status: "waiting_decision",
      decisionContext: context,
      decisionOptions: options,
    });

    const optionList = options.map((o, i) => `${i + 1}. ${o}`).join("\n");
    await this.broadcast(
      `🤔 任务「${task.title}」需要你的决策：\n${context}\n\n选项：\n${optionList}`,
    ).catch(() => {});
  }

  // ─── 6. 处理决策结果 ───

  async resolveDecision(taskId: string, decision: string): Promise<void> {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error(`任务不存在: ${taskId}`);

    this.store.updateTask(taskId, { decisionResult: decision });

    // 判断是否需要继续执行：如果任务之前是 agent 类型，则重新入队
    const executor = task.executor ?? task.assignee ?? "human";
    if (executor === "agent") {
      this.store.updateTask(taskId, { status: "queued" });
    } else {
      this.store.updateTask(taskId, {
        status: "done",
        completedAt: new Date().toISOString(),
      });
    }
  }

  // ─── 7. 生成每日简报 ───

  async generateDailyBrief(): Promise<string> {
    const stats = this.store.getTaskStats();
    const today = new Date().toISOString().slice(0, 10);

    // 获取各状态的任务列表
    const done = this.store.listTasks({ status: "done" }, 20);
    const queued = this.store.listTasks({ status: "queued" }, 20);
    const running = this.store.listTasks({ status: "running" }, 10);
    const waiting = this.store.listTasks({ status: "waiting_decision" }, 10);
    const todo = this.store.listTasks({ status: "todo" }, 20);

    // 昨日完成：筛选 completed_at 为昨日的
    const yesterday = new Date(Date.now() - 86_400_000)
      .toISOString()
      .slice(0, 10);
    const completedYesterday = done.items.filter(
      (t: any) => t.completed_at && t.completed_at.startsWith(yesterday),
    );

    const lines: string[] = [
      `📋 每日任务简报 — ${today}`,
      "",
      `📊 总览：待处理 ${stats.total_pending ?? 0} 项 | 今日完成 ${stats.done_today ?? 0} 项`,
    ];

    if (completedYesterday.length > 0) {
      lines.push("", "✅ 昨日完成：");
      for (const t of completedYesterday) {
        lines.push(`  - ${t.title}`);
      }
    }

    if (running.items.length > 0) {
      lines.push("", "🔄 进行中：");
      for (const t of running.items) {
        lines.push(`  - ${t.title} (进度 ${t.progress ?? 0}%)`);
      }
    }

    if (queued.items.length > 0) {
      lines.push("", "📥 待执行队列：");
      for (const t of queued.items) {
        lines.push(`  - [${t.priority}] ${t.title}`);
      }
    }

    if (todo.items.length > 0) {
      lines.push("", "📝 待办（人工）：");
      for (const t of todo.items) {
        const due = t.due_date || t.deadline;
        lines.push(`  - ${t.title}${due ? ` (截止: ${due})` : ""}`);
      }
    }

    if (waiting.items.length > 0) {
      lines.push("", "⏳ 等待决策：");
      for (const t of waiting.items) {
        lines.push(`  - ${t.title}`);
      }
    }

    if (
      completedYesterday.length === 0 &&
      running.items.length === 0 &&
      queued.items.length === 0 &&
      todo.items.length === 0 &&
      waiting.items.length === 0
    ) {
      lines.push("", "暂无待处理任务。");
    }

    return lines.join("\n");
  }

  // ─── 8. 扫描器 ───

  startScanner(): void {
    if (this.scanTimer) return; // 防止重复启动
    console.log(
      `[task-manager] 扫描器已启动，间隔 ${this.config.scanIntervalMs}ms`,
    );
    this.scanTimer = setInterval(() => {
      this.processQueue().catch((err) => {
        console.error("[task-manager] 队列处理失败:", err);
      });
    }, this.config.scanIntervalMs);
  }

  stopScanner(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
      console.log("[task-manager] 扫描器已停止");
    }
  }

  // ─── 内部方法 ───

  /** 用 LLM 解析自然语言任务描述 */
  private async parseWithLLM(text: string): Promise<ParsedTask> {
    const session = await this.orchestrator.createSession({
      purpose: "task-parse",
    });

    const prompt = [
      "从以下用户消息中提取任务信息，只返回 JSON，不要其他内容。",
      "JSON 格式：",
      '{',
      '  "title": "简洁的任务标题",',
      '  "description": "详细描述（可选）",',
      '  "deadline": "ISO 日期字符串（如有提及时间，否则 null）",',
      '  "priority": "urgent / high / normal / low",',
      '  "executor": "agent（AI 可独立完成的）/ human（需要人类操作的）"',
      '}',
      "",
      "判断规则：",
      "- 涉及编程、搜索、数据分析、文件处理 → agent",
      "- 涉及物理操作、购买、线下活动、主观决策 → human",
      "- 没有提到截止时间 → deadline 为 null",
      "",
      `用户消息：${text}`,
    ].join("\n");

    let responseText = "";
    for await (const event of this.orchestrator.processInputStream(
      session.id,
      prompt,
      {},
    )) {
      if (event.type === "response_complete") {
        responseText = extractText(event.data);
      }
    }

    const parsed = safeParseJSON(responseText);
    if (parsed?.title) return parsed as ParsedTask;

    // LLM 解析失败时的兜底：直接用原文作为标题
    return {
      title: text.slice(0, 100).trim(),
      priority: "normal",
      executor: "human",
    };
  }
}

// ─── 工具函数 ───

/** 从 response_complete 事件的 data 中提取文本 */
function extractText(data: any): string {
  if (!data) return "";
  const message = data.message ?? data;
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .filter((b: any) => b.type === "text" && b.text)
      .map((b: any) => b.text)
      .join("\n");
  }
  // 兜底：尝试把 data 当字符串
  return typeof data === "string" ? data : "";
}

/** 安全解析 JSON，从文本中提取第一个 JSON 对象 */
function safeParseJSON(text: string): any | null {
  if (!text) return null;
  // 尝试直接解析
  try {
    return JSON.parse(text);
  } catch {}
  // 尝试从 markdown 代码块中提取
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) {
    try {
      return JSON.parse(match[1].trim());
    } catch {}
  }
  // 尝试匹配第一个 { ... } 块
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0]);
    } catch {}
  }
  return null;
}
