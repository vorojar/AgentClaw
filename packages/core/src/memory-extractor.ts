/**
 * MemoryExtractor — uses LLM to extract long-term memories from conversations.
 *
 * Analyzes conversation turns and extracts:
 *  - facts: concrete information the user shared
 *  - preferences: user likes, dislikes, habits
 *  - entities: people, projects, tools the user mentioned
 *  - episodic: lessons learned, task outcomes
 */
import type {
  LLMProvider,
  MemoryStore,
  MemoryType,
  ConversationTurn,
} from "@agentclaw/types";
import { generateId } from "@agentclaw/providers";

interface ExtractedMemory {
  type: MemoryType;
  content: string;
  importance: number;
}

const EXTRACTION_PROMPT = `Analyze the following conversation excerpt and extract important information to remember long-term. For each piece of information, classify it and rate its importance (0.0-1.0).

Categories:
- fact: concrete information (e.g. "User's project uses TypeScript", "API endpoint is /api/v2")
- preference: user preferences (e.g. "User prefers dark mode", "User wants responses in Chinese")
- entity: people, projects, tools mentioned (e.g. "Project: AgentClaw", "Tool: Ollama")
- episodic: task outcomes, lessons learned (e.g. "sqlite-vec doesn't work well on Windows")

Return a JSON array of extracted memories. Each item:
{"type": "fact|preference|entity|episodic", "content": "...", "importance": 0.0-1.0}

If nothing worth remembering, return an empty array: []

IMPORTANT: Only extract genuinely useful long-term information. Skip greetings, small talk, and trivial exchanges. Be selective — quality over quantity.

Conversation:
`;

export class MemoryExtractor {
  private provider: LLMProvider;
  private memoryStore: MemoryStore;

  constructor(options: { provider: LLMProvider; memoryStore: MemoryStore }) {
    this.provider = options.provider;
    this.memoryStore = options.memoryStore;
  }

  /**
   * Extract memories from recent conversation turns.
   * Call this periodically (e.g. every N turns) to build long-term memory.
   */
  async extractFromTurns(
    turns: ConversationTurn[],
  ): Promise<ExtractedMemory[]> {
    if (turns.length === 0) return [];

    // Build conversation text for the LLM
    const conversationText = turns
      .filter((t) => t.role === "user" || t.role === "assistant")
      .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`)
      .join("\n");

    if (conversationText.trim().length < 20) return [];

    try {
      const response = await this.provider.chat({
        messages: [
          {
            id: generateId(),
            role: "user",
            content: EXTRACTION_PROMPT + conversationText,
            createdAt: new Date(),
          },
        ],
        systemPrompt:
          "You are a memory extraction assistant. Always respond with valid JSON only. No markdown, no explanation — just the JSON array.",
        temperature: 0.1,
        maxTokens: 1024,
      });

      // Extract text from response
      let text: string;
      if (typeof response.message.content === "string") {
        text = response.message.content;
      } else {
        text = response.message.content
          .filter((b) => b.type === "text")
          .map((b) => (b as { text: string }).text)
          .join("");
      }

      // Parse JSON from response (handle markdown code blocks)
      text = text
        .replace(/```json?\s*/g, "")
        .replace(/```\s*/g, "")
        .trim();
      const memories: ExtractedMemory[] = JSON.parse(text);

      if (!Array.isArray(memories)) return [];

      // Validate and clamp
      return memories
        .filter(
          (m) =>
            m.type &&
            m.content &&
            ["fact", "preference", "entity", "episodic"].includes(m.type),
        )
        .map((m) => ({
          type: m.type as MemoryType,
          content: m.content,
          importance: Math.max(0, Math.min(1, m.importance ?? 0.5)),
        }));
    } catch {
      // LLM call or JSON parse failed — skip silently
      return [];
    }
  }

  /**
   * Extract and store memories from a conversation.
   * Returns the number of new memories stored.
   */
  async processConversation(
    conversationId: string,
    recentTurnsCount = 10,
  ): Promise<number> {
    const turns = await this.memoryStore.getHistory(
      conversationId,
      recentTurnsCount,
    );

    const extracted = await this.extractFromTurns(turns);
    let stored = 0;

    for (const memory of extracted) {
      // Check for duplicates (simple text match)
      const existing = await this.memoryStore.search({
        query: memory.content,
        type: memory.type,
        limit: 1,
      });

      if (
        existing.length > 0 &&
        existing[0].entry.content.toLowerCase() === memory.content.toLowerCase()
      ) {
        // Update importance if higher
        if (memory.importance > existing[0].entry.importance) {
          await this.memoryStore.update(existing[0].entry.id, {
            importance: memory.importance,
          });
        }
        continue;
      }

      await this.memoryStore.add({
        type: memory.type,
        content: memory.content,
        importance: memory.importance,
        sourceTurnId: turns[turns.length - 1]?.id,
      });
      stored++;
    }

    return stored;
  }
}
