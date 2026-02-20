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
  LLMProvider,
  LLMResponse,
  ContextManager,
  MemoryStore,
  ConversationTurn,
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

  async run(input: string, conversationId?: string): Promise<Message> {
    this.aborted = false;
    const convId = conversationId ?? generateId();

    // Store user message
    const userTurn: ConversationTurn = {
      id: generateId(),
      conversationId: convId,
      role: "user",
      content: input,
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

      // Call LLM
      this.emit("thinking", { iteration: iterations });

      const response: LLMResponse = await this.provider.chat({
        messages,
        systemPrompt,
        tools: this.toolRegistry.definitions(),
        temperature: this._config.temperature,
        maxTokens: this._config.maxTokens,
      });

      // Store assistant response — extract plain text so the LLM doesn't
      // see raw JSON in its conversation history and start mimicking it.
      const assistantContent =
        typeof response.message.content === "string"
          ? response.message.content
          : response.message.content
              .filter((b) => b.type === "text")
              .map((b) => (b as { text: string }).text)
              .join("");

      const toolCalls = this.extractToolCalls(response.message.content);

      const assistantTurn: ConversationTurn = {
        id: generateId(),
        conversationId: convId,
        role: "assistant",
        content: assistantContent,
        toolCalls: toolCalls.length > 0 ? JSON.stringify(toolCalls) : undefined,
        model: response.model,
        tokensIn: response.tokensIn,
        tokensOut: response.tokensOut,
        createdAt: new Date(),
      };
      await this.memoryStore.addTurn(convId, assistantTurn);

      // If no tool calls, we're done (ignore stopReason — some providers
      // return finish_reason:"stop" even when tool_calls are present)
      if (toolCalls.length === 0) {
        this.setState("responding");
        this.emit("response_complete", { message: response.message });
        this.setState("idle");
        return response.message;
      }

      // Execute tool calls
      this.setState("tool_calling");

      for (const toolCall of toolCalls) {
        if (this.aborted) break;

        this.emit("tool_call", {
          name: toolCall.name,
          input: toolCall.input,
        });

        const result = await this.toolRegistry.execute(
          toolCall.name,
          toolCall.input,
        );

        this.emit("tool_result", {
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

      // Loop back for next LLM call with tool results
    }

    // Max iterations reached
    this.setState("idle");
    const fallbackMessage: Message = {
      id: generateId(),
      role: "assistant",
      content:
        "I've reached the maximum number of iterations. Please try breaking your request into smaller steps.",
      createdAt: new Date(),
    };
    return fallbackMessage;
  }

  async *runStream(
    input: string,
    conversationId?: string,
  ): AsyncIterable<AgentEvent> {
    // For Phase 1, delegate to non-streaming run and yield events
    const message = await this.run(input, conversationId);
    yield this.createEvent("response_complete", { message });
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

  private extractToolCalls(content: string | ContentBlock[]): ToolUseContent[] {
    if (typeof content === "string") return [];
    return content.filter(
      (block): block is ToolUseContent => block.type === "tool_use",
    );
  }
}
