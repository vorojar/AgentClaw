import type {
  SubAgentManager,
  SubAgentInfo,
  SubAgentSpawnOptions,
  SubAgentTaskResult,
  SubAgentProgressCallback,
  LLMProvider,
  MemoryStore,
  AgentConfig,
  ToolExecutionContext,
  Message,
} from "@agentclaw/types";
import { ToolRegistryImpl } from "@agentclaw/tools";
import type { SkillRegistryImpl } from "./skills/registry.js";
import { generateId } from "@agentclaw/providers";
import { IterationBudget, SimpleAgentLoop } from "./agent-loop.js";
import { SimpleContextManager } from "./context-manager.js";

/** Tools that sub-agents must never have access to */
const SUBAGENT_BLOCKED_TOOLS = new Set([
  "subagent", // 防止递归委托
  "ask_user", // 子代理无法与用户交互，会永远挂起
  "remember", // 防止污染共享长期记忆
  "schedule", // 防止创建定时任务等副作用
  "send_file", // 防止跨渠道副作用
]);

interface SubAgentEntry {
  info: SubAgentInfo;
  loop: SimpleAgentLoop;
  conversationId: string;
  /** Queued instructions to append before next LLM turn */
  pendingInstructions: string[];
}

/**
 * Manages spawned sub-agents with independent agent-loop instances.
 * Sub-agents run in the background and can be polled for results.
 */
export class SimpleSubAgentManager implements SubAgentManager {
  private agents = new Map<string, SubAgentEntry>();
  private provider: LLMProvider;
  private toolRegistry: ToolRegistryImpl;
  private memoryStore: MemoryStore;
  private agentConfig?: Partial<AgentConfig>;
  private skillRegistry?: SkillRegistryImpl;
  private parentContext?: ToolExecutionContext;
  private iterationBudget?: IterationBudget;

  constructor(options: {
    provider: LLMProvider;
    toolRegistry: ToolRegistryImpl;
    memoryStore: MemoryStore;
    agentConfig?: Partial<AgentConfig>;
    skillRegistry?: SkillRegistryImpl;
    parentContext?: ToolExecutionContext;
    iterationBudget?: IterationBudget;
  }) {
    this.provider = options.provider;
    this.toolRegistry = options.toolRegistry;
    this.memoryStore = options.memoryStore;
    this.agentConfig = options.agentConfig;
    this.skillRegistry = options.skillRegistry;
    this.parentContext = options.parentContext;
    this.iterationBudget = options.iterationBudget;
  }

  private createEntry(
    goal: string,
    options?: SubAgentSpawnOptions,
  ): SubAgentEntry {
    const id = generateId();
    const convId = generateId();
    const maxIterations =
      options?.maxIterations ??
      Math.min(this.agentConfig?.maxIterations ?? 15, 15);

    // Build tool registry — filter if allowedTools specified, always strip blocked tools
    let toolRegistry: ToolRegistryImpl;
    if (options?.allowedTools && options.allowedTools.length > 0) {
      const allowed = new Set(options.allowedTools);
      const filtered = new ToolRegistryImpl();
      for (const tool of this.toolRegistry.list()) {
        if (allowed.has(tool.name) && !SUBAGENT_BLOCKED_TOOLS.has(tool.name)) {
          filtered.register(tool);
        }
      }
      toolRegistry = filtered;
    } else {
      // No allowlist — use all tools except blocked ones
      const filtered = new ToolRegistryImpl();
      for (const tool of this.toolRegistry.list()) {
        if (!SUBAGENT_BLOCKED_TOOLS.has(tool.name)) {
          filtered.register(tool);
        }
      }
      toolRegistry = filtered;
    }

    const isExplore = options?.allowedTools && options.allowedTools.length > 0;
    const contextManager = new SimpleContextManager({
      systemPrompt: isExplore
        ? "You are a read-only explore agent. Search and read files to answer questions. " +
          "You CANNOT modify files. Report findings concisely."
        : "You are a focused sub-agent. Complete the assigned task concisely. " +
          "No greetings, no unnecessary explanations — just do it and report the result.",
      memoryStore: this.memoryStore,
      skillRegistry: this.skillRegistry,
      provider: this.provider,
    });

    const loop = new SimpleAgentLoop({
      provider: this.provider,
      toolRegistry,
      contextManager,
      memoryStore: this.memoryStore,
      config: {
        ...this.agentConfig,
        maxIterations,
        model: options?.model ?? this.agentConfig?.model,
      },
      iterationBudget: new IterationBudget(
        this.iterationBudget?.exhausted ? 0 : maxIterations,
      ),
    });

    return {
      info: { id, goal, status: "running", createdAt: new Date() },
      loop,
      conversationId: convId,
      pendingInstructions: [],
    };
  }

