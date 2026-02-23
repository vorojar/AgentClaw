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

const EXTRACTION_PROMPT = `Analyze the following conversation and extract ONLY information worth remembering permanently. Be extremely selective.

Categories:
- fact: enduring facts about the user or their environment (e.g. "User's name is Alex", "User's project uses TypeScript", "User lives in Beijing")
- preference: user preferences and habits (e.g. "User prefers dark mode", "User wants responses in Chinese", "User likes concise answers")
- entity: important people, projects, or systems in the user's life (e.g. "Project: AgentClaw — a self-hosted AI agent", "User's colleague: Zhang Wei")
- episodic: lessons learned from past failures/successes (e.g. "sqlite-vec doesn't work well on Windows", "chcp 65001 fixes Chinese encoding in cmd.exe")

Return a JSON array. Each item:
{"type": "fact|preference|entity|episodic", "content": "...", "importance": 0.0-1.0}

If nothing worth remembering, return: []

DO NOT extract:
- One-off commands or tasks ("user asked to take a screenshot", "user asked to open a URL")
- Tool execution details (file paths, screen resolutions, command outputs)
- Temporary actions ("user set a reminder", "user sent a file")
- Things the assistant did or said (only extract what reveals something about the USER)
- Anything that would not be useful in a future conversation

GOOD examples: "User's name is 小明", "User prefers to be called 主人", "User's OS is Windows 11"
BAD examples: "User asked to screenshot", "User opened www.example.com", "Reminder was set for 8pm"

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
      // Semantic dedup: skip if a similar memory already exists
      const similar = await this.memoryStore.findSimilar(
        memory.content,
        memory.type,
        0.75,
      );

      if (similar) {
        // Update importance if the new one is higher
        if (memory.importance > similar.entry.importance) {
          await this.memoryStore.update(similar.entry.id, {
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
