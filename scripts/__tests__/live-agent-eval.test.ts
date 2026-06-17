import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = readFileSync(resolve("scripts/live-agent-eval.mts"), "utf-8");

describe("live-agent-eval script guardrails", () => {
  it("不能硬编码今天日期", () => {
    expect(script).not.toMatch(/const\s+today\s*=\s*"\d{4}-\d{2}-\d{2}"/);
  });

  it("不能把已不存在的 execute_code 当作实时检索工具加分", () => {
    expect(script).not.toContain('toolCalls.includes("execute_code")');
  });

  it("长任务 eval 必须支持断点续跑和逐 case checkpoint", () => {
    expect(script).toContain("--resume");
    expect(script).toContain("completedCaseNames");
    expect(script).toMatch(/writeFileSync\(\s*outPath,\s*JSON\.stringify\(results/);
  });
});
