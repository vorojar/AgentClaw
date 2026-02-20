import { GoogleGenAI } from "@google/genai";
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

/**
 * Google Gemini LLM Provider.
 * Uses the latest @google/genai SDK.
 */
export class GeminiProvider extends BaseLLMProvider {
  readonly name = "gemini";
  readonly models: ModelInfo[] = [
    {
      id: "gemini-2.5-flash",
      provider: "gemini",
      name: "Gemini 2.5 Flash",
      tier: "flagship",
      contextWindow: 1_000_000,
      supportsTools: true,
      supportsStreaming: true,
      costPer1kInput: 0.00015,
      costPer1kOutput: 0.0006,
    },
    {
      id: "gemini-2.0-flash",
      provider: "gemini",
      name: "Gemini 2.0 Flash",
      tier: "fast",
      contextWindow: 1_000_000,
      supportsTools: true,
      supportsStreaming: true,
      costPer1kInput: 0.0001,
      costPer1kOutput: 0.0004,
    },
  ];

  private client: GoogleGenAI;
  private defaultModel: string;

  constructor(options: { apiKey?: string; defaultModel?: string } = {}) {
    super();
    this.client = new GoogleGenAI({ apiKey: options.apiKey ?? "" });
    this.defaultModel = options.defaultModel ?? this.models[0].id;
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model ?? this.defaultModel;
    const contents = this.convertMessages(request.messages);
    const tools = request.tools ? this.convertTools(request.tools) : undefined;

    const response = await this.client.models.generateContent({
      model,
      contents,
      config: {
        ...(request.systemPrompt
          ? { systemInstruction: request.systemPrompt }
          : {}),
        ...(tools ? { tools } : {}),
        ...(request.temperature != null
          ? { temperature: request.temperature }
          : {}),
        ...(request.maxTokens != null
          ? { maxOutputTokens: request.maxTokens }
          : {}),
        ...(request.stopSequences
          ? { stopSequences: request.stopSequences }
          : {}),
      },
    });

    const contentBlocks = this.convertResponseParts(
      response.candidates?.[0]?.content?.parts ?? [],
    );

    const hasToolUse = contentBlocks.some((b) => b.type === "tool_use");
    const finishReason = response.candidates?.[0]?.finishReason;

    const tokensIn = response.usageMetadata?.promptTokenCount ?? 0;
    const tokensOut = response.usageMetadata?.candidatesTokenCount ?? 0;

    const message: Message = {
      id: generateId(),
      role: "assistant",
      content: contentBlocks,
      createdAt: new Date(),
      model,
      tokensIn,
      tokensOut,
    };

    return {
      message,
      model,
      tokensIn,
      tokensOut,
      stopReason: hasToolUse ? "tool_use" : this.mapFinishReason(finishReason),
    };
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
    const model = request.model ?? this.defaultModel;
    const contents = this.convertMessages(request.messages);
    const tools = request.tools ? this.convertTools(request.tools) : undefined;

    const response = await this.client.models.generateContentStream({
      model,
      contents,
      config: {
        ...(request.systemPrompt
          ? { systemInstruction: request.systemPrompt }
          : {}),
        ...(tools ? { tools } : {}),
        ...(request.temperature != null
          ? { temperature: request.temperature }
          : {}),
        ...(request.maxTokens != null
          ? { maxOutputTokens: request.maxTokens }
          : {}),
        ...(request.stopSequences
          ? { stopSequences: request.stopSequences }
          : {}),
      },
    });

    for await (const chunk of response) {
      const parts = chunk.candidates?.[0]?.content?.parts ?? [];

      for (const part of parts) {
        if (part.text) {
          yield { type: "text", text: part.text };
        }

        if (part.functionCall) {
          yield {
            type: "tool_use_start",
            toolUse: {
              id: generateId(),
              name: part.functionCall.name ?? "",
              input: JSON.stringify(part.functionCall.args ?? {}),
            },
          };
          yield { type: "tool_use_end" };
        }
      }
    }

    yield { type: "done" };
  }

  // ---- Internal conversion helpers ----

  private convertMessages(
    messages: Message[],
  ): Array<{ role: string; parts: Array<Record<string, unknown>> }> {
    const result: Array<{
      role: string;
      parts: Array<Record<string, unknown>>;
    }> = [];

    for (const msg of messages) {
      // System messages are handled via systemInstruction config
      if (msg.role === "system") continue;

      if (msg.role === "user") {
        result.push({
          role: "user",
          parts: this.convertContentToParts(msg.content),
        });
      } else if (msg.role === "assistant") {
        result.push({
          role: "model",
          parts: this.convertContentToParts(msg.content),
        });
      } else if (msg.role === "tool") {
        // Tool results go as "user" role with functionResponse parts
        const parts = this.convertToolResultParts(msg.content);
        result.push({ role: "user", parts });
      }
    }

    return result;
  }

  private convertContentToParts(
    content: string | ContentBlock[],
  ): Array<Record<string, unknown>> {
    if (typeof content === "string") {
      return [{ text: content }];
    }

    const parts: Array<Record<string, unknown>> = [];

    for (const block of content) {
      switch (block.type) {
        case "text":
          parts.push({ text: block.text });
          break;
        case "tool_use":
          parts.push({
            functionCall: {
              name: block.name,
              args: block.input,
            },
          });
          break;
        case "tool_result":
          parts.push({
            functionResponse: {
              name: block.toolUseId,
              response: { content: block.content },
            },
          });
          break;
      }
    }

    return parts;
  }

  private convertToolResultParts(
    content: string | ContentBlock[],
  ): Array<Record<string, unknown>> {
    if (typeof content === "string") {
      return [{ functionResponse: { name: "unknown", response: { content } } }];
    }

    return content
      .filter((b): b is ToolResultContent => b.type === "tool_result")
      .map((b) => ({
        functionResponse: {
          name: b.toolUseId,
          response: { content: b.content },
        },
      }));
  }

  private convertTools(
    tools: ToolDefinition[],
  ): Array<{ functionDeclarations: Array<Record<string, unknown>> }> {
    return [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: {
            type: "OBJECT",
            properties: Object.fromEntries(
              Object.entries(t.parameters.properties).map(([k, v]) => [
                k,
                {
                  type: v.type.toUpperCase(),
                  description: v.description,
                  ...(v.enum ? { enum: v.enum } : {}),
                },
              ]),
            ),
            ...(t.parameters.required
              ? { required: t.parameters.required }
              : {}),
          },
        })),
      },
    ];
  }

  private convertResponseParts(
    parts: Array<{
      text?: string;
      functionCall?: { name?: string; args?: Record<string, unknown> };
    }>,
  ): ContentBlock[] {
    const blocks: ContentBlock[] = [];

    for (const part of parts) {
      if (part.text) {
        blocks.push({ type: "text", text: part.text });
      }
      if (part.functionCall) {
        blocks.push({
          type: "tool_use",
          id: generateId(),
          name: part.functionCall.name ?? "",
          input: (part.functionCall.args ?? {}) as Record<string, unknown>,
        });
      }
    }

    return blocks;
  }

  private mapFinishReason(
    reason: string | undefined,
  ): LLMResponse["stopReason"] {
    switch (reason) {
      case "MAX_TOKENS":
        return "max_tokens";
      case "STOP":
        return "end_turn";
      default:
        return "end_turn";
    }
  }
}
