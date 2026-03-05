import type {
  SubAgentManager,
  SubAgentInfo,
  SubAgentSpawnOptions,
  LLMProvider,
  MemoryStore,
  AgentConfig,
  ToolExecutionContext,
  Message,
} from "@agentclaw/types";
import { ToolRegistryImpl } from "@agentclaw/tools";
import type { SkillRegistryImpl } from "./skills/registry.js";
import { generateId } from "@agentclaw/providers";
import { SimpleAgentLoop } from "./agent-loop.js";
import { SimpleContextManager } from "./context-manager.js";

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

  constructor(options: {
    provider: LLMProvider;
    toolRegistry: ToolRegistryImpl;
    memoryStore: MemoryStore;
    agentConfig?: Partial<AgentConfig>;
    skillRegistry?: SkillRegistryImpl;
    parentContext?: ToolExecutionContext;
  }) {
    this.provider = options.provider;
    this.toolRegistry = options.toolRegistry;
    this.memoryStore = options.memoryStore;
    this.agentConfig = options.agentConfig;
    this.skillRegistry = options.skillRegistry;
    this.parentContext = options.parentContext;
  }

  spawn(goal: string, options?: SubAgentSpawnOptions): string {
    const id = generateId();
    const convId = generateId();
    const maxIterations = options?.maxIterations ?? 8;

    // Build tool registry — filter if allowedTools specified
    let toolRegistry = this.toolRegistry;
    if (options?.allowedTools && options.allowedTools.length > 0) {
      const allowed = new Set(options.allowedTools);
      const filtered = new ToolRegistryImpl();
      for (const tool of this.toolRegistry.list()) {
        if (allowed.has(tool.name)) {
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
    });

    const info: SubAgentInfo = {
      id,
      goal,
      status: "running",
      createdAt: new Date(),
    };

    const entry: SubAgentEntry = {
      info,
      loop,
      conversationId: convId,
      pendingInstructions: [],
    };

    this.agents.set(id, entry);

    // Run in background — fire and forget
    this.runAgent(entry).catch((err) => {
      console.error(`[subagent:${id}] Fatal error:`, err);
      entry.info.status = "failed";
      entry.info.error = err instanceof Error ? err.message : String(err);
      entry.info.completedAt = new Date();
    });

    return id;
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
    return true;
  }

  list(): SubAgentInfo[] {
    return Array.from(this.agents.values()).map((e) => e.info);
  }

  private async runAgent(entry: SubAgentEntry): Promise<void> {
    const subContext: ToolExecutionContext = {
      sendFile: this.parentContext?.sendFile,
      sentFiles: [],
      saveMemory: this.parentContext?.saveMemory,
      scheduler: this.parentContext?.scheduler,
      skillRegistry: this.parentContext?.skillRegistry
        ? this.parentContext.skillRegistry
        : undefined,
      // No subAgentManager — prevent sub-agent recursion
    };

    try {
      const message = await entry.loop.run(
        entry.info.goal,
        entry.conversationId,
        subContext,
      );
      entry.info.result = extractText(message);
      entry.info.status = "completed";
    } catch (err) {
      entry.info.error = err instanceof Error ? err.message : String(err);
      entry.info.status = "failed";
    }
    entry.info.completedAt = new Date();
  }
}

function extractText(message: Message): string {
  if (typeof message.content === "string") return message.content;
  return (message.content as Array<{ type: string; text?: string }>)
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!)
    .join("\n");
}
