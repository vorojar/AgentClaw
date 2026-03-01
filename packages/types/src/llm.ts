import type { Message } from "./message.js";
import type { ToolDefinition } from "./tool.js";

/** Task types for intelligent model routing */
export type TaskType =
  | "planning"
  | "coding"
  | "chat"
  | "classification"
  | "embedding"
  | "summarization";

/** Model capability tier */
export type ModelTier = "flagship" | "standard" | "fast" | "local";

/** Model information */
export interface ModelInfo {
  id: string;
  provider: string;
  name: string;
  tier: ModelTier;
  contextWindow: number;
  supportsTools: boolean;
  supportsStreaming: boolean;
  costPer1kInput?: number;
  costPer1kOutput?: number;
}

/** Request to an LLM provider */
export interface LLMRequest {
  messages: Message[];
  model?: string;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
}

/** Streaming chunk from LLM */
export interface LLMStreamChunk {
  type: "text" | "tool_use_start" | "tool_use_delta" | "tool_use_end" | "done";
  text?: string;
  toolUse?: {
    id: string;
    name: string;
    input: string; // partial JSON
  };
  /** Token usage — present on "done" chunks when the provider supports it */
  usage?: { tokensIn: number; tokensOut: number };
  /** Model ID — present on "done" chunks */
  model?: string;
  /** Stop reason — present on "done" chunks */
  stopReason?: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
}

/** Complete response from LLM */
export interface LLMResponse {
  message: Message;
  model: string;
  tokensIn: number;
  tokensOut: number;
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
}

/** Token usage tracking */
export interface TokenUsage {
  input: number;
  output: number;
  total: number;
  estimatedCost?: number;
}

/** LLM Provider interface — unified API for all providers */
export interface LLMProvider {
  readonly name: string;
  readonly models: ModelInfo[];

  chat(request: LLMRequest): Promise<LLMResponse>;
  stream(request: LLMRequest): AsyncIterable<LLMStreamChunk>;
  embed?(texts: string[]): Promise<number[][]>;
}

/** LLM Router — selects the best model for a given task */
export interface LLMRouter {
  /** Select the best provider and model for a task type */
  route(taskType: TaskType): { provider: LLMProvider; model: string };

  /** Register a provider */
  registerProvider(provider: LLMProvider): void;

  /** Configure routing rules */
  setRoute(taskType: TaskType, providerId: string, modelId: string): void;
}
