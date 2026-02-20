import type {
  LLMRouter,
  LLMProvider,
  TaskType,
  ModelTier,
  ModelInfo,
} from "@agentclaw/types";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface FallbackEntry {
  providerId: string;
  modelId: string;
}

interface RouteRule {
  providerId: string;
  modelId: string;
  fallbacks: FallbackEntry[];
}

interface TierRoute {
  tier: ModelTier;
}

/** Per-model accumulated usage statistics. */
export interface ModelUsageStats {
  provider: string;
  model: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  callCount: number;
}

/** Aggregated usage statistics returned by `getUsageStats()`. */
export interface UsageStats {
  byModel: ModelUsageStats[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  totalCalls: number;
}

/** Result of `routeWithFallback` — an ordered list of candidates. */
export interface RouteCandidate {
  provider: LLMProvider;
  model: string;
}

// ---------------------------------------------------------------------------
// Default tier mapping for task types (used when no explicit rule exists)
// ---------------------------------------------------------------------------

const DEFAULT_TIER_FOR_TASK: Record<TaskType, ModelTier> = {
  planning: "flagship",
  coding: "standard",
  chat: "fast",
  classification: "fast",
  embedding: "fast",
  summarization: "standard",
};

// ---------------------------------------------------------------------------
// SmartRouter
// ---------------------------------------------------------------------------

/**
 * Smart LLM Router.
 *
 * Routes tasks to the best provider + model based on configured rules.
 * Supports cost tracking, automatic fallback chains, provider health status,
 * and tier-based intelligent routing.
 */
export class SmartRouter implements LLMRouter {
  // -- Provider registry ----------------------------------------------------
  private providers = new Map<string, LLMProvider>();

  // -- Routing tables -------------------------------------------------------
  /** Explicit provider+model rules (with optional fallback chains). */
  private routes = new Map<TaskType, RouteRule>();
  /** Tier-based rules — resolved dynamically against registered providers. */
  private tierRoutes = new Map<TaskType, TierRoute>();

  // -- Provider health ------------------------------------------------------
  private downProviders = new Set<string>();

  // -- Cost tracking --------------------------------------------------------
  /** Key: `${providerName}::${modelId}` */
  private usageMap = new Map<
    string,
    {
      provider: string;
      model: string;
      totalInputTokens: number;
      totalOutputTokens: number;
      totalCost: number;
      callCount: number;
    }
  >();

  // =========================================================================
  // Provider registration
  // =========================================================================

  /** Register a provider (keyed by provider.name). */
  registerProvider(provider: LLMProvider): void {
    this.providers.set(provider.name, provider);
  }

  // =========================================================================
  // Route configuration
  // =========================================================================

  /**
   * Configure a routing rule for a task type.
   *
   * Optionally accepts a fallback chain — an ordered list of alternative
   * provider+model pairs to try if the primary is unavailable.
   *
   * The method signature is backward-compatible: calling without `fallbacks`
   * behaves identically to the original implementation.
   */
  setRoute(
    taskType: TaskType,
    providerId: string,
    modelId: string,
    fallbacks?: FallbackEntry[],
  ): void {
    this.routes.set(taskType, {
      providerId,
      modelId,
      fallbacks: fallbacks ?? [],
    });
  }

  /**
   * Set a tier-based routing rule for a task type.
   *
   * When the router resolves this task type it will automatically pick the
   * best *available* (non-down) provider whose model list includes a model
   * of the requested tier.
   */
  setTierRoute(taskType: TaskType, tier: ModelTier): void {
    this.tierRoutes.set(taskType, { tier });
  }

  // =========================================================================
  // Provider health
  // =========================================================================

  /** Mark a provider as unavailable. It will be skipped during routing. */
  markProviderDown(providerName: string): void {
    this.downProviders.add(providerName);
  }

  /** Mark a provider as available again. */
  markProviderUp(providerName: string): void {
    this.downProviders.delete(providerName);
  }

  /** Check whether a provider is currently marked as down. */
  isProviderDown(providerName: string): boolean {
    return this.downProviders.has(providerName);
  }

  // =========================================================================
  // Cost tracking
  // =========================================================================

  /**
   * Record token usage for a provider/model call.
   *
   * The estimated cost is derived from the matching `ModelInfo` entry
   * registered on the provider (using `costPer1kInput` / `costPer1kOutput`).
   * If no cost information is available the cost contribution is 0.
   */
  trackUsage(
    provider: string,
    model: string,
    tokensIn: number,
    tokensOut: number,
  ): void {
    const key = `${provider}::${model}`;

    // Look up cost info from registered provider models
    const modelInfo = this.findModelInfo(provider, model);
    const costIn = modelInfo?.costPer1kInput
      ? (tokensIn / 1000) * modelInfo.costPer1kInput
      : 0;
    const costOut = modelInfo?.costPer1kOutput
      ? (tokensOut / 1000) * modelInfo.costPer1kOutput
      : 0;
    const cost = costIn + costOut;

    const existing = this.usageMap.get(key);
    if (existing) {
      existing.totalInputTokens += tokensIn;
      existing.totalOutputTokens += tokensOut;
      existing.totalCost += cost;
      existing.callCount += 1;
    } else {
      this.usageMap.set(key, {
        provider,
        model,
        totalInputTokens: tokensIn,
        totalOutputTokens: tokensOut,
        totalCost: cost,
        callCount: 1,
      });
    }
  }

