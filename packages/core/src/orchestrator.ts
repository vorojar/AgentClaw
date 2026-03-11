import type {
  Orchestrator,
  Session,
  Message,
  ContentBlock,
  AgentEvent,
  ToolExecutionContext,
  LLMProvider,
  MemoryStore,
  AgentConfig,
  AgentProfile,
} from "@agentclaw/types";
import type { ToolRegistryImpl } from "@agentclaw/tools";
import type { SkillRegistryImpl } from "./skills/registry.js";
import { generateId } from "@agentclaw/providers";
import { SimpleAgentLoop, IterationBudget } from "./agent-loop.js";
import { SimpleContextManager } from "./context-manager.js";
import { MemoryExtractor } from "./memory-extractor.js";
import { SimpleSubAgentManager } from "./subagent-manager.js";
import { ToolHookManager } from "./tool-hooks.js";
import { readdirSync, unlinkSync } from "fs";
import { join } from "path";

/** How many user turns between automatic memory extraction runs */
const EXTRACT_EVERY_N_TURNS = 3;

export class SimpleOrchestrator implements Orchestrator {
  private sessions = new Map<string, Session>();
  private turnCounters = new Map<string, number>();
  private activeLoops = new Map<string, SimpleAgentLoop>();
  private provider: LLMProvider;
  private visionProvider?: LLMProvider;
  private fastProvider?: LLMProvider;
  private toolRegistry: ToolRegistryImpl;
  private memoryStore: MemoryStore;
  private memoryExtractor: MemoryExtractor;
  private agentConfig?: Partial<AgentConfig>;
  private systemPrompt?: string;
  private scheduler?: ToolExecutionContext["scheduler"];
  private skillRegistry?: SkillRegistryImpl;
  private tmpDir?: string;
  private agents: Map<string, AgentProfile>;

  constructor(options: {
    provider: LLMProvider;
    visionProvider?: LLMProvider;
    fastProvider?: LLMProvider;
    toolRegistry: ToolRegistryImpl;
    memoryStore: MemoryStore;
    agentConfig?: Partial<AgentConfig>;
    systemPrompt?: string;
    scheduler?: ToolExecutionContext["scheduler"];
    skillRegistry?: SkillRegistryImpl;
    tmpDir?: string;
    agents?: AgentProfile[];
  }) {
    this.provider = options.provider;
    this.visionProvider = options.visionProvider;
    this.fastProvider = options.fastProvider;
    this.toolRegistry = options.toolRegistry;
    this.memoryStore = options.memoryStore;
    this.memoryExtractor = new MemoryExtractor({
      provider: options.provider,
      memoryStore: options.memoryStore,
    });
    this.agentConfig = options.agentConfig;
    this.systemPrompt = options.systemPrompt;
    this.scheduler = options.scheduler;
    this.skillRegistry = options.skillRegistry;
    this.tmpDir = options.tmpDir;
    this.agents = new Map((options.agents ?? []).map((a) => [a.id, a]));
  }

  async createSession(metadata?: Record<string, unknown>): Promise<Session> {
    const session: Session = {
      id: generateId(),
      conversationId: generateId(),
      createdAt: new Date(),
      lastActiveAt: new Date(),
      metadata,
    };
    this.sessions.set(session.id, session);
    await this.memoryStore.saveSession(session);
    return session;
  }

  async getSession(sessionId: string): Promise<Session | undefined> {
    // 先查内存缓存
    let session = this.sessions.get(sessionId);
    if (session) return session;
    const stored = await this.memoryStore.getSessionById(sessionId);
    if (stored) {
      session = {
        id: stored.id,
        conversationId: stored.conversationId,
        createdAt: stored.createdAt,
        lastActiveAt: stored.lastActiveAt,
        title: stored.title,
        metadata: stored.metadata,
      };
      this.sessions.set(sessionId, session);
      return session;
    }
    return undefined;
  }

  async processInput(
    sessionId: string,
    input: string | ContentBlock[],
    context?: ToolExecutionContext,
  ): Promise<Message> {
    let lastMessage: Message | undefined;
    for await (const event of this.processInputStream(
      sessionId,
      input,
      context,
    )) {
      if (event.type === "response_complete") {
        lastMessage = (event.data as { message: Message }).message;
      }
    }
    if (!lastMessage) {
      throw new Error("No response generated");
    }
    return lastMessage;
  }

  async *processInputStream(
    sessionId: string,
    input: string | ContentBlock[],
    context?: ToolExecutionContext,
  ): AsyncIterable<AgentEvent> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.lastActiveAt = new Date();
    this.memoryStore.saveSession(session).catch(() => {});

