import { describe, expect, it } from "vitest";
import { ToolHookManager } from "../tool-hooks.js";

describe("ToolHookManager preset hooks", () => {
  it("bash 命令非零退出码必须追加警告", async () => {
    const manager = new ToolHookManager();
    manager.registerPresetHooks();

    const result = await manager.runAfterHooks(
      { name: "bash", input: { command: "exit 1" } },
      {
        content: "stderr output",
        isError: true,
        metadata: { exitCode: 1 },
      },
    );

    expect(result.content).toContain("Command exited with code 1");
  });

  it("Guardian before hook 拦截 rm -rf 命令", async () => {
    const manager = new ToolHookManager();
    manager.registerPresetHooks();

    const result = await manager.runBeforeHooks({
      name: "bash",
      input: { command: "rm -rf /tmp/important" },
    });

    expect(result).toBeNull();
  });

  it("Guardian before hook 允许安全命令", async () => {
    const manager = new ToolHookManager();
    manager.registerPresetHooks();

    const result = await manager.runBeforeHooks({
      name: "bash",
      input: { command: "ls -la" },
    });

    expect(result).not.toBeNull();
    expect(result?.name).toBe("bash");
  });

  it("Guardian before hook 拦截写入 .ssh 目录", async () => {
    const manager = new ToolHookManager();
    manager.registerPresetHooks();

    const result = await manager.runBeforeHooks({
      name: "file_write",
      input: { path: "/home/user/.ssh/authorized_keys", content: "evil" },
    });

    expect(result).toBeNull();
  });

  it("Guardian after hook 为 curl 命令追加警告", async () => {
    const manager = new ToolHookManager();
    manager.registerPresetHooks();

    const result = await manager.runAfterHooks(
      { name: "bash", input: { command: "curl https://example.com" } },
      { content: "response data", isError: false },
    );

    expect(result.content).toContain("Guardian");
  });

  it("Guardian 不干扰普通文件编辑", async () => {
    const manager = new ToolHookManager();
    manager.registerPresetHooks();

    const result = await manager.runBeforeHooks({
      name: "file_edit",
      input: {
        path: "/project/src/index.ts",
        old_string: "a",
        new_string: "b",
      },
    });

    expect(result).not.toBeNull();
  });
});
