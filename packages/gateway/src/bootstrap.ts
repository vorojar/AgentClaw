import {
  SimpleOrchestrator,
  SimplePlanner,
  SimpleAgentLoop,
  SimpleContextManager,
  SkillRegistryImpl,
} from "@agentclaw/core";
import {
  ClaudeProvider,
  OpenAICompatibleProvider,
  GeminiProvider,
  generateId,
} from "@agentclaw/providers";
import { ToolRegistryImpl, createBuiltinTools } from "@agentclaw/tools";
import { initDatabase, SQLiteMemoryStore } from "@agentclaw/memory";
import type {
  LLMProvider,
  Orchestrator,
  Planner,
  SkillRegistry,
  ToolRegistry,
  MemoryStore,
} from "@agentclaw/types";
import { mkdirSync } from "fs";
import { dirname } from "path";

export interface AppContext {
  provider: LLMProvider;
  orchestrator: Orchestrator;
  planner: Planner;
  toolRegistry: ToolRegistryImpl;
  memoryStore: SQLiteMemoryStore;
  skillRegistry: SkillRegistryImpl;
  config: AppRuntimeConfig;
}

export interface AppRuntimeConfig {
  provider: string;
  model?: string;
  databasePath: string;
  skillsDir: string;
}

function createProvider(): {
  provider: LLMProvider;
  providerName: string;
  model?: string;
} {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    const model = process.env.DEFAULT_MODEL;
    return {
      provider: new ClaudeProvider({
        apiKey: anthropicKey,
        defaultModel: model,
      }),
      providerName: "claude",
      model,
    };
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    const model = process.env.DEFAULT_MODEL;
    const baseURL = process.env.OPENAI_BASE_URL;
    return {
      provider: new OpenAICompatibleProvider({
        apiKey: openaiKey,
        baseURL,
        defaultModel: model,
        providerName: "openai",
      }),
      providerName: "openai",
      model,
    };
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    const model = process.env.DEFAULT_MODEL;
    return {
      provider: new GeminiProvider({ apiKey: geminiKey, defaultModel: model }),
      providerName: "gemini",
      model,
    };
  }

  // Fallback: OpenAI-compatible with no key (e.g. local Ollama)
  const baseURL =
    process.env.OLLAMA_BASE_URL ||
    process.env.LLM_BASE_URL ||
    "http://localhost:11434/v1";
  const model =
    process.env.OLLAMA_MODEL || process.env.DEFAULT_MODEL || "llama3";
  return {
    provider: new OpenAICompatibleProvider({
      apiKey: "ollama",
      baseURL,
      defaultModel: model,
      providerName: "local",
    }),
    providerName: "local",
    model,
  };
}

export async function bootstrap(): Promise<AppContext> {
  // Database setup
  const databasePath = process.env.DB_PATH || "./data/agentclaw.db";
  try {
    mkdirSync(dirname(databasePath), { recursive: true });
  } catch {
    // directory may already exist
  }
  const db = initDatabase(databasePath);

  // Provider
  const { provider, providerName, model } = createProvider();

  // Tool registry
  const toolRegistry = new ToolRegistryImpl();
  const builtinTools = createBuiltinTools();
  for (const tool of builtinTools) {
    toolRegistry.register(tool);
  }

  // Memory store
  const memoryStore = new SQLiteMemoryStore(db);

  // Build system prompt with explicit tool descriptions for smaller models
  const toolDescriptions = toolRegistry
    .list()
    .map((t) => `- ${t.name}: ${t.description}`)
    .join("\n");

  const defaultSystemPrompt = `You are AgentClaw, a powerful AI assistant. You MUST use tools to help the user. Do NOT say you cannot do something — use the appropriate tool instead.

Available tools:
${toolDescriptions}

IMPORTANT RULES:
- When the user asks to search, use the "web_search" tool.
- When the user asks to read a file, use the "file_read" tool.
- When the user asks to write a file, use the "file_write" tool.
- When the user asks to run a command, use the "shell" tool.
- When the user asks to fetch a URL, use the "web_fetch" tool.
- Always respond in the same language the user uses.
- Think step by step before acting.`;

  // Orchestrator
  const orchestrator = new SimpleOrchestrator({
    provider,
    toolRegistry,
    memoryStore,
    systemPrompt: process.env.SYSTEM_PROMPT || defaultSystemPrompt,
  });

  // Planner
  const planner = new SimplePlanner({
    provider,
    agentLoopFactory: (conversationId: string) => {
      const contextManager = new SimpleContextManager({
        memoryStore,
      });
      return new SimpleAgentLoop({
        provider,
        toolRegistry,
        contextManager,
        memoryStore,
      });
    },
  });

  // Skill registry
  const skillsDir = process.env.SKILLS_DIR || "./skills/";
  const skillRegistry = new SkillRegistryImpl();
  await skillRegistry.loadFromDirectory(skillsDir);

  const config: AppRuntimeConfig = {
    provider: providerName,
    model,
    databasePath,
    skillsDir,
  };

  return {
    provider,
    orchestrator,
    planner,
    toolRegistry,
    memoryStore,
    skillRegistry,
    config,
  };
}
