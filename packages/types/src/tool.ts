/** JSON Schema for tool parameters */
export interface ToolParameterSchema {
  type: "object";
  properties: Record<
    string,
    {
      type: string;
      description: string;
      enum?: string[];
      default?: unknown;
    }
  >;
  required?: string[];
}

/** Tool definition — describes a tool's interface */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
}

/** Result of a tool execution */
export interface ToolResult {
  content: string;
  isError?: boolean;
  metadata?: Record<string, unknown>;
}

/** Tool categories */
export type ToolCategory = "builtin" | "external" | "mcp";

/** Execution context passed through the call chain to tools */
export interface ToolExecutionContext {
  /** Ask the user a question and wait for their answer (implemented by gateway) */
  promptUser?: (question: string) => Promise<string>;
  /** Send a notification to the user (fire-and-forget, for reminders etc.) */
  notifyUser?: (message: string) => Promise<void>;
  /** Send a file to the user (implemented by gateway) */
  sendFile?: (filePath: string, caption?: string) => Promise<void>;
  /** Save a piece of information to long-term memory (provided by orchestrator) */
  saveMemory?: (
    content: string,
    type?: "fact" | "preference" | "entity" | "episodic",
  ) => Promise<void>;
  /** Task scheduler for recurring tasks (provided by orchestrator) */
  scheduler?: {
    create(input: {
      name: string;
      cron: string;
      action: string;
      enabled: boolean;
    }): { id: string; name: string; nextRunAt?: Date };
    list(): Array<{
      id: string;
      name: string;
      cron: string;
      action: string;
      enabled: boolean;
      nextRunAt?: Date;
      lastRunAt?: Date;
    }>;
    delete(id: string): boolean;
  };
}

/** A tool that can be executed */
export interface Tool extends ToolDefinition {
  category: ToolCategory;
  execute(
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult>;
}

/** Tool registry — manages available tools */
export interface ToolRegistry {
  /** Register a tool */
  register(tool: Tool): void;

  /** Unregister a tool */
  unregister(name: string): void;

  /** Get a tool by name */
  get(name: string): Tool | undefined;

  /** List all registered tools */
  list(): Tool[];

  /** List tool definitions (for LLM) */
  definitions(): ToolDefinition[];

  /** Execute a tool by name */
  execute(
    name: string,
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult>;
}

/** MCP Server connection configuration */
export interface MCPServerConfig {
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}
