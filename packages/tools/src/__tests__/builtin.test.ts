import { describe, it, expect } from "vitest";
import { createBuiltinTools } from "../builtin/index.js";

describe("createBuiltinTools — 内置工具创建", () => {
  /** 9 个核心工具的名称（始终加载） */
  const CORE_TOOL_NAMES = [
    "bash", // shellTool
    "file_read",
    "file_write",
    "file_edit",
    "glob",
    "grep",
    "ask_user",
    "web_fetch",
    "web_search",
  ];

  describe("默认加载（无参数）", () => {
    it("应创建 9 个核心工具", () => {
      const tools = createBuiltinTools();

      expect(tools).toHaveLength(9);
    });

    it("核心工具列表应完全匹配", () => {
      const tools = createBuiltinTools();
      const names = tools.map((t) => t.name);

      for (const name of CORE_TOOL_NAMES) {
        expect(names).toContain(name);
      }
    });
  });

  describe("条件工具加载", () => {
    it("gateway=true 应额外加载 send_file, schedule, update_todo, sandbox, subagent, browser_cdp", () => {
      const tools = createBuiltinTools({ gateway: true });
      const names = tools.map((t) => t.name);

      expect(tools.length).toBe(9 + 6);
      expect(names).toContain("send_file");
      expect(names).toContain("schedule");
      expect(names).toContain("update_todo");
      expect(names).toContain("sandbox");
      expect(names).toContain("subagent");
      expect(names).toContain("browser_cdp");
    });

    it("memory=true 应额外加载 remember", () => {
      const tools = createBuiltinTools({ memory: true });
      const names = tools.map((t) => t.name);

      expect(tools.length).toBe(9 + 1);
      expect(names).toContain("remember");
    });

    it("skills=true 应额外加载 use_skill", () => {
      const tools = createBuiltinTools({ skills: true });
      const names = tools.map((t) => t.name);

      expect(tools.length).toBe(9 + 1);
      expect(names).toContain("use_skill");
    });

    it("claudeCode=true 应额外加载 claude_code", () => {
      const tools = createBuiltinTools({ claudeCode: true });
      const names = tools.map((t) => t.name);

      expect(tools.length).toBe(9 + 1);
      expect(names).toContain("claude_code");
    });

    it("全部启用应加载所有工具", () => {
      const tools = createBuiltinTools({
        gateway: true,
        memory: true,
        skills: true,
        claudeCode: true,
      });

      // 9 核心 + 6 gateway + 1 memory + 1 skills + 1 claudeCode = 18
      expect(tools).toHaveLength(18);
    });

    it("空 options 应只加载核心工具", () => {
      const tools = createBuiltinTools({});

      expect(tools).toHaveLength(9);
    });
  });

  describe("工具完整性验证", () => {
    it("每个工具都应有 name、description、execute 方法", () => {
      // 使用全量加载验证所有工具
      const tools = createBuiltinTools({
        gateway: true,
        memory: true,
        skills: true,
        claudeCode: true,
      });

      for (const tool of tools) {
        expect(tool.name, `工具缺少 name`).toBeTruthy();
        expect(typeof tool.name).toBe("string");

        expect(tool.description, `${tool.name} 缺少 description`).toBeTruthy();
        expect(typeof tool.description).toBe("string");

        expect(tool.execute, `${tool.name} 缺少 execute 方法`).toBeDefined();
        expect(typeof tool.execute).toBe("function");
      }
    });

    it("每个工具都应有 parameters 定义", () => {
      const tools = createBuiltinTools({
        gateway: true,
        memory: true,
        skills: true,
        claudeCode: true,
      });

      for (const tool of tools) {
        expect(
          tool.parameters,
          `${tool.name} 缺少 parameters`,
        ).toBeDefined();
        expect(tool.parameters.type).toBe("object");
        expect(tool.parameters.properties).toBeDefined();
      }
    });

    it("工具名称不应有重复", () => {
      const tools = createBuiltinTools({
        gateway: true,
        memory: true,
        skills: true,
        claudeCode: true,
      });

      const names = tools.map((t) => t.name);
      const uniqueNames = new Set(names);

      expect(uniqueNames.size).toBe(names.length);
    });
  });
});
