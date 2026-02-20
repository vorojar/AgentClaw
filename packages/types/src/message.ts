/** Role of a message participant */
export type MessageRole = "user" | "assistant" | "system" | "tool";

/** Content block types */
export interface TextContent {
  type: "text";
  text: string;
}

export interface ToolUseContent {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultContent {
  type: "tool_result";
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export type ContentBlock = TextContent | ToolUseContent | ToolResultContent;

/** A single message in a conversation */
export interface Message {
  id: string;
  role: MessageRole;
  content: string | ContentBlock[];
  createdAt: Date;
  /** Model that generated this message (for assistant messages) */
  model?: string;
  /** Token usage */
  tokensIn?: number;
  tokensOut?: number;
}

/** A conversation session */
export interface Conversation {
  id: string;
  title?: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
}

/** Options for creating a new message */
export interface CreateMessageOptions {
  role: MessageRole;
  content: string | ContentBlock[];
  model?: string;
}
