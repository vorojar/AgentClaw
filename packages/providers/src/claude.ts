import Anthropic from "@anthropic-ai/sdk";
import type {
  LLMRequest,
  LLMResponse,
  LLMStreamChunk,
  ModelInfo,
  Message,
  ContentBlock,
  ToolDefinition,
} from "@agentclaw/types";
import { BaseLLMProvider, generateId } from "./base.js";

/** Remove lone surrogates that break Claude API JSON parsing */
function sanitize(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    "\uFFFD",
  );
}

/**
 * Claude (Anthropic) LLM Provider.
 */
export class ClaudeProvider extends BaseLLMProvider {
  readonly name = "claude";
  readonly models: ModelInfo[] = [
    {
      id: "claude-sonnet-4-20250514",
      provider: "claude",
      name: "Claude Sonnet 4",
      tier: "flagship",
      contextWindow: 200_000,
      supportsTools: true,
      supportsStreaming: true,
      costPer1kInput: 0.003,
      costPer1kOutput: 0.015,
    },
    {
      id: "claude-haiku-4-20250414",
      provider: "claude",
      name: "Claude Haiku 4",
      tier: "fast",
      contextWindow: 200_000,
      supportsTools: true,
      supportsStreaming: true,
      costPer1kInput: 0.0008,
      costPer1kOutput: 0.004,
    },
  ];

  private client: Anthropic;
  private defaultModel: string;

  constructor(options: { apiKey?: string; defaultModel?: string } = {}) {
    super();
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.defaultModel = options.defaultModel ?? this.models[0].id;
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model ?? this.defaultModel;
    const params = this.buildParams(request, model);

    const response = await this.client.messages.create(params);

    const contentBlocks = this.convertResponseContent(response.content);
    const { input_tokens: tokensIn, output_tokens: tokensOut } = response.usage;
    const rawUsage = response.usage as unknown as Record<string, number>;
    const cacheCreationTokens =
      rawUsage.cache_creation_input_tokens || undefined;
    const cacheReadTokens = rawUsage.cache_read_input_tokens || undefined;

    const message: Message = {
      id: generateId(),
      role: "assistant",
      content: contentBlocks,
      createdAt: new Date(),
      model,
      tokensIn,
      tokensOut,
      cacheCreationTokens,
      cacheReadTokens,
    };

    return {
      message,
      model,
      tokensIn,
      tokensOut,
      stopReason: this.mapStopReason(response.stop_reason),
    };
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
    const model = request.model ?? this.defaultModel;
    const params = this.buildParams(request, model);

    const stream = this.client.messages.stream(params);

    let tokensIn = 0;
    let tokensOut = 0;
    let cacheCreationTokens = 0;
    let cacheReadTokens = 0;
    let stopReason: string | null = null;

    for await (const event of stream) {
      const ev = event as unknown as Record<string, unknown>;

      switch (event.type) {
        case "message_start": {
          const usage = (ev.message as Record<string, unknown>)?.usage as
            | Record<string, number>
            | undefined;
          if (usage) {
            tokensIn = usage.input_tokens ?? 0;
            tokensOut = usage.output_tokens ?? 0;
            cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;
            cacheReadTokens = usage.cache_read_input_tokens ?? 0;
          }
          break;
        }
        case "message_delta": {
          const usage = ev.usage as Record<string, number> | undefined;
          if (usage?.output_tokens) tokensOut = usage.output_tokens;
          const delta = ev.delta as Record<string, string> | undefined;
          if (delta?.stop_reason) stopReason = delta.stop_reason;
          break;
        }
        case "content_block_start": {
          const block = event.content_block;
          if (block.type === "tool_use") {
            yield {
              type: "tool_use_start",
              toolUse: { id: block.id, name: block.name, input: "" },
            };
          }
          break;
        }
        case "content_block_delta": {
          const delta = event.delta;
          if (delta.type === "text_delta") {
            yield { type: "text", text: delta.text };
          } else if (delta.type === "input_json_delta") {
            yield {
              type: "tool_use_delta",
              toolUse: { id: "", name: "", input: delta.partial_json },
            };
          }
          break;
        }
        case "message_stop":
          yield {
            type: "done",
            usage: {
              tokensIn,
              tokensOut,
              cacheCreationTokens: cacheCreationTokens || undefined,
              cacheReadTokens: cacheReadTokens || undefined,
            },
            model,
            stopReason: this.mapStopReason(stopReason),
          };
          break;
      }
    }
  }

