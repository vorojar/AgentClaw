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
    const messages = this.convertMessages(request.messages);
    const tools = request.tools ? this.convertTools(request.tools) : undefined;

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: request.maxTokens ?? 4096,
      messages,
      ...(request.systemPrompt ? { system: request.systemPrompt } : {}),
      ...(tools && tools.length > 0 ? { tools } : {}),
      ...(request.temperature != null
        ? { temperature: request.temperature }
        : {}),
      ...(request.stopSequences
        ? { stop_sequences: request.stopSequences }
        : {}),
    };

    const response = await this.client.messages.create(params);

    const contentBlocks = this.convertResponseContent(response.content);

    const message: Message = {
      id: generateId(),
      role: "assistant",
      content: contentBlocks,
      createdAt: new Date(),
      model,
      tokensIn: response.usage.input_tokens,
      tokensOut: response.usage.output_tokens,
    };

    return {
      message,
      model,
      tokensIn: response.usage.input_tokens,
      tokensOut: response.usage.output_tokens,
      stopReason: this.mapStopReason(response.stop_reason),
    };
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
    const model = request.model ?? this.defaultModel;
    const messages = this.convertMessages(request.messages);
    const tools = request.tools ? this.convertTools(request.tools) : undefined;

    const params: Anthropic.MessageCreateParamsStreaming = {
      model,
      max_tokens: request.maxTokens ?? 4096,
      messages,
      stream: true,
      ...(request.systemPrompt ? { system: request.systemPrompt } : {}),
      ...(tools && tools.length > 0 ? { tools } : {}),
      ...(request.temperature != null
        ? { temperature: request.temperature }
        : {}),
      ...(request.stopSequences
        ? { stop_sequences: request.stopSequences }
        : {}),
    };

    const stream = this.client.messages.stream(params);

    let tokensIn = 0;
    let tokensOut = 0;

    for await (const event of stream) {
      if (event.type === "message_start") {
        const msg = (
          event as unknown as {
            message?: {
              usage?: { input_tokens?: number; output_tokens?: number };
            };
          }
        ).message;
        if (msg?.usage) {
          tokensIn = msg.usage.input_tokens ?? 0;
          tokensOut = msg.usage.output_tokens ?? 0;
        }
      } else if (event.type === "message_delta") {
        const delta = event as unknown as {
          usage?: { output_tokens?: number };
        };
        if (delta.usage?.output_tokens) {
          tokensOut = delta.usage.output_tokens;
        }
      } else if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block.type === "text") {
          // text block start — nothing to yield yet
        } else if (block.type === "tool_use") {
          yield {
            type: "tool_use_start",
            toolUse: {
              id: block.id,
              name: block.name,
              input: "",
            },
          };
        }
      } else if (event.type === "content_block_delta") {
        const delta = event.delta;
        if (delta.type === "text_delta") {
          yield { type: "text", text: delta.text };
        } else if (delta.type === "input_json_delta") {
          yield {
            type: "tool_use_delta",
            toolUse: {
              id: "",
              name: "",
              input: delta.partial_json,
            },
          };
        }
      } else if (event.type === "content_block_stop") {
        // Could be end of text or tool_use — emit tool_use_end if needed
      } else if (event.type === "message_stop") {
        yield {
          type: "done",
          usage: { tokensIn, tokensOut },
          model,
        };
      }
    }
  }

  // ---- Internal conversion helpers ----

  private convertMessages(messages: Message[]): Anthropic.MessageParam[] {
    const result: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      // Skip system messages — they are passed via the system param
      if (msg.role === "system") continue;

      if (msg.role === "user" || msg.role === "assistant") {
        const content = this.convertContent(msg.content, msg.role);
        result.push({
          role: msg.role,
          content,
        });
      } else if (msg.role === "tool") {
        // Tool results go into a "user" message in Anthropic's API
        const blocks = this.convertContent(msg.content, "tool");
        result.push({
          role: "user",
          content: blocks as Anthropic.ToolResultBlockParam[],
        });
      }
    }

    return result;
  }

  private convertContent(
    content: string | ContentBlock[],
    role: string,
  ): string | Anthropic.ContentBlockParam[] {
    if (typeof content === "string") {
      return content;
    }

    const blocks: Anthropic.ContentBlockParam[] = [];

    for (const block of content) {
      switch (block.type) {
        case "text":
          blocks.push({ type: "text", text: block.text });
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
            content: block.content,
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
