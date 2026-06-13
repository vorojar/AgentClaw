import { evidenceTableCompletionPolicy } from "./evidence-table.js";
import { newsBriefCompletionPolicy } from "./news-brief.js";
import { redditRssCompletionPolicy } from "./reddit-rss.js";
import type {
  CompletionPolicy,
  CompletionPolicyDecision,
  CompletionPolicyInput,
} from "./types.js";

const COMPLETION_POLICIES: CompletionPolicy[] = [
  redditRssCompletionPolicy,
  newsBriefCompletionPolicy,
  evidenceTableCompletionPolicy,
];

export function evaluateCompletionPolicies(
  input: CompletionPolicyInput,
): CompletionPolicyDecision | null {
  for (const policy of COMPLETION_POLICIES) {
    const decision = policy.evaluate(input);
    if (decision) return decision;
  }
  return null;
}

export { extractFallbackLines } from "./common.js";
export { buildSynthesisFallbackResponse } from "./synthesis-fallback.js";