  // ---- Internal helpers ----

  /** Build shared params for both chat() and stream(). */
  private buildParams(
    request: LLMRequest,
    model: string,
  ): Anthropic.MessageCreateParamsNonStreaming {
    const messages = this.convertMessages(request.messages);
    const tools = request.tools ? this.convertTools(request.tools) : undefined;

    return {
      model,
      max_tokens: request.maxTokens ?? 4096,
      messages,
      ...(request.systemPrompt
        ? {
            system: [
              {
                type: "text" as const,
                text: sanitize(request.systemPrompt),
                cache_control: { type: "ephemeral" as const },
              },
            ],
          }
        : {}),
      ...(tools && tools.length > 0 ? { tools } : {}),
      ...(request.temperature != null
        ? { temperature: request.temperature }
        : {}),
      ...(request.stopSequences
        ? { stop_sequences: request.stopSequences }
        : {}),
    };
  }

  private convertMessages(messages: Message[]): Anthropic.MessageParam[] {
    const result: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      // Skip system messages — they are passed via the system param
      if (msg.role === "system") continue;

      if (msg.role === "user" || msg.role === "assistant") {
        result.push({
          role: msg.role,
          content: this.convertContent(msg.content),
        });
      } else if (msg.role === "tool") {
        result.push({
          role: "user",
          content: this.convertContent(
            msg.content,
          ) as Anthropic.ToolResultBlockParam[],
        });
      }
    }

    return result;
  }

  private convertContent(
    content: string | ContentBlock[],
  ): string | Anthropic.ContentBlockParam[] {
    if (typeof content === "string") {
      return sanitize(content);
    }

    const blocks: Anthropic.ContentBlockParam[] = [];

    for (const block of content) {
      switch (block.type) {
        case "text":
          blocks.push({ type: "text", text: sanitize(block.text) });
          break;
        case "tool_use":
          blocks.push({
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: block.input,
          });
          break;
        case "image":
          blocks.push({
            type: "image",
            source: {
              type: "base64",
              media_type: block.mediaType as
                | "image/jpeg"
                | "image/png"
                | "image/gif"
                | "image/webp",
              data: block.data,
            },
          });
          break;
        case "tool_result":
          blocks.push({
            type: "tool_result",
            tool_use_id: block.toolUseId,
            content: sanitize(block.content),
            ...(block.isError ? { is_error: true } : {}),
          });
          break;
      }
    }

    return blocks;
  }

  private convertTools(tools: ToolDefinition[]): Anthropic.Tool[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: "object" as const,
        properties: t.parameters.properties as Record<string, unknown>,
        ...(t.parameters.required ? { required: t.parameters.required } : {}),
      },
    }));
  }

  private convertResponseContent(
    content: Anthropic.ContentBlock[],
  ): ContentBlock[] {
    const blocks: ContentBlock[] = [];

    for (const block of content) {
      if (block.type === "text") {
        blocks.push({ type: "text", text: block.text });
      } else if (block.type === "tool_use") {
        blocks.push({
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
      // Skip thinking / redacted_thinking blocks
    }

    return blocks;
  }

  private mapStopReason(reason: string | null): LLMResponse["stopReason"] {
    switch (reason) {
      case "tool_use":
        return "tool_use";
      case "max_tokens":
        return "max_tokens";
      case "stop_sequence":
        return "stop_sequence";
      default:
        return "end_turn";
    }
  }
}
