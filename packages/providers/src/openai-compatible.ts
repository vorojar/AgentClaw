import OpenAI from "openai";
import type {
  LLMRequest,
  LLMResponse,
  LLMStreamChunk,
  ModelInfo,
  Message,
  ContentBlock,
  ToolDefinition,
  ToolUseContent,
  ToolResultContent,
} from "@agentclaw/types";
import { BaseLLMProvider, generateId } from "./base.js";

export interface OpenAICompatibleOptions {
  apiKey?: string;
  baseURL?: string;
  defaultModel?: string;
  /** Provider name used in ModelInfo */
  providerName?: string;
  /** Pre-defined models list; if omitted a sensible default is used */
  models?: ModelInfo[];
}

/**
 * OpenAI-compatible LLM Provider.
 * Works with OpenAI, Kimi, DeepSeek, MiniMax, Qwen, Ollama, etc.
 */
export class OpenAICompatibleProvider extends BaseLLMProvider {
  readonly name: string;
  readonly models: ModelInfo[];

  private client: OpenAI;
  private defaultModel: string;

  constructor(options: OpenAICompatibleOptions = {}) {
    super();
    this.name = options.providerName ?? "openai";
    this.client = new OpenAI({
      apiKey: options.apiKey ?? "",
      baseURL: options.baseURL,
    });
    this.models = options.models ?? [
      {
        id: "gpt-4o",
        provider: this.name,
        name: "GPT-4o",
        tier: "flagship",
        contextWindow: 128_000,
        supportsTools: true,
        supportsStreaming: true,
        costPer1kInput: 0.0025,
        costPer1kOutput: 0.01,
      },
      {
        id: "gpt-4o-mini",
        provider: this.name,
        name: "GPT-4o Mini",
        tier: "fast",
        contextWindow: 128_000,
        supportsTools: true,
        supportsStreaming: true,
        costPer1kInput: 0.00015,
        costPer1kOutput: 0.0006,
      },
    ];
    this.defaultModel = options.defaultModel ?? this.models[0].id;
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model ?? this.defaultModel;
    const messages = this.convertMessages(
      request.messages,
      request.systemPrompt,
    );
    const tools = request.tools ? this.convertTools(request.tools) : undefined;

    const response = await this.client.chat.completions.create({
      model,
      messages,
      ...(tools && tools.length > 0 ? { tools } : {}),
      ...(request.temperature != null
        ? { temperature: request.temperature }
        : {}),
      ...(request.maxTokens != null ? { max_tokens: request.maxTokens } : {}),
      ...(request.stopSequences ? { stop: request.stopSequences } : {}),
    });

    const choice = response.choices[0];
    const contentBlocks = this.convertResponseMessage(choice.message);

    const message: Message = {
      id: generateId(),
      role: "assistant",
      content: contentBlocks,
      createdAt: new Date(),
      model,
      tokensIn: response.usage?.prompt_tokens ?? 0,
      tokensOut: response.usage?.completion_tokens ?? 0,
    };

    return {
      message,
      model,
      tokensIn: response.usage?.prompt_tokens ?? 0,
      tokensOut: response.usage?.completion_tokens ?? 0,
      stopReason: this.mapFinishReason(choice.finish_reason),
    };
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
    const model = request.model ?? this.defaultModel;
    const messages = this.convertMessages(
      request.messages,
      request.systemPrompt,
    );
    const tools = request.tools ? this.convertTools(request.tools) : undefined;

    const stream = await this.client.chat.completions.create({
      model,
      messages,
      stream: true,
      ...(tools && tools.length > 0 ? { tools } : {}),
      ...(request.temperature != null
        ? { temperature: request.temperature }
        : {}),
      ...(request.maxTokens != null ? { max_tokens: request.maxTokens } : {}),
      ...(request.stopSequences ? { stop: request.stopSequences } : {}),
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      // Text content — also check "reasoning" field for thinking-mode models
      const deltaText =
        delta.content ||
        (delta as unknown as Record<string, string>).reasoning ||
        "";
      if (deltaText) {
        yield { type: "text", text: deltaText };
      }

      // Tool calls
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.function?.name) {
            // New tool call starting
            yield {
              type: "tool_use_start",
              toolUse: {
                id: tc.id ?? "",
                name: tc.function.name,
                input: tc.function.arguments ?? "",
              },
            };
          } else if (tc.function?.arguments) {
            // Continuing argument streaming
            yield {
              type: "tool_use_delta",
              toolUse: {
                id: tc.id ?? "",
                name: "",
                input: tc.function.arguments,
              },
            };
          }
        }
      }

