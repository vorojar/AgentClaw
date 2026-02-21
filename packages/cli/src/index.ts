import "dotenv/config";
import { loadConfig, createProvider } from "./config.js";
import { startChat } from "./chat.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  // Handle --help
  if (command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  // Handle --version
  if (command === "--version" || command === "-v") {
    console.log("agentclaw v0.1.0");
    return;
  }

  // Handle --provider flag
  if (args.includes("--provider")) {
    const idx = args.indexOf("--provider");
    if (idx + 1 < args.length) {
      process.env.AGENTCLAW_PROVIDER = args[idx + 1];
    }
  }

  const config = loadConfig();

  let provider;
  try {
    provider = createProvider(config);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ ${message}`);
    console.error(
      "\nSet the appropriate API key environment variable, or use --provider to choose a different provider.",
    );
    console.error(
      "Supported providers: claude, openai, gemini, deepseek, kimi, minimax, qwen, ollama",
    );
    process.exit(1);
  }

  // Default: interactive chat
  await startChat({
    provider,
    model: config.model,
    databasePath: config.databasePath,
  });
}

function printHelp(): void {
  console.log(`
AgentClaw v0.1.0 — Your 24/7 AI Commander

Usage:
  agentclaw [options]
  ac [options]

Options:
  --provider <name>   LLM provider (claude, openai, gemini, deepseek, kimi, minimax, qwen, ollama)
  --help, -h          Show this help
  --version, -v       Show version

Environment Variables:
  AGENTCLAW_PROVIDER   Default provider (default: claude)
  ANTHROPIC_API_KEY    API key for Claude
  OPENAI_API_KEY       API key for OpenAI
  GEMINI_API_KEY       API key for Gemini
  DEEPSEEK_API_KEY     API key for DeepSeek
  MOONSHOT_API_KEY     API key for Kimi/Moonshot
  MINIMAX_API_KEY      API key for MiniMax
  DASHSCOPE_API_KEY    API key for Qwen/DashScope
  OLLAMA_BASE_URL      Ollama server URL (default: http://localhost:11434/v1)
  DATABASE_PATH        Database path (default: ./data/agentclaw.db)

Examples:
  ANTHROPIC_API_KEY=sk-ant-xxx agentclaw
  OPENAI_API_KEY=sk-xxx ac --provider openai
  ac --provider ollama
`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
