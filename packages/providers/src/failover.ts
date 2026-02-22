import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMStreamChunk,
  ModelInfo,
} from "@agentclaw/types";

/**
 * FailoverProvider — wraps multiple providers, tries each in priority order.
 *
 * - stream(): if no output has been yielded yet, failover to next provider;
 *   if output already started, rethrow (partial response is unrecoverable).
 * - chat(): simple try-catch loop.
 * - Cooldown: a failed provider is skipped for `cooldownMs` after failure.
 */
export class FailoverProvider implements LLMProvider {
  readonly name: string;
  readonly models: ModelInfo[];

  private providers: LLMProvider[];
  private cooldowns = new Map<string, number>(); // provider.name → resume timestamp
  private cooldownMs: number;

  constructor(providers: LLMProvider[], cooldownMs = 60_000) {
    if (providers.length === 0)
      throw new Error("FailoverProvider needs at least one provider");
    this.providers = providers;
    this.cooldownMs = cooldownMs;
    this.name = `failover(${providers.map((p) => p.name).join(",")})`;
    this.models = providers.flatMap((p) => p.models);
  }

  private isAvailable(p: LLMProvider): boolean {
    const until = this.cooldowns.get(p.name);
    if (!until) return true;
    if (Date.now() >= until) {
      this.cooldowns.delete(p.name);
      return true;
    }
    return false;
  }

  private markDown(p: LLMProvider): void {
    this.cooldowns.set(p.name, Date.now() + this.cooldownMs);
    console.warn(
      `[failover] ${p.name} marked down for ${this.cooldownMs / 1000}s`,
    );
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    let lastError: unknown;
    for (const p of this.providers) {
      if (!this.isAvailable(p)) continue;
      try {
        return await p.chat(request);
      } catch (err) {
        console.error(
          `[failover] ${p.name} chat failed:`,
          err instanceof Error ? err.message : err,
        );
        this.markDown(p);
        lastError = err;
      }
    }
    throw lastError ?? new Error("All providers are in cooldown");
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
    let lastError: unknown;
    for (const p of this.providers) {
      if (!this.isAvailable(p)) continue;
      let started = false;
      try {
        for await (const chunk of p.stream(request)) {
          if (
            !started &&
            (chunk.type === "text" || chunk.type === "tool_use_start")
          ) {
            started = true;
            console.log(`[failover] streaming via ${p.name}`);
          }
          yield chunk;
        }
        return; // success — done
      } catch (err) {
        if (started) {
          // Already yielded output — cannot switch provider mid-stream
          throw err;
        }
        console.error(
          `[failover] ${p.name} stream failed:`,
          err instanceof Error ? err.message : err,
        );
        this.markDown(p);
        lastError = err;
      }
    }
    throw lastError ?? new Error("All providers are in cooldown");
  }

  get embed(): ((texts: string[]) => Promise<number[][]>) | undefined {
    for (const p of this.providers) {
      if (p.embed) return p.embed.bind(p);
    }
    return undefined;
  }
}
