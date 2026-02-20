import type { MCPServerConfig } from "./tool.js";

/** Provider-specific configuration */
export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  enabled: boolean;
}

/** LLM routing configuration */
export interface RoutingConfig {
  planning: { provider: string; model: string };
  coding: { provider: string; model: string };
  chat: { provider: string; model: string };
  classification: { provider: string; model: string };
  embedding: { provider: string; model: string };
  summarization: { provider: string; model: string };
}

/** Full application configuration */
export interface AppConfig {
  /** LLM provider configurations */
  providers: {
    claude?: ProviderConfig;
    openai?: ProviderConfig;
    ollama?: ProviderConfig;
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