      // Check finish reason
      if (chunk.choices[0]?.finish_reason) {
        yield { type: "done" };
      }
    }
  }

  // ---- Internal conversion helpers ----

  private convertMessages(
    messages: Message[],
    systemPrompt?: string,
  ): OpenAI.ChatCompletionMessageParam[] {
    const result: OpenAI.ChatCompletionMessageParam[] = [];

    // Add system prompt if present
    if (systemPrompt) {
      result.push({ role: "system", content: systemPrompt });
    }

    for (const msg of messages) {
      if (msg.role === "system") {
        result.push({ role: "system", content: this.extractText(msg.content) });
      } else if (msg.role === "user") {
        result.push({ role: "user", content: this.extractText(msg.content) });
      } else if (msg.role === "assistant") {
        const assistantMsg = this.convertAssistantMessage(msg);
        result.push(assistantMsg);
      } else if (msg.role === "tool") {
        const toolMsgs = this.convertToolResultMessages(msg);
        result.push(...toolMsgs);
      }
    }

    return result;
  }

  private convertAssistantMessage(
    msg: Message,
  ): OpenAI.ChatCompletionAssistantMessageParam {
    if (typeof msg.content === "string") {
      return { role: "assistant", content: msg.content };
    }

    // Build assistant message with optional tool_calls
    const textParts = msg.content.filter((b) => b.type === "text");
    const toolUseParts = msg.content.filter(
      (b): b is ToolUseContent => b.type === "tool_use",
    );

    const text = textParts.map((b) => (b as { text: string }).text).join("");

    if (toolUseParts.length === 0) {
      return { role: "assistant", content: text || null };
    }

    return {
      role: "assistant",
      content: text || null,
      tool_calls: toolUseParts.map((t) => ({
        id: t.id,
        type: "function" as const,
        function: {
          name: t.name,
          arguments: JSON.stringify(t.input),
        },
      })),
    };
  }

  private convertToolResultMessages(
    msg: Message,
  ): OpenAI.ChatCompletionToolMessageParam[] {
    if (typeof msg.content === "string") {
      // Shouldn't happen in practice, but handle gracefully
      return [{ role: "tool", tool_call_id: "", content: msg.content }];
    }

    return msg.content
      .filter((b): b is ToolResultContent => b.type === "tool_result")
      .map((b) => ({
        role: "tool" as const,
        tool_call_id: b.toolUseId,
        content: b.content,
      }));
  }

  private convertTools(tools: ToolDefinition[]): OpenAI.ChatCompletionTool[] {
    return tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: "object",
          properties: t.parameters.properties,
          ...(t.parameters.required ? { required: t.parameters.required } : {}),
        },
      },
    }));
  }

  private convertResponseMessage(
    msg: OpenAI.ChatCompletionMessage,
  ): ContentBlock[] {
    const blocks: ContentBlock[] = [];

    // Some models (e.g. qwen3 with thinking mode) return empty content
    // with all output in a "reasoning" field. Fall back to reasoning if
    // content is empty.
    const text =
      msg.content || (msg as unknown as Record<string, string>).reasoning || "";
    if (text) {
      blocks.push({ type: "text", text });
    }

    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(tc.function.arguments);
        } catch {
          // leave as empty object
        }
        blocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input,
        });
      }
    }

    return blocks;
  }

  private mapFinishReason(reason: string | null): LLMResponse["stopReason"] {
    switch (reason) {
      case "tool_calls":
        return "tool_use";
      case "length":
        return "max_tokens";
      case "stop":
        return "end_turn";
      default:
        return "end_turn";
    }
  }
}
