import type {
  AgentLoop,
  AgentState,
  AgentConfig,
  AgentEvent,
  AgentEventListener,
  AgentEventType,
  Message,
  ContentBlock,
  ToolUseContent,
  ToolResultContent,
  ToolExecutionContext,
  LLMProvider,
  LLMStreamChunk,
  ContextManager,
  MemoryStore,
  ConversationTurn,
  ToolDefinition,
} from "@agentclaw/types";
import type { ToolRegistryImpl } from "@agentclaw/tools";
import { generateId } from "@agentclaw/providers";

const DEFAULT_CONFIG: AgentConfig = {
  maxIterations: 10,
  systemPrompt: "",
  streaming: false,
  temperature: 0.7,
  maxTokens: 4096,
};

/** Tools that are safe to retry on failure (network-dependent tools) */
const RETRYABLE_TOOLS = new Set([
  "comfyui",
  "http_request",
  "web_search",
  "web_fetch",
]);

const MAX_RETRIES = 2;
const RETRY_BASE_DELAY = 2000; // ms

export class SimpleAgentLoop implements AgentLoop {
  private _state: AgentState = "idle";
  private _config: AgentConfig;
  private provider: LLMProvider;
  private toolRegistry: ToolRegistryImpl;
  private contextManager: ContextManager;
  private memoryStore: MemoryStore;
  private listeners: Set<AgentEventListener> = new Set();
  private aborted = false;

  get state(): AgentState {
    return this._state;
  }

  get config(): AgentConfig {
    return this._config;
  }

  constructor(options: {
    provider: LLMProvider;
    toolRegistry: ToolRegistryImpl;
    contextManager: ContextManager;
    memoryStore: MemoryStore;
    config?: Partial<AgentConfig>;
  }) {
    this.provider = options.provider;
    this.toolRegistry = options.toolRegistry;
    this.contextManager = options.contextManager;
    this.memoryStore = options.memoryStore;
    this._config = { ...DEFAULT_CONFIG, ...options.config };
  }

  async run(
    input: string | ContentBlock[],
    conversationId?: string,
    context?: ToolExecutionContext,
  ): Promise<Message> {
    let lastMessage: Message | undefined;
    for await (const event of this.runStream(input, conversationId, context)) {
      if (event.type === "response_complete") {
        lastMessage = (event.data as { message: Message }).message;
      }
    }
    return (
      lastMessage ?? {
        id: generateId(),
        role: "assistant",
        content: "No response generated.",
        createdAt: new Date(),
      }
    );
  }

  async *runStream(
    input: string | ContentBlock[],
    conversationId?: string,
    context?: ToolExecutionContext,
  ): AsyncIterable<AgentEvent> {
    this.aborted = false;
    const convId = conversationId ?? generateId();
    const startTime = Date.now();

    // Accumulators across all LLM iterations
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let totalToolCalls = 0;
    let usedModel: string | undefined;
    // Accumulate files sent by tools (for persistence)
    const allSentFiles: Array<{ url: string; filename: string }> = [];

    // 存储用户消息：ContentBlock[] 需序列化为 JSON 字符串
    const userTurn: ConversationTurn = {
      id: generateId(),
      conversationId: convId,
      role: "user",
      content: typeof input === "string" ? input : JSON.stringify(input),
      createdAt: new Date(),
    };
    await this.memoryStore.addTurn(convId, userTurn);

    // Agent loop: think → act → observe → repeat
    let iterations = 0;

    while (iterations < this._config.maxIterations && !this.aborted) {
      iterations++;

      // Build context
      this.setState("thinking");
      const { systemPrompt, messages } = await this.contextManager.buildContext(
        convId,
        input,
      );

      // Notify thinking
      yield this.createEvent("thinking", { iteration: iterations });

      // Stream LLM response
      let fullText = "";
      const pendingToolCalls: Map<
        number,
        { id: string; name: string; args: string }
      > = new Map();
      let toolIndex = 0;

      const tools =
        iterations === 1
          ? this.selectTools(input)
          : this.toolRegistry.definitions();

      const stream = this.provider.stream({
        messages,
        systemPrompt,
        tools,
        temperature: this._config.temperature,
        maxTokens: this._config.maxTokens,
      });

      for await (const chunk of stream) {
        if (this.aborted) break;

        switch (chunk.type) {
          case "text":
            if (chunk.text) {
              fullText += chunk.text;
              yield this.createEvent("response_chunk", { text: chunk.text });
            }
            break;
          case "tool_use_start":
            if (chunk.toolUse) {
              pendingToolCalls.set(toolIndex, {
                id: chunk.toolUse.id,
                name: chunk.toolUse.name,
                args: chunk.toolUse.input ?? "",
              });
              toolIndex++;
            }
            break;
          case "tool_use_delta":
            if (chunk.toolUse) {
              // Find the most recent pending tool call to append to
              const lastIdx = toolIndex - 1;
              const pending = pendingToolCalls.get(lastIdx);
              if (pending) {
                pending.args += chunk.toolUse.input ?? "";
              }
            }
            break;
          case "done":
            // Accumulate usage from this LLM call
            if (chunk.usage) {
              totalTokensIn += chunk.usage.tokensIn;
              totalTokensOut += chunk.usage.tokensOut;
            }
            if (chunk.model) {
              usedModel = chunk.model;
            }
            break;
        }
      }

      // Build tool calls from accumulated chunks
      const toolCalls: ToolUseContent[] = [];
      for (const [, tc] of pendingToolCalls) {
        let parsedInput: Record<string, unknown> = {};
        if (tc.args) {
          try {
            parsedInput = JSON.parse(tc.args);
          } catch {
            parsedInput = { _raw: tc.args };
          }
        }
        toolCalls.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: parsedInput,
        });
      }

