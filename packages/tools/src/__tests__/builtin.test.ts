import { describe, it, expect, vi } from "vitest";
import { createBuiltinTools } from "../builtin/index.js";

describe("createBuiltinTools — 内置工具创建", () => {
  /** 10 个核心工具的名称（始终加载） */
  const CORE_TOOL_NAMES = [
    "bun",
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
    it("应创建 10 个核心工具", () => {
      const tools = createBuiltinTools();

      expect(tools).toHaveLength(CORE_TOOL_NAMES.length);
    });

    it("核心工具列表应完全匹配", () => {
      const tools = createBuiltinTools();
      const names = tools.map((t) => t.name);

      for (const name of CORE_TOOL_NAMES) {
        expect(names).toContain(name);
      }
      expect(names).not.toContain("rss_top");
    });
  });

  describe("条件工具加载", () => {
    it("gateway=true 应额外加载 gateway 工具", () => {
      const tools = createBuiltinTools({ gateway: true });
      const names = tools.map((t) => t.name);

      expect(tools.length).toBe(CORE_TOOL_NAMES.length + 6);
      expect(names).toContain("send_file");
      expect(names).toContain("schedule");
      expect(names).toContain("update_todo");
      expect(names).toContain("sandbox");
      expect(names).toContain("subagent");
      expect(names).not.toContain("browser_cdp");
      expect(names).not.toContain("execute_code");
    });

    it("gateway=true 且 browserCdp=true 时才加载 browser_cdp", () => {
      const tools = createBuiltinTools({ gateway: true, browserCdp: true });
      const names = tools.map((t) => t.name);

      expect(tools.length).toBe(CORE_TOOL_NAMES.length + 7);
      expect(names).toContain("browser_cdp");
    });

    it("memory=true 应额外加载 remember 和 recall", () => {
      const tools = createBuiltinTools({ memory: true });
      const names = tools.map((t) => t.name);

      expect(tools.length).toBe(CORE_TOOL_NAMES.length + 2);
      expect(names).toContain("remember");
      expect(names).toContain("recall");
    });

    it("skills=true 应额外加载 use_skill", () => {
      const tools = createBuiltinTools({ skills: true });
      const names = tools.map((t) => t.name);

      expect(tools.length).toBe(CORE_TOOL_NAMES.length + 3);
      expect(names).toContain("use_skill");
      expect(names).toContain("skill_manage");
      expect(names).toContain("skill_curator");
    });

    it("claudeCode=true 应额外加载 claude_code", () => {
      const tools = createBuiltinTools({ claudeCode: true });
      const names = tools.map((t) => t.name);

      expect(tools.length).toBe(CORE_TOOL_NAMES.length + 1);
      expect(names).toContain("claude_code");
    });

    it("rss=true 时才加载 rss_top", () => {
      const tools = createBuiltinTools({ rss: true });
      const names = tools.map((t) => t.name);

      expect(tools.length).toBe(CORE_TOOL_NAMES.length + 1);
      expect(names).toContain("rss_top");
    });

    it("全部启用应加载所有工具", () => {
      const tools = createBuiltinTools({
        gateway: true,
        memory: true,
        skills: true,
        claudeCode: true,
        rss: true,
      });

      // 10 核心 + 6 gateway + 2 memory + 3 skills + 1 claudeCode + 1 rss = 23
      expect(tools).toHaveLength(23);
    });

    it("空 options 应只加载核心工具", () => {
      const tools = createBuiltinTools({});

      expect(tools).toHaveLength(CORE_TOOL_NAMES.length);
    });
  });

  describe("remember", () => {
    it("应把显式记忆保存为带来源的 L1 metadata", async () => {
      const remember = createBuiltinTools({ memory: true }).find(
        (tool) => tool.name === "remember",
      )!;
      const saveMemory = vi.fn().mockResolvedValue(undefined);

      const result = await remember.execute(
        {
          content: "用户偏好 PPTX 交付前先看预览图。",
          type: "preference",
        },
        {
          saveMemory,
          conversationId: "conv-remember",
          traceId: "trace-remember",
          memoryNamespace: "default",
        },
      );

      expect(result.isError).toBe(false);
      expect(saveMemory).toHaveBeenCalledWith(
        "用户偏好 PPTX 交付前先看预览图。",
        "preference",
        {
          layer: "L1",
          source: "remember_tool",
          conversationId: "conv-remember",
          traceId: "trace-remember",
          sceneName: "explicit_memory",
          confidence: 1,
        },
      );
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
        rss: true,
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
        rss: true,
      });

      for (const tool of tools) {
        expect(tool.parameters, `${tool.name} 缺少 parameters`).toBeDefined();
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
        rss: true,
      });

      const names = tools.map((t) => t.name);
      const uniqueNames = new Set(names);

      expect(uniqueNames.size).toBe(names.length);
    });
  });
});
