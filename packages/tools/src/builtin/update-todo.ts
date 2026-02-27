import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";

/** Parse markdown checkbox list into structured items */
function parseTodoMarkdown(md: string): Array<{ text: string; done: boolean }> {
  const items: Array<{ text: string; done: boolean }> = [];
  for (const line of md.split("\n")) {
    const m = line.match(/^[-*]\s*\[([ xX])\]\s*(.+)/);
    if (m) {
      items.push({ text: m[2].trim(), done: m[1] !== " " });
    }
  }
  return items;
}

export const updateTodoTool: Tool = {
  name: "update_todo",
  description:
    "Create or update a todo progress list. Call at the START of complex multi-step tasks to show the plan, and after EACH step to update progress. Use markdown checkboxes.",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      todo: {
        type: "string",
        description:
          "Markdown checkbox list, e.g.:\n- [x] Research the topic\n- [x] Analyze data\n- [ ] Write report\n- [ ] Send to user",
      },
    },
    required: ["todo"],
  },

  async execute(
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    // Handle array input: LLMs sometimes send an array of strings instead of markdown
    const rawTodo = input.todo;
    const todo = Array.isArray(rawTodo)
      ? rawTodo.map(String).join("\n")
      : String(rawTodo ?? "");
    const items = parseTodoMarkdown(todo);

    if (items.length === 0) {
      return {
        content:
          "No valid todo items found. Use markdown checkboxes: - [ ] task",
        isError: true,
      };
    }

    // Push to frontend via WS callback
    if (context?.todoNotify) {
      context.todoNotify(items);
    }

    // Return full state — stays in conversation context (prevents lost-in-the-middle)
    const done = items.filter((i) => i.done).length;
    const total = items.length;
    const progress = `## Progress: ${done}/${total}\n${todo}`;
    return { content: progress };
  },
};