      totalToolCalls += toolCalls.length;

      // Build content blocks for the assistant message
      const contentBlocks: ContentBlock[] = [];
      if (fullText) {
        contentBlocks.push({ type: "text", text: fullText });
      }
      for (const tc of toolCalls) {
        contentBlocks.push(tc);
      }

      // When this is the final response (no tool calls), append file markdown
      // so that sent files persist in the conversation history.
      let storedText = fullText;
      if (toolCalls.length === 0 && allSentFiles.length > 0) {
        const filesMd = allSentFiles
          .map((f) => {
            const isImage = /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(f.filename);
            return isImage
              ? `![${f.filename}](${f.url})`
              : `[${f.filename}](${f.url})`;
          })
          .join("\n");
        storedText = storedText ? storedText + "\n" + filesMd : filesMd;
      }

      // Store assistant turn
      const assistantTurn: ConversationTurn = {
        id: generateId(),
        conversationId: convId,
        role: "assistant",
        content: storedText,
        toolCalls: toolCalls.length > 0 ? JSON.stringify(toolCalls) : undefined,
        model: usedModel,
        tokensIn: totalTokensIn,
        tokensOut: totalTokensOut,
        createdAt: new Date(),
      };
      await this.memoryStore.addTurn(convId, assistantTurn);

      // If no tool calls, we're done
      if (toolCalls.length === 0) {
        const durationMs = Date.now() - startTime;
        const message: Message = {
          id: generateId(),
          role: "assistant",
          content: contentBlocks.length > 0 ? contentBlocks : storedText,
          createdAt: new Date(),
          model: usedModel,
          tokensIn: totalTokensIn,
          tokensOut: totalTokensOut,
          durationMs,
          toolCallCount: totalToolCalls,
        };
        this.setState("idle");
        yield this.createEvent("response_complete", { message });
        return;
      }

      // Execute tool calls
      this.setState("tool_calling");

      for (const toolCall of toolCalls) {
        if (this.aborted) break;

        yield this.createEvent("tool_call", {
          name: toolCall.name,
          input: toolCall.input,
        });

        let result = await this.toolRegistry.execute(
          toolCall.name,
          toolCall.input,
          context,
        );

        // Retry retryable tools on failure
        if (result.isError && RETRYABLE_TOOLS.has(toolCall.name)) {
          for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            const delay = RETRY_BASE_DELAY * Math.pow(2, attempt - 1);
            console.log(
              `[agent-loop] Retrying ${toolCall.name} (attempt ${attempt}/${MAX_RETRIES}) after ${delay}ms...`,
            );
            await new Promise((r) => setTimeout(r, delay));
            result = await this.toolRegistry.execute(
              toolCall.name,
              toolCall.input,
              context,
            );
            if (!result.isError) break;
          }
        }

        yield this.createEvent("tool_result", {
          name: toolCall.name,
          result,
        });

        // Store tool result as a turn
        const toolResultContent: ToolResultContent = {
          type: "tool_result",
          toolUseId: toolCall.id,
          content: result.content,
          isError: result.isError,
        };