  spawn(goal: string, options?: SubAgentSpawnOptions): string {
    const entry = this.createEntry(goal, options);
    this.agents.set(entry.info.id, entry);

    // Persist to database
    this.memoryStore.addSubAgent({
      id: entry.info.id,
      goal,
      model: options?.model ?? this.agentConfig?.model,
    });

    // Run in background — fire and forget
    this.runAgent(entry).catch((err) => {
      console.error(`[subagent:${entry.info.id}] Fatal error:`, err);
      entry.info.status = "failed";
      entry.info.error = err instanceof Error ? err.message : String(err);
      entry.info.completedAt = new Date();
      this.memoryStore.updateSubAgent(entry.info.id, {
        status: "failed",
        error: entry.info.error,
        completedAt: new Date().toISOString(),
      });
    });

    return entry.info.id;
  }

  async spawnAndWait(
    goals: string[],
    options?: SubAgentSpawnOptions,
    onProgress?: SubAgentProgressCallback,
  ): Promise<SubAgentTaskResult[]> {
    const concurrency = Math.max(1, options?.concurrency ?? 3);
    const results: SubAgentTaskResult[] = new Array(goals.length);

    // Prepare all entries upfront
    const entries = goals.map((goal, i) => {
      const entry = this.createEntry(goal, options);
      this.agents.set(entry.info.id, entry);
      this.memoryStore.addSubAgent({
        id: entry.info.id,
        goal,
        model: options?.model ?? this.agentConfig?.model,
      });
      return { entry, index: i, goal };
    });

    // Run with concurrency control + cross-feed results
    let next = 0;
    const runNext = async (): Promise<void> => {
      while (next < entries.length) {
        const current = next++;
        const { entry, index, goal } = entries[current];
        onProgress?.(index, goals.length, goal, "running");

        await this.runAgent(entry);

        results[index] = {
          goal,
          status: entry.info.status,
          result: entry.info.result,
          error: entry.info.error,
        };
        onProgress?.(
          index,
          goals.length,
          goal,
          entry.info.status,
          entry.info.result,
        );

        // Cross-feed: steer still-running siblings with this result
        if (entry.info.result && entries.length > 1) {
          const summary = `[Sibling agent completed] Task: ${goal}\nResult: ${entry.info.result.slice(0, 500)}`;
          for (const other of entries) {
            if (other.entry.info.status === "running") {
              other.entry.pendingInstructions.push(summary);
            }
          }
        }
      }
    };

    // Launch N workers
    const workers = Array.from(
      { length: Math.min(concurrency, goals.length) },
      () => runNext(),
    );
    await Promise.all(workers);

    return results;
  }

  async steer(id: string, instruction: string): Promise<void> {
    const entry = this.agents.get(id);
    if (!entry) throw new Error(`Sub-agent not found: ${id}`);
    if (entry.info.status !== "running") {
      throw new Error(
        `Sub-agent ${id} is not running (status: ${entry.info.status})`,
      );
    }
    entry.pendingInstructions.push(instruction);
  }

