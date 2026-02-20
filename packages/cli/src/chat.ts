import * as readline from "node:readline";
import * as path from "node:path";
import type { LLMProvider, AgentEvent } from "@agentclaw/types";
import {
  SimpleOrchestrator,
  SkillRegistryImpl,
  MemoryExtractor,
} from "@agentclaw/core";
import { ToolRegistryImpl, createBuiltinTools } from "@agentclaw/tools";
import { initDatabase, SQLiteMemoryStore } from "@agentclaw/memory";

export interface ChatOptions {
  provider: LLMProvider;
  model?: string;
  databasePath: string;
  skillsDir?: string;
}

export async function startChat(options: ChatOptions): Promise<void> {
  // Initialize memory
  const db = initDatabase(options.databasePath);
  const memoryStore = new SQLiteMemoryStore(db);

  // Wire up LLM embed function if provider supports it
  if (options.provider.embed) {
    const provider = options.provider;
    memoryStore.setEmbedFn((texts) => provider.embed!(texts));
  }

  // Initialize tools (built-in)
  const toolRegistry = new ToolRegistryImpl();
  for (const tool of createBuiltinTools()) {
    toolRegistry.register(tool);
  }

  // Initialize skill system
  const skillRegistry = new SkillRegistryImpl();
  const skillsDir = options.skillsDir ?? path.resolve(process.cwd(), "skills");
  await skillRegistry.loadFromDirectory(skillsDir);

  // Initialize memory extractor (runs periodically to extract long-term memories)
  const memoryExtractor = new MemoryExtractor({
    provider: options.provider,
    memoryStore,
  });

  // Initialize orchestrator
  const orchestrator = new SimpleOrchestrator({
    provider: options.provider,
    toolRegistry,
    memoryStore,
    systemPrompt: undefined, // use default
  });

  // Create a session
  const session = await orchestrator.createSession();

  // Track turn count for periodic memory extraction
  let turnCount = 0;
  const EXTRACT_EVERY_N_TURNS = 5;

  // Setup readline
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr, // use stderr for prompts so stdout stays clean
    terminal: true,
  });

  const skills = skillRegistry.list();
  console.log("🦀 AgentClaw v0.2.0");
  console.log(`   Provider: ${options.provider.name}`);
  console.log(
    `   Tools: ${toolRegistry
      .list()
      .map((t) => t.name)
      .join(", ")}`,
  );
  if (skills.length > 0) {
    console.log(`   Skills: ${skills.map((s) => s.name).join(", ")}`);
  }
  console.log('   Type "exit" or Ctrl+C to quit.\n');

  const prompt = (): void => {
    rl.question("You > ", async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      if (
        trimmed.toLowerCase() === "exit" ||
        trimmed.toLowerCase() === "quit"
      ) {
        console.log("\nBye! 👋");
        rl.close();
        db.close();
        return;
      }

      try {
        // Match skills for this input
        const skillMatches = await skillRegistry.match(trimmed);
        const activeSkill =
          skillMatches.length > 0 && skillMatches[0].confidence > 0.2
            ? skillMatches[0].skill
            : null;

        if (activeSkill) {
          process.stderr.write(`   [Skill: ${activeSkill.name}]\n`);
        }

        process.stdout.write("\nAgentClaw > ");

        const response = await orchestrator.processInput(session.id, trimmed);

        // Extract text from response
        let text: string;
        if (typeof response.content === "string") {
          text = response.content;
        } else {
          text = response.content
            .filter((b) => b.type === "text")
            .map((b) => (b as { text: string }).text)
            .join("");
        }

        process.stdout.write(text + "\n\n");

        // Periodic memory extraction (background, non-blocking)
        turnCount++;
        if (turnCount % EXTRACT_EVERY_N_TURNS === 0) {
          memoryExtractor
            .processConversation(session.conversationId, 10)
            .then((count) => {
              if (count > 0) {
                process.stderr.write(
                  `   [Memory: extracted ${count} new memories]\n`,
                );
              }
            })
            .catch(() => {
              /* silently ignore extraction errors */
            });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`\n❌ Error: ${message}\n`);
      }

      prompt();
    });
  };

  prompt();

  // Handle Ctrl+C
  rl.on("close", () => {
    db.close();
    process.exit(0);
  });
}
