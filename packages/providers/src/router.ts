import type { LLMRouter, LLMProvider, TaskType } from "@agentclaw/types";

interface RouteRule {
  providerId: string;
  modelId: string;
}

/**
 * Smart LLM Router.
 * Routes tasks to the best provider + model based on configured rules.
 */
export class SmartRouter implements LLMRouter {
  private providers = new Map<string, LLMProvider>();
  private routes = new Map<TaskType, RouteRule>();

  /** Register a provider (keyed by provider.name) */
  registerProvider(provider: LLMProvider): void {
    this.providers.set(provider.name, provider);
  }

  /** Configure a routing rule for a task type */
  setRoute(taskType: TaskType, providerId: string, modelId: string): void {
    this.routes.set(taskType, { providerId, modelId });
  }

  /** Select the best provider and model for a task type */
  route(taskType: TaskType): { provider: LLMProvider; model: string } {
    const rule = this.routes.get(taskType);

    if (rule) {
      const provider = this.providers.get(rule.providerId);
      if (provider) {
        return { provider, model: rule.modelId };
      }
    }

    // Fallback: use the first registered provider and its first model
    const first = this.providers.values().next();
    if (first.done) {
      throw new Error(
        `No providers registered. Cannot route task type "${taskType}".`,
      );
    }

    const provider = first.value;
    return { provider, model: provider.models[0]?.id ?? "" };
  }
}
