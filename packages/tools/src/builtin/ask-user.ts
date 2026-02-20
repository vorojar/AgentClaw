import { createInterface } from "node:readline";
import type { Tool, ToolResult } from "@agentclaw/types";

export const askUserTool: Tool = {
  name: "ask_user",
  description:
    "Ask the user a question in the terminal and return their answer",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "The question to ask the user",
      },
    },
    required: ["question"],
  },

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const question = input.question as string;

    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
    });

    try {
      const answer = await new Promise<string>((resolve) => {
        rl.question(`${question}\n> `, (ans) => {
          resolve(ans);
        });
      });

      return {
        content: answer,
        isError: false,
      };
    } finally {
      rl.close();
    }
  },
};