  /** Return aggregated usage statistics across all tracked provider/model pairs. */
  getUsageStats(): UsageStats {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCost = 0;
    let totalCalls = 0;

    const byModel: ModelUsageStats[] = [];

    for (const entry of this.usageMap.values()) {
      totalInputTokens += entry.totalInputTokens;
      totalOutputTokens += entry.totalOutputTokens;
      totalCost += entry.totalCost;
      totalCalls += entry.callCount;
      byModel.push({ ...entry });
    }

    return {
      byModel,
      totalInputTokens,
      totalOutputTokens,
      totalCost,
      totalCalls,
    };
  }

  // =========================================================================
  // Routing — primary entry point (LLMRouter interface)
  // =========================================================================

  /**
   * Select the best provider and model for a task type.
   *
   * Resolution order:
   * 1. Explicit route rule (skipping providers marked as down, walking the
   *    fallback chain if necessary).
   * 2. Explicit tier route (`setTierRoute`).
   * 3. Default tier mapping (planning→flagship, coding→standard, etc.).
   * 4. First registered available provider + its first model.
   *
   * Throws if no provider can be found at all.
   */
  route(taskType: TaskType): { provider: LLMProvider; model: string } {
    // 1. Explicit route rule + fallback chain
    const rule = this.routes.get(taskType);
    if (rule) {
      const result = this.resolveRouteRule(rule);
      if (result) return result;
    }

    // 2. Explicit tier route
    const tierRoute = this.tierRoutes.get(taskType);
    if (tierRoute) {
      const result = this.resolveByTier(tierRoute.tier);
      if (result) return result;
    }

    // 3. Default tier mapping
    const defaultTier = DEFAULT_TIER_FOR_TASK[taskType];
    if (defaultTier) {
      const result = this.resolveByTier(defaultTier);
      if (result) return result;
    }

    // 4. First available provider
    for (const provider of this.providers.values()) {
      if (!this.downProviders.has(provider.name)) {
        return { provider, model: provider.models[0]?.id ?? "" };
      }
    }

    throw new Error(
      `No providers registered. Cannot route task type "${taskType}".`,
    );
  }

  // =========================================================================
  // Routing — with full fallback list
  // =========================================================================

  /**
   * Return an ordered list of route candidates for a task type.
   *
   * The list is sorted by priority (primary first, then fallbacks) and
   * excludes any provider currently marked as down.
   */
  routeWithFallback(taskType: TaskType): RouteCandidate[] {
    const candidates: RouteCandidate[] = [];

    // Collect from explicit rule + fallbacks
    const rule = this.routes.get(taskType);
    if (rule) {
      const entries: FallbackEntry[] = [
        { providerId: rule.providerId, modelId: rule.modelId },
        ...rule.fallbacks,
      ];
      for (const entry of entries) {
        const provider = this.providers.get(entry.providerId);
        if (provider && !this.downProviders.has(provider.name)) {
          candidates.push({ provider, model: entry.modelId });
        }
      }
    }

    // If we already have candidates from explicit rules, return them.
    if (candidates.length > 0) return candidates;

    // Tier-based resolution (explicit tier route, then default)
    const tier =
      this.tierRoutes.get(taskType)?.tier ?? DEFAULT_TIER_FOR_TASK[taskType];
    if (tier) {
      const tierCandidates = this.collectByTier(tier);
      if (tierCandidates.length > 0) return tierCandidates;
    }

    // Ultimate fallback: all available providers
    for (const provider of this.providers.values()) {
      if (!this.downProviders.has(provider.name)) {
        candidates.push({ provider, model: provider.models[0]?.id ?? "" });
      }
    }

    return candidates;
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  /**
   * Try to resolve an explicit route rule. Walks primary + fallback chain,
   * skipping providers marked as down.
   */
  private resolveRouteRule(
    rule: RouteRule,
  ): { provider: LLMProvider; model: string } | null {
    // Try primary
    if (!this.downProviders.has(rule.providerId)) {
      const provider = this.providers.get(rule.providerId);
      if (provider) {
        return { provider, model: rule.modelId };
      }
    }

    // Walk fallback chain
    for (const fb of rule.fallbacks) {
      if (this.downProviders.has(fb.providerId)) continue;
      const provider = this.providers.get(fb.providerId);
      if (provider) {
        return { provider, model: fb.modelId };
      }
    }

    return null;
  }

  /**
   * Find the first available provider that has a model matching the
   * requested tier.
   */
  private resolveByTier(
    tier: ModelTier,
  ): { provider: LLMProvider; model: string } | null {
    for (const provider of this.providers.values()) {
      if (this.downProviders.has(provider.name)) continue;
      const model = provider.models.find((m) => m.tier === tier);
      if (model) {
        return { provider, model: model.id };
      }
    }
    return null;
  }

  /**
   * Collect all available provider+model pairs for a given tier, ordered by
   * provider registration order.
   */
  private collectByTier(tier: ModelTier): RouteCandidate[] {
    const results: RouteCandidate[] = [];
    for (const provider of this.providers.values()) {
      if (this.downProviders.has(provider.name)) continue;
      const model = provider.models.find((m) => m.tier === tier);
      if (model) {
        results.push({ provider, model: model.id });
      }
    }
    return results;
  }

  /** Look up a ModelInfo from a registered provider by provider name and model id. */
  private findModelInfo(
    providerName: string,
    modelId: string,
  ): ModelInfo | undefined {
    const provider = this.providers.get(providerName);
    if (!provider) return undefined;
    return provider.models.find((m) => m.id === modelId);
  }
}
