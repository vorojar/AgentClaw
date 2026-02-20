import type {
  Tool,
  ToolDefinition,
  ToolRegistry,
  ToolResult,
} from "@agentclaw/types";

export class ToolRegistryImpl implements ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    if (!this.tools.has(name)) {
      throw new Error(`Tool "${name}" is not registered`);
    }
    this.tools.delete(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  definitions(): ToolDefinition[] {
    return this.list().map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    }));
  }

  async execute(
    name: string,
    input: Record<string, unknown>,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { content: `Tool "${name}" not found`, isError: true };
    }
    try {
      return await tool.execute(input);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Tool execution failed: ${message}`, isError: true };
    }
  }
}
