# Long Task Robustness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make long AgentClaw tasks easier to complete, explain, resume, and verify.

**Architecture:** Add deterministic control surfaces around the existing agent loop instead of increasing prompts blindly: trace runtime metadata, a real LLM-call budget, isolated sub-agent budgets, lightweight completion contracts, and checkpointed live eval reports. Keep storage schema unchanged by persisting new audit data as trace steps.

**Tech Stack:** TypeScript, Vitest, existing SQLite trace store, existing live eval runner.

---

### Task 1: Trace Runtime Observability

**Files:**
- Modify: `packages/types/src/memory.ts`
- Modify: `packages/core/src/agent-loop.ts`
- Test: `packages/core/src/__tests__/agent-loop.test.ts`

- [x] Add a `runtime_config` trace step at loop start containing `maxIterations`, `maxLlmCalls`, task profile kind, web/tool budgets, and shared budget state.
- [x] Add tests asserting the trace records effective budgets and task profile.

### Task 2: Real LLM Call Budget

**Files:**
- Modify: `packages/types/src/agent.ts`
- Modify: `packages/core/src/agent-loop.ts`
- Test: `packages/core/src/__tests__/agent-loop.test.ts`

- [x] Add optional `maxLlmCalls` to `AgentConfig`.
- [x] Count every provider stream request, including rollback retries.
- [x] Stop with `max_llm_calls_reached` before another model request when exhausted.
- [x] Add a red/green test where format rollback would otherwise exceed the real call budget.

### Task 3: Sub-Agent Budget Isolation

**Files:**
- Modify: `packages/core/src/subagent-manager.ts`
- Test: `packages/core/src/__tests__/subagent-manager.test.ts`

- [x] Keep parent exhaustion as a hard block before spawning.
- [x] Give each child loop its own `IterationBudget(maxIterations)` so concurrent children do not steal parent loop turns.
- [x] Add tests for both parent-exhausted blocking and non-exhausted isolated child execution.

### Task 4: Completion Contract

**Files:**
- Modify: `packages/types/src/memory.ts`
- Modify: `packages/core/src/agent-loop.ts`
- Modify: `packages/core/src/eval.ts`
- Test: `packages/core/src/__tests__/agent-loop.test.ts`
- Test: `packages/core/src/__tests__/eval.test.ts`

- [x] Persist a `completion_contract` trace step with required final effects inferred from the user input.
- [x] Evaluate incomplete artifact/file-delivery traces as failures when the contract says a file must be delivered.
- [x] Add tests for missing final file delivery and satisfied delivery.

### Task 5: Live Eval Checkpoint And Resume

**Files:**
- Modify: `scripts/live-agent-eval.mts`
- Test: `scripts/__tests__/live-agent-eval.test.ts`

- [x] Parse `--out`, `--resume`, and selected case names.
- [x] Write the report after each case finishes.
- [x] Skip already completed cases on resume.
- [x] Keep UTF-8 JSON output in `data/eval-reports`.

### Task 6: Verification Matrix

**Files:**
- Test commands only.

- [x] Run focused unit tests for agent loop, sub-agent manager, eval, and live eval script.
- [x] Run `pnpm typecheck`.
- [x] Run `agent-flow verify`.
- [x] Run one real live eval case and compare trace metadata before/after.

### Task 7: All-Error Stop Reason

**Files:**
- Modify: `packages/core/src/agent-loop.ts`
- Test: `packages/core/src/__tests__/agent-loop.test.ts`

- [x] When consecutive iterations all fail at tool execution, stop with `all_tool_calls_failed` instead of the generic `max_iterations_reached`.
- [x] Return a deterministic failure summary without another model summary request.

### Live Eval Finding

- `ai-news` live eval completed with checkpoint output at `data/eval-reports/live-agent-eval-long-task-2026-06-17.json`.
- The run still scored 2/10 because the configured search backend returned zero results and direct fetches timed out. That failure is now observable and resumable, but requires search/fetch backend hardening outside the loop-budget changes.
