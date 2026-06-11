import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf-8");
}

describe("repository hygiene", () => {
  it("does not expose removed tool names in active user-facing facts", () => {
    const activeFacts = [
      "README.md",
      "system-prompt.md",
      "data/golden-testcases.json",
    ]
      .map(read)
      .join("\n");

    expect(activeFacts).not.toMatch(/\bexecute_code\b/);
    expect(activeFacts).not.toMatch(/\bsocial_post\b/);
    expect(activeFacts).not.toMatch(/\bshell\b/);
  });

  it("keeps wechat publish instructions portable", () => {
    const activeWechatFacts = [
      "packages/core/src/ability/task-router.ts",
      "packages/core/src/agent-loop.ts",
      "skills/wechat-publish/SKILL.md",
    ]
      .map(read)
      .join("\n");

    expect(activeWechatFacts).not.toContain("D:/mycode/agentclaw");
    expect(activeWechatFacts).not.toContain("C:/Users/voroj");
  });

  it("keeps tracked default agent config free of local knowledge sources", () => {
    const config = JSON.parse(read("data/agents/default/config.json")) as {
      knowledgeSources?: unknown[];
    };

    expect(config.knowledgeSources ?? []).toEqual([]);
  });

  it("stores web_fetch runtime assets outside the skills catalog", () => {
    expect(existsSync(join(ROOT, "skills/web-fetch"))).toBe(false);
    expect(
      existsSync(join(ROOT, "packages/tools/assets/web-fetch/scripts/fetch.py")),
    ).toBe(true);
    expect(
      existsSync(join(ROOT, "packages/tools/assets/web-fetch/sites.json")),
    ).toBe(true);
  });
});
