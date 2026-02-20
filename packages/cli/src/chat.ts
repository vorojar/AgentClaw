import * as readline from "node:readline";
import type { LLMProvider, AgentEvent } from "@agentclaw/types";
import { SimpleOrchestrator } from "@agentclaw/core";
import { ToolRegistryImpl, createBuiltinTools } from "@agentclaw/tools";
import { initDatabase, SQLiteMemoryStore } from "@agentclaw/memory";

export interface ChatOptions {
  provider: LLMProvider;
  model?: string;
  databasePath: string;
}

export async function startChat(options: ChatOptions): Promise<void> {
  // Initialize memory
  const db = initDatabase(options.databasePath);
  const memoryStore = new SQLiteMemoryStore(db);

  // Initialize tools
  const toolRegistry = new ToolRegistryImpl();
  for (const tool of createBuiltinTools()) {
    toolRegistry.register(tool);
  }

  // Initialize orchestrator
  const orchestrator = new SimpleOrchestrator({
    provider: options.provider,
    toolRegistry,
    memoryStore,
    systemPrompt: undefined, // use default
  });

  // Create a session
  const session = await orchestrator.createSession();

  // Setup readline
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr, // use stderr for prompts so stdout stays clean
    terminal: true,
  });

  console.log("🦀 AgentClaw v0.1.0");
  console.log(`   Provider: ${options.provider.name}`);
  console.log(
    `   Tools: ${toolRegistry
      .list()
      .map((t) => t.name)
      .join(", ")}`,
  );
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
