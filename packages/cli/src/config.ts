import type { LLMProvider } from "@agentclaw/types";
import {
  ClaudeProvider,
  OpenAICompatibleProvider,
  GeminiProvider,
} from "@agentclaw/providers";

export interface CLIConfig {
  provider: string;
  model?: string;
  databasePath: string;
}

/** Load config from environment variables */
export function loadConfig(): CLIConfig {
  return {
    provider: process.env.AGENTCLAW_PROVIDER ?? "claude",
    model: process.env.AGENTCLAW_MODEL,
    databasePath: process.env.DATABASE_PATH ?? "./data/agentclaw.db",
  };
}

/** Create an LLM provider from config + environment */
export function createProvider(config: CLIConfig): LLMProvider {
  const providerName = config.provider.toLowerCase();

  switch (providerName) {
    case "claude":
    case "anthropic": {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error(
          "ANTHROPIC_API_KEY environment variable is required for Claude provider",
        );
      }
      return new ClaudeProvider({ apiKey });
    }

    case "openai": {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error(
          "OPENAI_API_KEY environment variable is required for OpenAI provider",
        );
      }
      return new OpenAICompatibleProvider({
        apiKey,
        providerName: "openai",
      });
    }

    case "gemini":
    case "google": {
      const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
      if (!apiKey) {
        throw new Error(
          "GEMINI_API_KEY environment variable is required for Gemini provider",
        );
      }
      return new GeminiProvider({ apiKey });
    }

    case "deepseek": {
      const apiKey = process.env.DEEPSEEK_API_KEY;
      if (!apiKey) {
        throw new Error("DEEPSEEK_API_KEY environment variable is required");
      }
      return new OpenAICompatibleProvider({
        apiKey,
        baseURL: "https://api.deepseek.com",
        providerName: "deepseek",
        models: [
          {
            id: "deepseek-chat",
            provider: "deepseek",
            name: "DeepSeek Chat",
            tier: "standard",
            contextWindow: 64000,
            supportsTools: true,
            supportsStreaming: true,
          },
          {
            id: "deepseek-reasoner",
            provider: "deepseek",
            name: "DeepSeek Reasoner",
            tier: "flagship",
            contextWindow: 64000,
            supportsTools: false,
            supportsStreaming: true,
          },
        ],
      });
    }

    case "kimi":
    case "moonshot": {
      const apiKey = process.env.MOONSHOT_API_KEY;
      if (!apiKey) {
        throw new Error("MOONSHOT_API_KEY environment variable is required");
      }
      return new OpenAICompatibleProvider({
        apiKey,
        baseURL: "https://api.moonshot.cn/v1",
        providerName: "kimi",
        models: [
          {
            id: "moonshot-v1-auto",
            provider: "kimi",
            name: "Moonshot V1 Auto",
            tier: "standard",
            contextWindow: 128000,
            supportsTools: true,
            supportsStreaming: true,
          },
        ],
      });
    }

    case "minimax": {
      const apiKey = process.env.MINIMAX_API_KEY;
      if (!apiKey) {
        throw new Error("MINIMAX_API_KEY environment variable is required");
      }
      return new OpenAICompatibleProvider({
        apiKey,
        baseURL: "https://api.minimax.chat/v1",
        providerName: "minimax",
        models: [
          {
            id: "MiniMax-Text-01",
            provider: "minimax",
            name: "MiniMax Text 01",
            tier: "standard",
            contextWindow: 1000000,
            supportsTools: true,
            supportsStreaming: true,
          },
        ],
      });
    }

    case "qwen":
    case "dashscope": {
      const apiKey = process.env.DASHSCOPE_API_KEY;
      if (!apiKey) {
        throw new Error("DASHSCOPE_API_KEY environment variable is required");
      }
      return new OpenAICompatibleProvider({
        apiKey,
        baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        providerName: "qwen",
        models: [
          {
            id: "qwen-max",
            provider: "qwen",
            name: "Qwen Max",
            tier: "flagship",
            contextWindow: 32000,
            supportsTools: true,
            supportsStreaming: true,
          },
        ],
      });
    }

    case "ollama": {
      const baseURL =
        process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1";
      return new OpenAICompatibleProvider({
        baseURL,
        providerName: "ollama",
        models: [
          {
            id: process.env.OLLAMA_MODEL ?? "llama3.1",
            provider: "ollama",
            name: "Ollama Local",
            tier: "local",
            contextWindow: 8192,
            supportsTools: true,
            supportsStreaming: true,
          },
        ],
      });
    }

    default:
      throw new Error(
        `Unknown provider: ${providerName}. Supported: claude, openai, gemini, deepseek, kimi, minimax, qwen, ollama`,
      );
  }
}
