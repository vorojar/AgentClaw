import type {
  AgentLoop,
  AgentState,
  AgentConfig,
  AgentEvent,
  AgentEventListener,
  AgentEventType,
  Message,
  ContentBlock,
  ImageContent,
  ToolUseContent,
  ToolResultContent,
  ToolExecutionContext,
  LLMProvider,
  LLMStreamChunk,
  ContextManager,
  MemoryStore,
  ConversationTurn,
  Trace,
  TraceStep,
} from "@agentclaw/types";
import type { ToolRegistryImpl } from "@agentclaw/tools";
import { generateId } from "@agentclaw/providers";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_CONFIG: AgentConfig = {
  maxIterations: 15,
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
/** Stop the loop if this many consecutive iterations produce only errors */
const MAX_CONSECUTIVE_ERRORS = 3;

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
    let prevTokensIn = 0;
    let prevTokensOut = 0;
    let usedModel: string | undefined;
    // Accumulate files sent by tools (for persistence)
    const allSentFiles: Array<{ url: string; filename: string }> = [];

    // Trace for debugging
    const trace: Trace = {
      id: generateId(),
      conversationId: convId,
      userInput: typeof input === "string" ? input : JSON.stringify(input),
      steps: [],
      tokensIn: 0,
      tokensOut: 0,
      durationMs: 0,
      createdAt: new Date(),
    };

    // 优先用 gateway 传入的原始文本（parseUserContent 转换前的），否则用当前 input
    const userContentForStorage =
      context?.originalUserText ??
      (typeof input === "string" ? input : JSON.stringify(input));

    // Per-trace temp directory: data/tmp/{traceId}/
    const traceTmpDir = join(process.cwd(), "data", "tmp", trace.id).replace(
      /\\/g,
      "/",
    );
    mkdirSync(traceTmpDir, { recursive: true });

    // Pre-process images: save to per-trace dir so LLM can reference by path
    // Also prevents re-sending base64 on every iteration (saves tokens)
    const savedImagePaths: string[] = [];
    if (Array.isArray(input)) {
      for (const block of input) {
        if (block.type === "image" && (block as ImageContent).data) {
          const img = block as ImageContent;
          const ext = img.mediaType?.includes("png") ? "png" : "jpg";
          const filename = `user_image_${Date.now()}.${ext}`;
          const filePath = join(traceTmpDir, filename).replace(/\\/g, "/");
          try {
            writeFileSync(filePath, Buffer.from(img.data, "base64"));
            savedImagePaths.push(filePath);
          } catch {
            // save failed, keep original base64
          }
        }
      }
    }

    // Build runtime hints (working dir + image paths) — injected into messages after buildContext
    const runtimeHints: string[] = [
      `[Working directory for output files: ${traceTmpDir}. Save ALL generated files here.]`,
    ];
    if (savedImagePaths.length === 1) {
      runtimeHints.push(
        `[User sent an image, saved to: ${savedImagePaths[0]}. Use this path directly to attach/process the file. Do NOT take a screenshot.]`,
      );
    } else if (savedImagePaths.length > 1) {
      runtimeHints.push(
        `[User sent ${savedImagePaths.length} images, saved to: ${savedImagePaths.join(", ")}. Use these paths directly. Do NOT take screenshots.]`,
      );
    }
    const hintText = runtimeHints.join("\n");

    // 存储原始用户消息（不含注入的提示），刷新后用户看到的是原始内容
    const userTurn: ConversationTurn = {
      id: generateId(),
      conversationId: convId,
      role: "user",
      content: userContentForStorage,
      createdAt: new Date(),
    };
    await this.memoryStore.addTurn(convId, userTurn);

    // Track per-tool failure counts across iterations to prevent retry avalanche
    const toolFailCounts = new Map<string, number>();
    const MAX_TOOL_FAILURES = 2;

    // Skill injection is handled entirely by use_skill tool — no auto-injection.
    // This keeps the system prompt lean; LLM decides which skill to load.
    const effectiveSkillName = context?.preSelectedSkillName;

    // Agent loop: think → act → observe → repeat
    let iterations = 0;
    let consecutiveErrors = 0;
    let lastFullText = ""; // Keep last LLM text for fallback response

    while (iterations < this._config.maxIterations && !this.aborted) {
      iterations++;

      // Build context (iteration 2+ reuses cached dynamic prefix for KV-cache stability)
      this.setState("thinking");
      const { systemPrompt, messages, skillMatch } =
        await this.contextManager.buildContext(convId, input, {
          preSelectedSkillName: effectiveSkillName,
          reuseContext: iterations > 1,
        });

      // Inject runtime hints (working dir, image paths) into the last user message.
      // Hints are NOT stored in DB (UI stays clean), but LLM sees them every iteration.
      if (messages.length > 0) {
        const lastMsg = messages[messages.length - 1];
        if (lastMsg.role === "user") {
          if (typeof lastMsg.content === "string") {
            lastMsg.content += "\n" + hintText;
          } else if (Array.isArray(lastMsg.content)) {
            (lastMsg.content as ContentBlock[]).push({
              type: "text",
              text: hintText,
            });
          }
        }
      }

      // Record trace metadata on first iteration
      if (iterations === 1) {
        trace.systemPrompt = systemPrompt;
        if (skillMatch) {
          trace.skillMatch = JSON.stringify(skillMatch);
        }
      }

      // Notify thinking
      yield this.createEvent("thinking", { iteration: iterations });

      // Stream LLM response
      let fullText = "";
      const pendingToolCalls: Map<
        number,
        { id: string; name: string; args: string }
      > = new Map();
      let toolIndex = 0;

      const tools = this.toolRegistry.definitions();

      const stream = this.provider.stream({
        messages,
        systemPrompt,
        tools,
        model: this._config.model,
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

      // Compute per-iteration delta
      const iterTokensIn = totalTokensIn - prevTokensIn;
      const iterTokensOut = totalTokensOut - prevTokensOut;
      prevTokensIn = totalTokensIn;
      prevTokensOut = totalTokensOut;

      if (fullText) lastFullText = fullText;

      // Record LLM call in trace (include text if any)
      const llmStep: Record<string, unknown> = {
        type: "llm_call",
        iteration: iterations,
        tokensIn: iterTokensIn,
        tokensOut: iterTokensOut,
      };
      if (fullText) llmStep.text = fullText;
      trace.steps.push(llmStep as TraceStep);

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
      // Skip files whose filename already appears in the LLM's response text.
      let storedText = fullText;
      if (toolCalls.length === 0 && allSentFiles.length > 0) {
        const newFiles = allSentFiles.filter(
          (f) => !fullText.includes(f.filename),
        );
        if (newFiles.length > 0) {
          const filesMd = newFiles
            .map((f) => {
              const isImage = /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(
                f.filename,
              );
              return isImage
                ? `![${f.filename}](${f.url})`
                : `[${f.filename}](${f.url})`;
            })
            .join("\n");
          storedText = storedText ? storedText + "\n" + filesMd : filesMd;
        }
      }

      // If no tool calls, this is the final turn — store cumulative totals
      if (toolCalls.length === 0) {
        const durationMs = Date.now() - startTime;

        const assistantTurn: ConversationTurn = {
          id: generateId(),
          conversationId: convId,
          role: "assistant",
          content: storedText,
          model: usedModel,
          tokensIn: totalTokensIn,
          tokensOut: totalTokensOut,
          durationMs,
          toolCallCount: totalToolCalls,
          traceId: trace.id,
          createdAt: new Date(),
        };
        await this.memoryStore.addTurn(convId, assistantTurn);

        // Finalize and persist trace
        trace.response = storedText;
        trace.model = usedModel;
        trace.tokensIn = totalTokensIn;
        trace.tokensOut = totalTokensOut;
        trace.durationMs = durationMs;
        try {
          await this.memoryStore.addTrace(trace);
        } catch (e) {
          console.error("[agent-loop] Failed to persist trace:", e);
        }

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

      // Intermediate turn — store per-iteration tokens
      const assistantTurn: ConversationTurn = {
        id: generateId(),
        conversationId: convId,
        role: "assistant",
        content: storedText,
        toolCalls: JSON.stringify(toolCalls),
        model: usedModel,
        tokensIn: iterTokensIn,
        tokensOut: iterTokensOut,
        traceId: trace.id,
        createdAt: new Date(),
      };
      await this.memoryStore.addTurn(convId, assistantTurn);

      // Execute tool calls
      this.setState("tool_calling");
      let iterationErrorCount = 0;
      let hasAutoComplete = false;

      for (const toolCall of toolCalls) {
        if (this.aborted) break;

        yield this.createEvent("tool_call", {
          name: toolCall.name,
          input: toolCall.input,
        });

        // Record tool_call in trace
        trace.steps.push({
          type: "tool_call",
          name: toolCall.name,
          input: toolCall.input,
        } as TraceStep);

        // Check if this tool has already failed too many times across iterations
        // For bash, key by command prefix so different commands don't share counts
        const failKey =
          toolCall.name === "bash" &&
          typeof toolCall.input?.command === "string"
            ? `bash:${toolCall.input.command.slice(0, 80)}`
            : toolCall.name;
        const priorFails = toolFailCounts.get(failKey) ?? 0;
        let result: Awaited<ReturnType<typeof this.toolRegistry.execute>>;

        const toolStart = Date.now();

        if (priorFails >= MAX_TOOL_FAILURES) {
          result = {
            content: `This tool has failed ${priorFails} times in this conversation. Stop retrying and tell the user what went wrong.`,
            isError: true,
          };
        } else {
          result = await this.toolRegistry.execute(
            toolCall.name,
            toolCall.input,
            context,
          );

          // Retry retryable tools on failure
          if (result.isError && RETRYABLE_TOOLS.has(toolCall.name)) {
            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
              if (this.aborted) break;
              const delay = RETRY_BASE_DELAY * Math.pow(2, attempt - 1);
              console.log(
                `[agent-loop] Retrying ${toolCall.name} (attempt ${attempt}/${MAX_RETRIES}) after ${delay}ms...`,
              );
              await new Promise((r) => setTimeout(r, delay));
              if (this.aborted) break;
              result = await this.toolRegistry.execute(
                toolCall.name,
                toolCall.input,
                context,
              );
              if (!result.isError) break;
            }
          }
        }

        const toolDurationMs = Date.now() - toolStart;

        // Update per-tool failure tracking
        if (result.isError) {
          toolFailCounts.set(failKey, priorFails + 1);
        } else {
          toolFailCounts.delete(failKey);
        }

        if (result.autoComplete) hasAutoComplete = true;

        yield this.createEvent("tool_result", {
          name: toolCall.name,
          result,
          durationMs: toolDurationMs,
        });

        // Record tool_result in trace
        trace.steps.push({
          type: "tool_result",
          name: toolCall.name,
          content: result.content,
          isError: result.isError,
          durationMs: toolDurationMs,
        } as TraceStep);

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
          toolResults: JSON.stringify([
            { toolUseId: toolCall.id, ...result, durationMs: toolDurationMs },
          ]),
          createdAt: new Date(),
        };
        await this.memoryStore.addTurn(convId, toolTurn);

        if (result.isError) iterationErrorCount++;
      }

      // Drain sentFiles from context into accumulator (dedup by URL)
      if (context?.sentFiles && context.sentFiles.length > 0) {
        for (const f of context.sentFiles) {
          if (!allSentFiles.some((e) => e.url === f.url)) {
            allSentFiles.push(f);
          }
        }
        context.sentFiles.length = 0;
      }

      // Auto-complete: tool signaled that no further LLM call is needed
      if (hasAutoComplete && iterationErrorCount === 0) {
        const durationMs = Date.now() - startTime;

        // Build response from sent files
        const filesMd = allSentFiles
          .map((f) => {
            const isImage = /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(f.filename);
            return isImage
              ? `![${f.filename}](${f.url})`
              : `[${f.filename}](${f.url})`;
          })
          .join("\n");
        const responseText = filesMd || "Done.";

        // Store assistant turn
        const autoTurn: ConversationTurn = {
          id: generateId(),
          conversationId: convId,
          role: "assistant",
          content: responseText,
          model: usedModel,
          tokensIn: totalTokensIn,
          tokensOut: totalTokensOut,
          durationMs,
          toolCallCount: totalToolCalls,
          traceId: trace.id,
          createdAt: new Date(),
        };
        await this.memoryStore.addTurn(convId, autoTurn);

        // Persist trace
        trace.response = responseText;
        trace.model = usedModel;
        trace.tokensIn = totalTokensIn;
        trace.tokensOut = totalTokensOut;
        trace.durationMs = durationMs;
        try {
          await this.memoryStore.addTrace(trace);
        } catch (e) {
          console.error("[agent-loop] Failed to persist trace:", e);
        }

        this.setState("idle");
        const message: Message = {
          id: generateId(),
          role: "assistant",
          content: responseText,
          createdAt: new Date(),
          model: usedModel,
          tokensIn: totalTokensIn,
          tokensOut: totalTokensOut,
          durationMs,
          toolCallCount: totalToolCalls,
        };
        yield this.createEvent("response_complete", { message });
        return;
      }

      // Track consecutive all-error iterations to avoid endless thrashing
      if (iterationErrorCount === toolCalls.length) {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.log(
            `[agent-loop] ${consecutiveErrors} consecutive all-error iterations, stopping early.`,
          );
          break;
        }
      } else {
        consecutiveErrors = 0;
      }

      // use_skill is just loading instructions — don't count against iteration budget
      if (toolCalls.every((tc) => tc.name === "use_skill")) {
        iterations--;
      }

      // Loop back for next LLM call with tool results
    }

    // Max iterations reached — persist trace
    const durationMs = Date.now() - startTime;
    trace.model = usedModel;
    trace.tokensIn = totalTokensIn;
    trace.tokensOut = totalTokensOut;
    trace.durationMs = durationMs;
    trace.error = "max_iterations_reached";
    try {
      await this.memoryStore.addTrace(trace);
    } catch (e) {
      console.error("[agent-loop] Failed to persist trace:", e);
    }

    // Store a final assistant turn so token stats persist
    const fallbackContent =
      lastFullText ||
      "I've reached the maximum number of iterations. Please try breaking your request into smaller steps.";
    const fallbackTurn: ConversationTurn = {
      id: generateId(),
      conversationId: convId,
      role: "assistant",
      content: fallbackContent,
      model: usedModel,
      tokensIn: totalTokensIn,
      tokensOut: totalTokensOut,
      durationMs,
      toolCallCount: totalToolCalls,
      traceId: trace.id,
      createdAt: new Date(),
    };
    await this.memoryStore.addTurn(convId, fallbackTurn);

    this.setState("idle");
    const fallbackMessage: Message = {
      id: generateId(),
      role: "assistant",
      content: fallbackContent,
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
}
