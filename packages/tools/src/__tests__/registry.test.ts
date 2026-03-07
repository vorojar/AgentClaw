import { describe, it, expect, vi } from "vitest";
import { ToolRegistryImpl } from "../registry.js";
import type { Tool, ToolResult } from "@agentclaw/types";

// ── Mock 工厂：创建假 Tool ──

function createMockTool(name: string, description = "mock tool"): Tool {
  return {
    name,
    description,
    category: "builtin",
    parameters: {
      type: "object",
      properties: {
        input: { type: "string" },
      },
      required: ["input"],
    },
    execute: vi.fn().mockResolvedValue({
      content: `${name} executed`,
      isError: false,
    } satisfies ToolResult),
  };
}

describe("ToolRegistryImpl", () => {
  describe("register — 工具注册", () => {
    it("应该成功注册单个工具", () => {
      const registry = new ToolRegistryImpl();
      const tool = createMockTool("test_tool");

      registry.register(tool);

      expect(registry.get("test_tool")).toBe(tool);
    });

    it("应该成功批量注册多个工具", () => {
      const registry = new ToolRegistryImpl();
      const tools = [
        createMockTool("tool_a"),
        createMockTool("tool_b"),
        createMockTool("tool_c"),
      ];

      for (const tool of tools) {
        registry.register(tool);
      }

      expect(registry.list()).toHaveLength(3);
      expect(registry.get("tool_a")).toBe(tools[0]);
      expect(registry.get("tool_b")).toBe(tools[1]);
      expect(registry.get("tool_c")).toBe(tools[2]);
    });

    it("重复注册同名工具应抛出错误", () => {
      const registry = new ToolRegistryImpl();
      const tool = createMockTool("duplicate");

      registry.register(tool);

      expect(() => registry.register(createMockTool("duplicate"))).toThrowError(
        'Tool "duplicate" is already registered',
      );
    });
  });

  describe("get — 工具查找", () => {
    it("应该通过名称找到已注册的工具", () => {
      const registry = new ToolRegistryImpl();
      const tool = createMockTool("find_me");
      registry.register(tool);

      const found = registry.get("find_me");

      expect(found).toBe(tool);
      expect(found?.name).toBe("find_me");
    });

    it("查找不存在的工具应返回 undefined", () => {
      const registry = new ToolRegistryImpl();

      expect(registry.get("nonexistent")).toBeUndefined();
    });
  });

  describe("list — 工具列表", () => {
    it("空注册表应返回空数组", () => {
      const registry = new ToolRegistryImpl();

      expect(registry.list()).toEqual([]);
    });

    it("应返回所有已注册工具", () => {
      const registry = new ToolRegistryImpl();
      registry.register(createMockTool("a"));
      registry.register(createMockTool("b"));

      const list = registry.list();

      expect(list).toHaveLength(2);
      expect(list.map((t) => t.name)).toContain("a");
      expect(list.map((t) => t.name)).toContain("b");
    });
  });

  describe("unregister — 工具注销", () => {
    it("应该成功注销已注册的工具", () => {
      const registry = new ToolRegistryImpl();
      registry.register(createMockTool("removable"));

      registry.unregister("removable");

      expect(registry.get("removable")).toBeUndefined();
      expect(registry.list()).toHaveLength(0);
    });

    it("注销不存在的工具应抛出错误", () => {
      const registry = new ToolRegistryImpl();

      expect(() => registry.unregister("ghost")).toThrowError(
        'Tool "ghost" is not registered',
      );
    });
  });

  describe("definitions — 工具定义导出", () => {
    it("应返回仅含 name, description, parameters 的定义", () => {
      const registry = new ToolRegistryImpl();
      registry.register(createMockTool("def_test", "A test tool"));

      const defs = registry.definitions();

      expect(defs).toHaveLength(1);
      expect(defs[0]).toEqual({
        name: "def_test",
        description: "A test tool",
        parameters: expect.objectContaining({ type: "object" }),
      });
      // 不应包含 execute 函数
      expect(defs[0]).not.toHaveProperty("execute");
    });
  });

  describe("filter — 过滤工具", () => {
    it("应返回满足条件的工具子集", () => {
      const registry = new ToolRegistryImpl();
      registry.register(createMockTool("keep_a"));
      registry.register(createMockTool("drop_b"));
      registry.register(createMockTool("keep_c"));

      const filtered = registry.filter((t) => t.name.startsWith("keep_"));

      expect(filtered.list()).toHaveLength(2);
      expect(filtered.get("keep_a")).toBeDefined();
      expect(filtered.get("keep_c")).toBeDefined();
      expect(filtered.get("drop_b")).toBeUndefined();
    });
  });

  describe("execute — 工具执行", () => {
    it("应调用对应工具的 execute 方法", async () => {
      const registry = new ToolRegistryImpl();
      const tool = createMockTool("exec_test");
      registry.register(tool);

      const result = await registry.execute("exec_test", { input: "hello" });

      expect(tool.execute).toHaveBeenCalledWith({ input: "hello" }, undefined);
      expect(result.content).toBe("exec_test executed");
      expect(result.isError).toBe(false);
    });

    it("执行不存在的工具应返回错误", async () => {
      const registry = new ToolRegistryImpl();

      const result = await registry.execute("missing", {});

      expect(result.content).toContain('Tool "missing" not found');
      expect(result.isError).toBe(true);
    });

    it("工具执行抛异常应被捕获并返回错误", async () => {
      const registry = new ToolRegistryImpl();
      const tool = createMockTool("throws");
      (tool.execute as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("boom"),
      );
      registry.register(tool);

      const result = await registry.execute("throws", {});

      expect(result.content).toContain("Tool execution failed: boom");
      expect(result.isError).toBe(true);
    });
  });
});