  getResult(id: string): SubAgentInfo | undefined {
    return this.agents.get(id)?.info;
  }

  kill(id: string): boolean {
    const entry = this.agents.get(id);
    if (!entry || entry.info.status !== "running") return false;
    entry.loop.stop();
    entry.info.status = "killed";
    entry.info.completedAt = new Date();
    this.memoryStore.updateSubAgent(id, {
      status: "killed",
      completedAt: new Date().toISOString(),
    });
    return true;
  }

  list(): SubAgentInfo[] {
    return Array.from(this.agents.values()).map((e) => e.info);
  }

  private async runAgent(entry: SubAgentEntry): Promise<void> {
    const backgroundQueue: ToolExecutionContext["backgroundQueue"] = [];

    const subContext: ToolExecutionContext = {
      sendFile: undefined,
      sentFiles: [],
      saveMemory: undefined,
      scheduler: this.parentContext?.scheduler,
      skillRegistry: this.parentContext?.skillRegistry,
      backgroundQueue,
      // No subAgentManager — prevent sub-agent recursion
    };

    const toolsUsed = new Set<string>();
    let lastMessage: Message | undefined;
    let iterations = 0;

    try {
      for await (const event of entry.loop.runStream(
        entry.info.goal,
        entry.conversationId,
        subContext,
      )) {
        if (event.type === "tool_call") {
          const data = event.data as { name: string };
          toolsUsed.add(data.name);
        } else if (event.type === "response_complete") {
          lastMessage = (event.data as { message: Message }).message;
        } else if (event.type === "thinking") {
          const data = event.data as { iteration?: number };
          if (data.iteration) iterations = data.iteration;

          // Drain pending steer instructions into backgroundQueue
          // so agent-loop picks them up as runtime hints
          while (entry.pendingInstructions.length > 0) {
            const instruction = entry.pendingInstructions.shift()!;
            backgroundQueue.push({
              id: `steer-${Date.now()}`,
              command: "[steer from sibling agent]",
              content: instruction,
              isError: false,
              completedAt: new Date(),
            });
          }
        }
      }

      const text = lastMessage
        ? extractText(lastMessage)
        : "No response generated.";
      entry.info.result = text;
      entry.info.status = "completed";
      entry.info.completedAt = new Date();

      this.memoryStore.updateSubAgent(entry.info.id, {
        status: "completed",
        result: text,
        tokensIn: lastMessage?.tokensIn ?? 0,
        tokensOut: lastMessage?.tokensOut ?? 0,
        toolsUsed: Array.from(toolsUsed),
        iterations,
        completedAt: new Date().toISOString(),
      });
    } catch (err) {
      entry.info.error = err instanceof Error ? err.message : String(err);
      entry.info.status = "failed";
      entry.info.completedAt = new Date();

      this.memoryStore.updateSubAgent(entry.info.id, {
        status: "failed",
        error: entry.info.error,
        tokensIn: lastMessage?.tokensIn ?? 0,
        tokensOut: lastMessage?.tokensOut ?? 0,
        toolsUsed: Array.from(toolsUsed),
        iterations,
        completedAt: new Date().toISOString(),
      });
    }
  }
}

/** Max chars for sub-agent result — enough detail for complex findings without flooding parent context */
const SUBAGENT_RESULT_MAX_CHARS = 6000;

function extractText(message: Message): string {
  let text: string;
  if (typeof message.content === "string") {
    text = message.content;
  } else {
    text = (message.content as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text!)
      .join("\n");
  }
  if (text.length <= SUBAGENT_RESULT_MAX_CHARS) return text;
  // Keep first and last portions for best context
  const half = Math.floor(SUBAGENT_RESULT_MAX_CHARS / 2) - 20;
  return (
    text.slice(0, half) +
    `\n\n... [truncated ${text.length - SUBAGENT_RESULT_MAX_CHARS} chars] ...\n\n` +
    text.slice(-half)
  );
}