    // Shared iteration budget: parent + sub-agents consume from the same pool
    const iterationBudget = new IterationBudget(
      this.agentConfig?.maxIterations ?? 25,
    );

    // Merge orchestrator-provided callbacks into the context
    const memoryStore = this.memoryStore;
    const mergedContext: ToolExecutionContext = {
      ...context,
      saveMemory: async (content, type) => {
        const memType = type ?? "fact";
        // Dedup: skip if a similar memory already exists
        const similar = await memoryStore.findSimilar(content, memType, 0.75);
        if (similar) {
          if (0.8 > similar.entry.importance) {
            await memoryStore.update(similar.entry.id, { importance: 0.8 });
          }
          return;
        }
        await memoryStore.add({
          type: memType,
          content,
          importance: 0.8,
        });
      },
      scheduler: this.scheduler,
      skillRegistry: this.skillRegistry,
      toolHooks: (() => {
        const hm = new ToolHookManager();
        hm.registerPresetHooks();
        return {
          before: (call: { name: string; input: Record<string, unknown> }) =>
            hm.runBeforeHooks(call),
          after: (
            call: { name: string; input: Record<string, unknown> },
            result: import("@agentclaw/types").ToolResult,
          ) => hm.runAfterHooks(call, result),
        };
      })(),
      subAgentManager: new SimpleSubAgentManager({
        provider: this.provider,
        toolRegistry: this.toolRegistry,
        memoryStore: this.memoryStore,
        agentConfig: this.agentConfig,
        skillRegistry: this.skillRegistry,
        parentContext: context,
        iterationBudget,
      }),
    };

    const inputHasImage = hasImage(input);
    let effectiveProvider: LLMProvider;

    if (inputHasImage && this.visionProvider) {
      effectiveProvider = this.visionProvider;
      console.log(
        `[orchestrator] Image detected → using ${effectiveProvider.name}`,
      );
    } else if (this.fastProvider && isSimpleChat(input)) {
      effectiveProvider = this.fastProvider;
      console.log(
        `[orchestrator] Simple chat → using fast provider ${effectiveProvider.name}`,
      );
    } else {
      effectiveProvider = this.provider;
    }

    let currentAgent = this.getSessionAgent(session);
    let handoffCount = 0;
    const MAX_HANDOFFS = 3;

    // Pass available agents to tools (for handoff validation)
    const agentRoster = Array.from(this.agents.values())
      .filter((a) => a.id !== "default")
      .map((a) => ({ id: a.id, name: a.name, description: a.description }));
    mergedContext.agents = agentRoster;

    let currentInput: string | ContentBlock[] = input;
    let isHandoffContinuation = false;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const loop = this.createAgentLoop(
        effectiveProvider,
        currentAgent,
        session.metadata,
        iterationBudget,
      );
      this.activeLoops.set(sessionId, loop);

      let handoffEvent: AgentEvent | null = null;
      try {
        for await (const event of loop.runStream(
          currentInput,
          session.conversationId,
          mergedContext,
        )) {
          if (event.type === "handoff") {
            handoffEvent = event;
            // Don't yield handoff to WS — we handle it internally and emit a notification
          } else {
            yield event;
          }
        }
      } finally {
        this.activeLoops.delete(sessionId);
      }

      // No handoff — normal completion
      if (!handoffEvent) {
        if (!isHandoffContinuation) {
          this.cleanupTmpScripts();
        }
        break;
      }

      // Handoff detected — switch agent and re-run
      handoffCount++;
      if (handoffCount > MAX_HANDOFFS) {
        yield {
          type: "error" as const,
          data: { message: "Too many handoffs (max 3). Stopping." },
          timestamp: new Date(),
        };
        break;
      }

      const handoffData = handoffEvent.data as {
        targetAgentId: string;
        reason: string;
        tokensIn?: number;
        tokensOut?: number;
        toolCallCount?: number;
        durationMs?: number;
        model?: string;
      };
      const targetAgentId = handoffData.targetAgentId;
      const targetAgent = this.agents.get(targetAgentId);

      if (!targetAgent) {
        yield {
          type: "error" as const,
          data: { message: `Handoff target "${targetAgentId}" not found` },
          timestamp: new Date(),
        };
        break;
      }

      // Update session metadata
      if (!session.metadata) session.metadata = {};
      const previousAgentId = (session.metadata.agentId as string) || "default";
      session.metadata.agentId = targetAgentId;
      await this.memoryStore.saveSession(session);

