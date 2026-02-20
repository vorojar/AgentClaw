import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMStreamChunk,
  ModelInfo,
} from "@agentclaw/types";

/** Generate a unique ID (simple, no dependencies) */
export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Base abstract class for all LLM providers.
 * Implements common logic; subclasses provide API-specific behavior.
 */
export abstract class BaseLLMProvider implements LLMProvider {
  abstract readonly name: string;
  abstract readonly models: ModelInfo[];

  abstract chat(request: LLMRequest): Promise<LLMResponse>;
  abstract stream(request: LLMRequest): AsyncIterable<LLMStreamChunk>;

  /** Find a model by id, or return the first model as default */
  protected resolveModel(modelId?: string): ModelInfo {
    if (modelId) {
      const found = this.models.find((m) => m.id === modelId);
      if (found) return found;
    }
    return this.models[0];
  }

  /** Helper: extract plain text from a content value */
  protected extractText(content: string | unknown[]): string {
    if (typeof content === "string") return content;
    return (content as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text!)
      .join("");
  }
}
