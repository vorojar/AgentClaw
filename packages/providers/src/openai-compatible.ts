import OpenAI from "openai";
import type {
  LLMRequest,
  LLMResponse,
  LLMStreamChunk,
  ModelInfo,
  Message,
  ContentBlock,
  ImageContent,
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

    // Debug: detect if we're sending images
    const hasImageContent = messages.some(
      (m) =>
        Array.isArray(m.content) &&
        (m.content as Array<{ type: string }>).some(
          (c) => c.type === "image_url",
        ),
    );
    if (hasImageContent) {
      console.log(
        `[${this.name}] Sending request with image content to model: ${model}`,
      );
    }

    const tools = request.tools ? this.convertTools(request.tools) : undefined;

    let stream;
    try {
      stream = await this.client.chat.completions.create({
        model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        ...(tools && tools.length > 0 ? { tools } : {}),
        ...(request.temperature != null
          ? { temperature: request.temperature }
          : {}),
        ...(request.maxTokens != null ? { max_tokens: request.maxTokens } : {}),
        ...(request.stopSequences ? { stop: request.stopSequences } : {}),
      });
    } catch (err) {
      // Enrich error with provider/model info for easier debugging
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`[${this.name}/${model}] ${msg}`);
    }

    let tokensIn = 0;
    let tokensOut = 0;

    for await (const chunk of stream) {
      // Extract usage from the final chunk (sent when stream_options.include_usage is true)
      // NOTE: OpenAI sends usage in a separate chunk AFTER finish_reason,
      // so we must not emit "done" until the loop ends.
      if (chunk.usage) {
        tokensIn = chunk.usage.prompt_tokens ?? 0;
        tokensOut = chunk.usage.completion_tokens ?? 0;
      }

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
    }

    // Emit "done" after the stream ends so the usage-only chunk has been processed
    yield {
      type: "done",
      usage: { tokensIn, tokensOut },
      model,
    };
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
        // 用户消息可能包含图片等多模态内容，需要构造 OpenAI 格式的 content 数组
        const userContent = this.convertUserContent(msg.content);
        result.push({ role: "user", content: userContent });
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

  /**
   * 将用户消息内容转换为 OpenAI 格式。
   * 纯文本返回 string；包含图片时返回 OpenAI 多模态 content 数组。
   */
  private convertUserContent(
    content: string | ContentBlock[],
  ): string | OpenAI.ChatCompletionContentPart[] {
    if (typeof content === "string") return content;

    // 检查是否包含图片内容
    const hasImage = content.some((b) => b.type === "image");
    if (!hasImage) {
      // 无图片时直接提取文本
      return this.extractText(content);
    }

    // 包含图片，构造 OpenAI 多模态 content 数组
    const parts: OpenAI.ChatCompletionContentPart[] = [];
    for (const block of content) {
      switch (block.type) {
        case "text":
          parts.push({ type: "text", text: block.text });
          break;
        case "image":
          parts.push({
            type: "image_url",
            image_url: {
              url: `data:${(block as ImageContent).mediaType};base64,${(block as ImageContent).data}`,
            },
          });
          break;
        // 其他类型（tool_use, tool_result）在用户消息中一般不会出现，忽略
      }
    }
    return parts;
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

    // Some models return empty content with thinking in a separate field:
    // - qwen3: "reasoning"
    // - DeepSeek V3: "reasoning_content"
    const extra = msg as unknown as Record<string, string>;
    const text =
      msg.content || extra.reasoning_content || extra.reasoning || "";
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
