/** JSON Schema for tool parameters */
export interface ToolParameterSchema {
  type: "object";
  properties: Record<
    string,
    {
      type: string;
      description?: string;
      enum?: string[];
      default?: unknown;
      items?: { type: string };
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
  /** Signal agent-loop to skip next LLM call and auto-complete the response */
  autoComplete?: boolean;
}

/** Tool categories */
export type ToolCategory = "builtin" | "external" | "mcp";

/** Execution context passed through the call chain to tools */
export interface ToolExecutionContext {
  /** Ask the user a question and wait for their answer (implemented by gateway) */
  promptUser?: (question: string) => Promise<string>;
  /** Send a notification to the user (fire-and-forget, for reminders etc.) */
  notifyUser?: (message: string) => Promise<void>;
  /** Stream a text chunk directly into the user's chat bubble (bypasses outer LLM) */
  streamText?: (text: string) => void;
  /** Send a file to the user (implemented by gateway) */
  sendFile?: (filePath: string, caption?: string) => Promise<void>;
  /** Files sent during tool execution (populated by sendFile, consumed by agent-loop for persistence) */
  sentFiles?: Array<{ url: string; filename: string }>;
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
      oneShot?: boolean;
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
  /** Skill registry for use_skill tool */
  skillRegistry?: {
    get(id: string): { name: string; instructions: string } | undefined;
    list(): Array<{
      id: string;
      name: string;
      description: string;
      enabled: boolean;
    }>;
  };
  /** Spawn an independent sub-agent to handle a subtask */
  delegateTask?: (task: string) => Promise<string>;
  /** Pre-selected skill name from UI chips — inject instructions directly, skip use_skill round */
  preSelectedSkillName?: string;
  /** Planner for decomposing complex tasks into executable steps */
  planner?: {
    createPlan(
      goal: string,
      context?: string,
    ): Promise<{
      id: string;
      goal: string;
      steps: Array<{ id: string; description: string; status: string }>;
    }>;
    executeNext(planId: string): Promise<
      Array<{
        id: string;
        description: string;
        status: string;
        result?: string;
        error?: string;
      }>
    >;
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