      // Notify frontend about the handoff
      yield {
        type: "handoff" as const,
        data: {
          fromAgent: previousAgentId,
          toAgent: targetAgentId,
          toAgentName: targetAgent.name,
          reason: handoffData.reason,
        },
        timestamp: new Date(),
      };

      console.log(
        `[orchestrator] Handoff: ${previousAgentId} → ${targetAgentId} (${handoffData.reason})`,
      );

      // Prepare for new agent loop
      currentAgent = targetAgent;
      isHandoffContinuation = true;
      const prevName =
        this.agents.get(previousAgentId)?.name ?? previousAgentId;
      currentInput = `[Handoff from ${prevName}: ${handoffData.reason}]\nReview the conversation history and continue. Respond directly to the user's request.`;
    }

    // Background memory extraction: on the 1st turn and every N turns after
    const count = (this.turnCounters.get(session.conversationId) ?? 0) + 1;
    this.turnCounters.set(session.conversationId, count);
    if (count === 1 || count % EXTRACT_EVERY_N_TURNS === 0) {
      this.memoryExtractor
        .processConversation(session.conversationId)
        .then((n) => {
          if (n > 0) console.log(`[memory] Extracted ${n} memories`);
        })
        .catch((err) => {
          console.error("[memory] Extraction failed:", err);
        });
    }

    if (count === 1 && session.title === undefined) {
      const rawText =
        typeof input === "string"
          ? input
          : input
              .filter(
                (b): b is { type: "text"; text: string } => b.type === "text",
              )
              .map((b) => b.text)
              .join("");
      session.title = rawText.slice(0, 50).trim() || "New Chat";
      this.memoryStore.saveSession(session).catch(() => {});
    }
  }

  async listSessions(): Promise<Session[]> {
    // 优先从 SQLite 获取完整列表
    try {
      const stored = await this.memoryStore.listSessions();
      if (stored.length > 0) return stored;
    } catch {}
    return Array.from(this.sessions.values());
  }

  /** Return IDs of sessions that have an active agent loop running */
  getActiveSessionIds(): string[] {
    return Array.from(this.activeLoops.keys());
  }

  stopSession(sessionId: string): boolean {
    const loop = this.activeLoops.get(sessionId);
    if (loop) {
      loop.stop();
      return true;
    }
    return false;
  }

  async closeSession(sessionId: string): Promise<void> {
    // Stop any running agent loop first (kills child processes like claude_code)
    this.stopSession(sessionId);
    this.sessions.delete(sessionId);
    await this.memoryStore.deleteSession(sessionId);
  }

  setModel(model: string): void {
    if (!this.agentConfig) this.agentConfig = {};
    this.agentConfig.model = model;
  }

  /** 更新系统提示词（用于健康检查等动态内容刷新） */
  updateSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  /** 更新 agent 配置（用于管理页面 CRUD 后刷新） */
  updateAgents(agentList: AgentProfile[]): void {
    this.agents = new Map(agentList.map((a) => [a.id, a]));
  }

  /**
   * Spawn an independent sub-agent with its own conversation context.
   * The sub-agent shares provider/tools but has isolated history.
   * delegateTask is NOT passed to prevent infinite recursion.
   */
  private async runSubAgent(
    task: string,
    parentContext?: ToolExecutionContext,
  ): Promise<string> {
    const subConvId = generateId();
    const subContext: ToolExecutionContext = {
      sendFile: parentContext?.sendFile,
      sentFiles: parentContext?.sentFiles,
      promptUser: parentContext?.promptUser,
      notifyUser: parentContext?.notifyUser,
      saveMemory: parentContext?.saveMemory,
      scheduler: this.scheduler,
      skillRegistry: this.skillRegistry,
      // No delegateTask — prevents recursion
    };

    const contextManager = new SimpleContextManager({
      systemPrompt:
        "You are a focused sub-agent. Complete the task concisely. No greetings, no explanations — just do it and report the result.",
      memoryStore: this.memoryStore,
      skillRegistry: this.skillRegistry,
      provider: this.fastProvider ?? this.provider,
    });

    const loop = new SimpleAgentLoop({
      provider: this.provider,
      toolRegistry: this.toolRegistry,
      contextManager,
      memoryStore: this.memoryStore,
      config: { ...this.agentConfig, maxIterations: 8 },
    });

    const message = await loop.run(task, subConvId, subContext);

    // Extract text from response
    if (typeof message.content === "string") return message.content;
    return (message.content as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text!)
      .join("\n");
  }

  /** Remove *.py temp scripts from tmpDir (fire-and-forget) */
  private cleanupTmpScripts(): void {
    if (!this.tmpDir) return;
    const tmpDir = this.tmpDir;
    try {
      const entries = readdirSync(tmpDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(tmpDir, entry.name);
        if (entry.isFile() && entry.name.endsWith(".py")) {
          try {
            unlinkSync(fullPath);
          } catch {}
        } else if (entry.isDirectory()) {
          try {
            const subFiles = readdirSync(fullPath);
            for (const f of subFiles) {
              if (f.endsWith(".py")) {
                try {
                  unlinkSync(join(fullPath, f));
                } catch {}
              }
            }
          } catch {}
        }
      }
    } catch {}
  }

  /** Resolve the agent profile for a session */
  private getSessionAgent(session: Session): AgentProfile | undefined {
    const agentId = session.metadata?.agentId as string | undefined;
    if (!agentId || agentId === "default") return undefined;
    return this.agents.get(agentId);
  }

  private createAgentLoop(
    provider?: LLMProvider,
    agent?: AgentProfile,
    sessionMetadata?: Record<string, unknown>,
    iterationBudget?: IterationBudget,
  ): SimpleAgentLoop {
    const effectiveProvider = provider ?? this.provider;

    // Resolve system prompt: inject agent's soul
    let systemPrompt = this.systemPrompt;
    const soul = agent?.soul ?? this.agents.get("default")?.soul ?? "";
    if (systemPrompt && systemPrompt.includes("{{soul}}")) {
      systemPrompt = systemPrompt.replace("{{soul}}", soul);
    } else if (soul && systemPrompt) {
      // No {{soul}} placeholder — prepend soul to system prompt
      systemPrompt = soul + "\n\n" + systemPrompt;
    }

    // Resolve platform hint for channel-specific formatting guidance
    if (systemPrompt) {
      const platformHint = (sessionMetadata?.platformHint as string) ?? "";
      systemPrompt = systemPrompt.replace("{{platformHint}}", platformHint);
      // Handle {{#if platformHint}}...{{/if}} conditional
      systemPrompt = systemPrompt.replace(
        /\{\{#if platformHint\}\}(.*?)\{\{\/if\}\}/gs,
        (_, content) => (platformHint ? content : ""),
      );
    }

    // Inject agent roster for handoff awareness (skip current agent)
    const currentId = agent?.id || "default";
    const roster = Array.from(this.agents.values())
      .filter((a) => a.id !== currentId && a.id !== "default")
      .map((a) => `- ${a.id}: ${a.name} — ${a.description}`)
      .join("\n");
    if (roster && systemPrompt) {
      systemPrompt += `\n\n## Handoff\nWhen the user's request is better suited for a specialist, use the \`handoff\` tool.\nAvailable agents:\n${roster}`;
    }

    const contextManager = new SimpleContextManager({
      systemPrompt,
      memoryStore: this.memoryStore,
      skillRegistry: this.skillRegistry,
      provider: this.fastProvider ?? this.provider,
    });

    // Agent-specific config overrides
    const config: Partial<AgentConfig> = { ...this.agentConfig };
    if (agent?.model) config.model = agent.model;
    if (agent?.maxIterations) config.maxIterations = agent.maxIterations;
    if (agent?.temperature !== undefined)
      config.temperature = agent.temperature;

    // Agent-specific tool filtering
    let toolRegistry = this.toolRegistry;
    if (agent?.tools) {
      const allowed = new Set(agent.tools);
      toolRegistry = this.toolRegistry.filter((t) => allowed.has(t.name));
    }

    return new SimpleAgentLoop({
      provider: effectiveProvider,
      toolRegistry,
      contextManager,
      memoryStore: this.memoryStore,
      config,
      iterationBudget,
    });
  }
}

/** Check whether the user input contains at least one image block */
function hasImage(input: string | ContentBlock[]): boolean {
  if (typeof input === "string") return false;
  return input.some((b) => b.type === "image");
}

/** Check if input is simple chat (short text, no file paths or code indicators) */
function isSimpleChat(input: string | ContentBlock[]): boolean {
  const text =
    typeof input === "string"
      ? input
      : input
          .filter((b): b is { type: "text"; text: string } => b.type === "text")
          .map((b) => b.text)
          .join("");
  // Short messages without technical indicators
  if (text.length > 200) return false;
  if (/[{}\[\]`]|https?:\/\/|data\/|\/[a-z]/i.test(text)) return false;
  // Task-oriented keywords → use main model
  if (
    /帮我|请你|生成|创建|写[一个]|编写|修改|删除|分析|搜索|下载|打开|发送|制作|设计|翻译|总结|convert|create|write|generate|analyze|search|download|send|make|build/i.test(
      text,
    )
  )
    return false;
  return true;
}