        const toolTurn: ConversationTurn = {
          id: generateId(),
          conversationId: convId,
          role: "tool",
          content: JSON.stringify([toolResultContent]),
          toolResults: JSON.stringify([{ toolUseId: toolCall.id, ...result }]),
          createdAt: new Date(),
        };
        await this.memoryStore.addTurn(convId, toolTurn);
      }

      // Drain sentFiles from context into accumulator
      if (context?.sentFiles && context.sentFiles.length > 0) {
        allSentFiles.push(...context.sentFiles);
        context.sentFiles.length = 0;
      }

      // Loop back for next LLM call with tool results
    }

    // Max iterations reached
    const durationMs = Date.now() - startTime;
    this.setState("idle");
    const fallbackMessage: Message = {
      id: generateId(),
      role: "assistant",
      content:
        "I've reached the maximum number of iterations. Please try breaking your request into smaller steps.",
      createdAt: new Date(),
      model: usedModel,
      tokensIn: totalTokensIn,
      tokensOut: totalTokensOut,
      durationMs,
      toolCallCount: totalToolCalls,
    };
    yield this.createEvent("response_complete", { message: fallbackMessage });
  }

  stop(): void {
    this.aborted = true;
    this.setState("idle");
  }

  on(listener: AgentEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(state: AgentState): void {
    this._state = state;
    this.emit("state_change", { state });
  }

  private emit(type: AgentEventType, data: unknown): void {
    const event = this.createEvent(type, data);
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private createEvent(type: AgentEventType, data: unknown): AgentEvent {
    return { type, data, timestamp: new Date() };
  }

  /** Core tools that are always sent to the LLM */
  private static readonly CORE_TOOLS = new Set([
    "shell",
    "file_read",
    "file_write",
    "ask_user",
    "web_search",
    "web_fetch",
    "remember",
  ]);

  /** Keyword-triggered specialist tools */
  private static readonly SPECIALIST_TOOLS: ReadonlyArray<{
    tools: string[];
    keywords: string[];
  }> = [
    {
      tools: ["comfyui", "comfyui_generate"],
      keywords: [
        "画",
        "图片",
        "生成",
        "图像",
        "去背景",
        "放大",
        "upscale",
        "generate",
        "image",
        "draw",
        "壁纸",
        "头像",
        "照片",
        "插画",
        "海报",
        "comfyui",
      ],
    },
    {
      tools: ["browser"],
      keywords: [
        "打开",
        "浏览器",
        "网页",
        "网站",
        "截图",
        "screenshot",
        "browse",
        "open",
        "click",
      ],
    },
    {
      tools: ["python"],
      keywords: [
        "代码",
        "脚本",
        "计算",
        "分析",
        "数据",
        "python",
        "code",
        "script",
        "截图",
        "excel",
        "pdf",
        "csv",
      ],
    },
    {
      tools: ["http_request"],
      keywords: ["api", "http", "request", "请求", "接口", "endpoint", "curl"],
    },
    {
      tools: ["send_file"],
      keywords: ["发送文件", "发给我", "send file", "文件发", "传给"],
    },
    {
      tools: ["set_reminder"],
      keywords: ["提醒", "提醒我", "remind", "reminder", "分钟后", "小时后"],
    },
    {
      tools: ["schedule"],
      keywords: ["定时", "每天", "每周", "定期", "cron", "schedule", "每小时"],
    },
    {
      tools: ["plan_task"],
      keywords: ["计划", "规划", "plan", "分解", "步骤", "复杂任务"],
    },
    {
      tools: ["create_skill"],
      keywords: ["创建技能", "保存技能", "新技能", "create skill", "save skill", "记住这个流程", "保存为配方"],
    },
  ];

  /**
   * Select relevant tools based on user input.
   * Core tools are always included; specialist tools are added
   * only when the input matches their trigger keywords.
   */
  private selectTools(input: string | ContentBlock[]): ToolDefinition[] {
    // Extract text from input
    let text: string;
    if (typeof input === "string") {
      text = input;
    } else {
      text = input
        .map((block) => {
          if (block.type === "text") return block.text;
          return "";
        })
        .join(" ");
    }
    const lowerText = text.toLowerCase();

    // Build set of tool names to include
    const selectedNames = new Set(SimpleAgentLoop.CORE_TOOLS);

    for (const spec of SimpleAgentLoop.SPECIALIST_TOOLS) {
      if (spec.keywords.some((kw) => lowerText.includes(kw))) {
        for (const toolName of spec.tools) {
          selectedNames.add(toolName);
        }
      }
    }

    // Filter from full definitions
    return this.toolRegistry
      .definitions()
      .filter((def) => selectedNames.has(def.name));
  }
}
