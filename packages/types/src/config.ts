import type { MCPServerConfig } from "./tool.js";

/** Provider-specific configuration */
export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  enabled: boolean;
}

/** OpenAI-compatible provider configuration (Kimi, DeepSeek, MiniMax, etc.) */
export interface OpenAICompatibleProviderConfig extends ProviderConfig {
  /** Provider identifier */
  id: string;
  /** Display name */
  name: string;
  /** API base URL (required) */
  baseUrl: string;
}

/** A single routing rule — which provider+model to use */
export interface RouteTarget {
  provider: string;
  model: string;
}

/** LLM routing configuration */
export interface RoutingConfig {
  planning: RouteTarget;
  coding: RouteTarget;
  chat: RouteTarget;
  classification: RouteTarget;
  embedding: RouteTarget;
  summarization: RouteTarget;
}

/** Full application configuration */
export interface AppConfig {
  /** LLM provider configurations */
  providers: {
    claude?: ProviderConfig;
    openai?: ProviderConfig;
    gemini?: ProviderConfig;
    /** OpenAI-compatible providers (Kimi, DeepSeek, MiniMax, Qwen, etc.) */
    openaiCompatible?: OpenAICompatibleProviderConfig[];
  };

  /** Model routing rules */
  routing: RoutingConfig;

  /** Database path */
  databasePath: string;

  /** Gateway settings */
  gateway: {
    port: number;
    host: string;
  };

  /** Skills directory path */
  skillsDir: string;

  /** MCP server configurations */
  mcpServers: MCPServerConfig[];

  /** Agent defaults */
  agent: {
    maxIterations: number;
    defaultTemperature: number;
    maxTokens: number;
    streaming: boolean;
  };
}
