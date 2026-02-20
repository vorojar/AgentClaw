import type { ContextManager, Message, MemoryStore } from "@agentclaw/types";

const DEFAULT_SYSTEM_PROMPT = `You are AgentClaw, a powerful AI assistant and intelligent dispatch center. You understand user intent, plan tasks, and use tools to accomplish goals.

When you need to perform an action, use the available tools. Always think step by step.

Respond in the same language the user uses.`;

export class SimpleContextManager implements ContextManager {
  private systemPrompt: string;
  private memoryStore: MemoryStore;
  private maxHistoryTurns: number;

  constructor(options: {
    systemPrompt?: string;
    memoryStore: MemoryStore;
    maxHistoryTurns?: number;
  }) {
    this.systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.memoryStore = options.memoryStore;
    this.maxHistoryTurns = options.maxHistoryTurns ?? 50;
  }

  async buildContext(
    conversationId: string,
    _currentInput: string,
  ): Promise<{ systemPrompt: string; messages: Message[] }> {
    // Get conversation history
    const turns = await this.memoryStore.getHistory(
      conversationId,
      this.maxHistoryTurns,
    );

    // Convert turns to Messages
    const messages: Message[] = turns.map((turn) => ({
      id: turn.id,
      role: turn.role,
      content: turn.content,
      createdAt: turn.createdAt,
      model: turn.model,
    }));

    return {
      systemPrompt: this.systemPrompt,
      messages,
    };
  }
}
