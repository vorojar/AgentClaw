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

const EXTRACTION_PROMPT = `从对话中提取值得永久记住的用户信息。极度精简，只提取长期有价值的。

类型：
- fact: 用户的持久事实（邮箱、年龄、住址、公司）
- preference: 用户偏好和习惯
- entity: 用户生活中的重要人物、项目、系统
- episodic: 从失败/成功中学到的经验教训

输出 JSON 数组：{"type": "fact|preference|entity|episodic", "content": "...", "importance": 0.0-1.0}
无内容则返回：[]

禁止提取：
- 一次性操作（截图、打开网页、发文件）
- 工具执行细节（文件路径、命令输出）
- 助手自身的行为和能力
- 系统/框架/工具的实现细节
- 未来对话中用不到的信息

用中文写 content。`;

export class MemoryExtractor {
  private provider: LLMProvider;
  private memoryStore: MemoryStore;

  constructor(options: { provider: LLMProvider; memoryStore: MemoryStore }) {
    this.provider = options.provider;
    this.memoryStore = options.memoryStore;
  }

  /**
   * Extract memories from recent conversation turns.
   * Existing memories are provided so the LLM can avoid duplicates.
   */
  private async extractFromTurns(
    turns: ConversationTurn[],
    existingMemories: string[],
  ): Promise<ExtractedMemory[]> {
    if (turns.length === 0) return [];

    // Build conversation text for the LLM
    const conversationText = turns
      .filter((t) => t.role === "user" || t.role === "assistant")
      .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`)
      .join("\n");

    if (conversationText.trim().length < 20) return [];

    const existingSection =
      existingMemories.length > 0
        ? "\n\n已有记忆（不要提取重复或换种说法的）：\n" +
          existingMemories.join("\n") +
          "\n"
        : "";

    try {
      const response = await this.provider.chat({
        messages: [
          {
            id: generateId(),
            role: "user",
            content:
              EXTRACTION_PROMPT +
              existingSection +
              "\n对话：\n" +
              conversationText,
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

    // Load existing memories so LLM can see what's already stored
    const existingResults = await this.memoryStore.search({ limit: 50 });
    const existingMemories = existingResults.map(
      (r) => `- [${r.entry.type}] ${r.entry.content}`,
    );

    const extracted = await this.extractFromTurns(turns, existingMemories);
    let stored = 0;

    for (const memory of extracted) {
      // Semantic dedup: skip if a similar memory already exists (cross-type)
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
