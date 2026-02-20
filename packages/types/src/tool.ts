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
  /** Save a piece of information to long-term memory (provided by orchestrator) */
  saveMemory?: (
    content: string,
    type?: "fact" | "preference" | "entity" | "episodic",
  ) => Promise<void>;
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
