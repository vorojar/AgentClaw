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
import {
  writeFileSync,
  mkdirSync,
  existsSync,
  copyFileSync,
  unlinkSync,
} from "node:fs";
import { join, basename } from "node:path";

const DEFAULT_CONFIG: AgentConfig = {
  maxIterations: 15,
  systemPrompt: "",
  streaming: false,
  temperature: 0.5,
  maxTokens: 8192,
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

/** Build a dedup key for per-tool failure tracking */
function buildFailKey(
  toolName: string,
  toolInput: Record<string, unknown>,
): string {
  // Include distinguishing parameter so a corrected call isn't blocked
  if (toolName === "bash" && typeof toolInput?.command === "string") {
    return `bash:${toolInput.command.slice(0, 80)}`;
  }
  // For file tools, different paths or content types are different calls
  const sig = toolInput ? JSON.stringify(toolInput).slice(0, 120) : "";
  return `${toolName}:${sig}`;
}

export class SimpleAgentLoop implements AgentLoop {
  private _state: AgentState = "idle";
  private _config: AgentConfig;
  private provider: LLMProvider;
  private toolRegistry: ToolRegistryImpl;
  private contextManager: ContextManager;
  private memoryStore: MemoryStore;
  private listeners: Set<AgentEventListener> = new Set();
  private aborted = false;
  private abortController: AbortController | null = null;

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
    this.abortController = new AbortController();
    if (context) {
      context.abortSignal = this.abortController.signal;
    }
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

    // Per-trace temp directory: data/tmp/{traceId}/
    const traceTmpDir = join(process.cwd(), "data", "tmp", trace.id).replace(
      /\\/g,
      "/",
    );
    mkdirSync(traceTmpDir, { recursive: true });

    // Expose working directory to tools (use_skill replaces {WORKDIR})
    if (context) context.workDir = traceTmpDir;

    // ── Collect all user files into per-trace dir ──
    // 1. Images: save base64 to per-trace dir, record path for DB storage
    const savedImagePaths: string[] = [];
    const imagePathMap = new Map<ImageContent, string>(); // block → saved file path
    // 2. Attachments (video, docs, etc.): copy from data/tmp/ root to per-trace dir
    const relocatedFiles = new Map<string, string>(); // original path → per-trace path

    if (Array.isArray(input)) {
      for (const block of input) {
        if (block.type === "image" && (block as ImageContent).data) {
          const img = block as ImageContent;
          // 优先使用上传时的原始文件名，fallback 到通用名
          const ext = img.mediaType?.includes("png") ? "png" : "jpg";
          const filename = img.filename || `user_image_${Date.now()}.${ext}`;
          const filePath = join(traceTmpDir, filename).replace(/\\/g, "/");
          try {
            writeFileSync(filePath, Buffer.from(img.data, "base64"));
            savedImagePaths.push(filePath);
            imagePathMap.set(img, filePath);
          } catch {
            // save failed, keep original base64
          }
        }
        // Relocate non-image attachments referenced in text blocks
        // ws.ts format: "用户上传了附件，已保存到：/abs/path\n注意：..."
        if (block.type === "text") {
          const re = /已保存到：([^\n]+)/g;
          let m;
          while ((m = re.exec(block.text)) !== null) {
            const origPath = m[1].trim();
            if (existsSync(origPath)) {
              const newPath = join(traceTmpDir, basename(origPath)).replace(
                /\\/g,
                "/",
              );
              try {
                copyFileSync(origPath, newPath);
                try {
                  unlinkSync(origPath);
                } catch {
                  /* ignore */
                }
                relocatedFiles.set(origPath, newPath);
              } catch {
                /* move failed — keep original path */
              }
            }
          }
        }
      }
    }

    // Build runtime hints — injected into messages after buildContext
    // 图片路径已在 ws.ts 的 fileHints 中（格式同附件），relocate 逻辑会自动重写到 trace 目录
    const runtimeHints: string[] = [
      `[工作目录：${traceTmpDir}]（所有文件都在此目录下，输出也保存到这里）`,
    ];
    const hintText = runtimeHints.join("\n");

    // DB 存储：多模态输入存 ContentBlock[] JSON（image.data 替换为 file:// 路径，避免 DB 膨胀）
    // turnToMessage 读取时从磁盘加载 base64 还原
    let userContentForStorage: string;
    if (typeof input === "string") {
      userContentForStorage = context?.originalUserText ?? input;
    } else {
      // 替换 image block 的 base64 data 为 file:// 引用
      const storable = input.map((block) => {
        if (block.type === "image") {
          const img = block as ImageContent;
          const savedPath = imagePathMap.get(img);
          if (savedPath) {
            return {
              type: "image",
              mediaType: img.mediaType,
              filePath: savedPath,
              filename: img.filename,
            };
          }
        }
        return block;
      });
      userContentForStorage = JSON.stringify(storable);
    }

    // 存储用户消息到 DB
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
    let useSkillRollbacks = 0;
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

      // Inject runtime hints + rewrite relocated file paths in the last user message.
      // DB stores original paths (UI stays clean), LLM sees per-trace paths every iteration.
      if (messages.length > 0) {
        const lastMsg = messages[messages.length - 1];
        if (lastMsg.role === "user") {
          // Rewrite attachment paths from data/tmp/ root → per-trace dir
          const rewrite = (text: string): string => {
            let result = text;
            for (const [orig, relocated] of relocatedFiles) {
              result = result.replaceAll(orig, relocated);
            }
            return result;
          };
          if (typeof lastMsg.content === "string") {
            lastMsg.content = rewrite(lastMsg.content) + "\n" + hintText;
          } else if (Array.isArray(lastMsg.content)) {
            for (const block of lastMsg.content as ContentBlock[]) {
              if (block.type === "text") {
                block.text = rewrite(block.text);
              }
            }
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

      // 流异常捕获：网络断开/API 错误时仍需保留 token 统计和 trace
      let streamError: Error | undefined;
      try {
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
              if (chunk.stopReason === "max_tokens") {
                console.warn(
                  `[agent-loop] LLM output truncated (max_tokens reached at ${this._config.maxTokens} tokens)`,
                );
              }
              break;
          }
        }
      } catch (err) {
        // 流中断时记录错误，但不阻断后续 token 统计和 trace 保存
        streamError = err instanceof Error ? err : new Error(String(err));
        console.error(`[agent-loop] LLM stream error: ${streamError.message}`);
        yield this.createEvent("error", { error: streamError.message });
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
      if (streamError) llmStep.error = streamError.message;
      trace.steps.push(llmStep as TraceStep);

      // 流异常时跳过工具调用，直接结束本轮循环
      if (streamError) break;

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
      contentBlocks.push(...toolCalls);

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

        // Mutable tool name/input — hooks may modify these
        let effectiveToolName = toolCall.name;
        let effectiveToolInput = toolCall.input;

        // Check tool access policy
        let result!: Awaited<ReturnType<typeof this.toolRegistry.execute>>;
        let blockedByPolicy = false;

        if (context?.toolPolicy) {
          const { allow, deny } = context.toolPolicy;
          const denied = deny?.includes(effectiveToolName);
          const notAllowed = allow && !allow.includes(effectiveToolName);
          if (denied || notAllowed) {
            result = {
              content: `Tool "${effectiveToolName}" is blocked by policy`,
              isError: true,
            };
            blockedByPolicy = true;
          }
        }

        // Run before hooks (skip if already blocked by policy)
        if (!blockedByPolicy && context?.toolHooks?.before) {
          const modified = await context.toolHooks.before({
            name: effectiveToolName,
            input: effectiveToolInput,
          });
          if (modified === null) {
            result = {
              content: `Tool "${effectiveToolName}" was blocked by a before hook`,
              isError: true,
            };
            blockedByPolicy = true;
          } else {
            effectiveToolName = modified.name;
            effectiveToolInput = modified.input;
          }
        }

        const toolStart = Date.now();

        if (!blockedByPolicy) {
          // Check if this tool has already failed too many times across iterations
          const failKey = buildFailKey(effectiveToolName, effectiveToolInput);
          const priorFails = toolFailCounts.get(failKey) ?? 0;

          if (priorFails >= MAX_TOOL_FAILURES) {
            result = {
              content: `This tool has failed ${priorFails} times in this conversation. Stop retrying and tell the user what went wrong.`,
              isError: true,
            };
          } else {
            result = await this.toolRegistry.execute(
              effectiveToolName,
              effectiveToolInput,
              context,
            );

            // Retry retryable tools on failure
            if (result.isError && RETRYABLE_TOOLS.has(effectiveToolName)) {
              for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                if (this.aborted) break;
                const delay = RETRY_BASE_DELAY * Math.pow(2, attempt - 1);
                console.log(
                  `[agent-loop] Retrying ${effectiveToolName} (attempt ${attempt}/${MAX_RETRIES}) after ${delay}ms...`,
                );
                await new Promise((r) => setTimeout(r, delay));
                if (this.aborted) break;
                result = await this.toolRegistry.execute(
                  effectiveToolName,
                  effectiveToolInput,
                  context,
                );
                if (!result.isError) break;
              }
            }
          }

          // Run after hooks
          if (context?.toolHooks?.after) {
            result = await context.toolHooks.after(
              { name: effectiveToolName, input: effectiveToolInput },
              result!,
            );
          }
        }

        const toolDurationMs = Date.now() - toolStart;

        // Update per-tool failure tracking (skip for policy/hook blocks)
        if (!blockedByPolicy) {
          const failKey = buildFailKey(effectiveToolName, effectiveToolInput);
          if (result!.isError) {
            toolFailCounts.set(failKey, (toolFailCounts.get(failKey) ?? 0) + 1);
          } else {
            toolFailCounts.delete(failKey);
          }
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
      if (
        toolCalls.every((tc) => tc.name === "use_skill") &&
        useSkillRollbacks < 3
      ) {
        iterations--;
        useSkillRollbacks++;
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
    this.abortController?.abort();
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
