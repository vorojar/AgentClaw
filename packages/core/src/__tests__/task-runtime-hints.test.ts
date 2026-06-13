import { describe, expect, it } from "vitest";
import {
  buildTaskRuntimeHints,
  classifyRuntimeTask,
} from "../ability/task-runtime-hints.js";

describe("task runtime hints", () => {
  it("classifies AI news tasks and injects a deterministic date hint", () => {
    const input = "今天 AI 行业有什么最新新闻，生成简报。";
    const classification = classifyRuntimeTask(input);
    const hints = buildTaskRuntimeHints(
      input,
      classification,
      new Date("2026-06-13T08:00:00+08:00"),
    );

    expect(classification).toMatchObject({
      isNewsBriefTask: true,
      isAiNewsTask: true,
      isPptxGenerationTask: false,
    });
    expect(hints.join("\n")).toContain("Today is 2026-06-13");
    expect(hints.join("\n")).toContain("优先在3轮以内完成");
  });

  it("adds commercial PPTX style constraints only for generation tasks", () => {
    const input = "做一份拉赞助 pitch deck PPTX 并发给我。";
    const classification = classifyRuntimeTask(input);
    const hints = buildTaskRuntimeHints(input, classification);

    expect(classification.isPptxGenerationTask).toBe(true);
    expect(hints.join("\n")).toContain("PPTX视觉决策");
    expect(hints.join("\n")).toContain("PPTX商业提案风格");
  });

  it("does not classify explanatory PPTX questions as generation tasks", () => {
    const classification = classifyRuntimeTask(
      "只说明怎么做 pitch deck PPTX，不要生成文件。",
    );

    expect(classification.isPptxGenerationTask).toBe(false);
    expect(buildTaskRuntimeHints("只说明怎么做 pitch deck PPTX，不要生成文件。", classification)).toEqual([]);
  });
});
