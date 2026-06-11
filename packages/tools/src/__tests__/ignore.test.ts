import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildIgnoreCheckSync, loadIgnorePatterns } from "../ignore.js";

describe("buildIgnoreCheckSync", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `agentclaw-ignore-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("没有 .agentclawignore 时只拦截硬编码敏感文件", () => {
    const check = buildIgnoreCheckSync(testDir);
    expect(check(join(testDir, ".env"))).toBe(true);
    expect(check(join(testDir, "server.pem"))).toBe(true);
    expect(check(join(testDir, "id_rsa"))).toBe(true);
    expect(check(join(testDir, "src", "index.ts"))).toBe(false);
  });

  it("加载 .agentclawignore 并拦截匹配的文件", () => {
    writeFileSync(
      join(testDir, ".agentclawignore"),
      "secrets/**\n*.secret\nbuild/\n",
    );
    const check = buildIgnoreCheckSync(testDir);

    expect(check(join(testDir, "secrets", "key.json"))).toBe(true);
    expect(check(join(testDir, "my.secret"))).toBe(true);
    expect(check(join(testDir, "build", "output.js"))).toBe(true);
    expect(check(join(testDir, "src", "index.ts"))).toBe(false);
  });

  it("硬编码模式始终生效，即使 .agentclawignore 不存在", () => {
    const check = buildIgnoreCheckSync(testDir);
    expect(check(join(testDir, "credentials.json"))).toBe(true);
    expect(check(join(testDir, "id_ed25519"))).toBe(true);
  });

  it("忽略注释和空行", () => {
    writeFileSync(join(testDir, ".agentclawignore"), "# comment\n\n*.log\n");
    const check = buildIgnoreCheckSync(testDir);
    expect(check(join(testDir, "app.log"))).toBe(true);
    expect(check(join(testDir, "src", "index.ts"))).toBe(false);
  });
});

describe("loadIgnorePatterns", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `agentclaw-ignore-patterns-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("没有 .agentclawignore 时返回空数组", async () => {
    const patterns = await loadIgnorePatterns(testDir);
    expect(patterns).toEqual([]);
  });

  it("将 .agentclawignore 规则转为 glob 模式", async () => {
    writeFileSync(
      join(testDir, ".agentclawignore"),
      "*.log\nsecrets/\n# comment\nbuild/output\n",
    );
    const patterns = await loadIgnorePatterns(testDir);

    expect(patterns).toContain("**/*.log");
    expect(patterns).toContain("**/secrets/**");
    expect(patterns).toContain("build/output");
    expect(patterns).not.toContain("# comment");
  });

  it("跳过取反规则", async () => {
    writeFileSync(join(testDir, ".agentclawignore"), "*.log\n!important.log\n");
    const patterns = await loadIgnorePatterns(testDir);

    expect(patterns).toContain("**/*.log");
    expect(patterns).not.toContain("!important.log");
  });
});
