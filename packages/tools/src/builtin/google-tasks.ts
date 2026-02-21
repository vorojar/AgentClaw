import type { Tool, ToolResult } from "@agentclaw/types";
import { googleFetch } from "./google-auth.js";

const BASE_URL = "https://tasks.googleapis.com/tasks/v1";

interface GoogleTask {
  id: string;
  title: string;
  notes?: string;
  status: "needsAction" | "completed";
  due?: string;
  completed?: string;
  updated?: string;
}

interface GoogleTaskListResponse {
  items?: GoogleTask[];
  nextPageToken?: string;
}

/** 格式化单条任务为易读文本 */
function formatTask(task: GoogleTask, index: number): string {
  const lines: string[] = [];
  const status = task.status === "completed" ? "已完成" : "待办";
  lines.push(`${index}. ${task.title}`);
  if (task.due) {
    // due 是 RFC 3339 格式，只取日期部分显示
    const dueDate = task.due.slice(0, 10);
    lines.push(`   截止日期：${dueDate}`);
  }
  lines.push(`   状态：${status}`);
  lines.push(`   ID：${task.id}`);
  if (task.notes) {
    lines.push(`   备注：${task.notes}`);
  }
  return lines.join("\n");
}

export const googleTasksTool: Tool = {
  name: "google_tasks",
  description: "管理 Google Tasks：列出/创建/完成/删除任务。",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "create", "complete", "delete"] },
      task_list: { type: "string", default: "@default" },
      title: { type: "string" },
      notes: { type: "string" },
      due: { type: "string" },
      task_id: { type: "string" },
    },
    required: ["action"],
  },

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const action = input.action as string;
    const taskList = (input.task_list as string | undefined) ?? "@default";
    const title = input.title as string | undefined;
    const notes = input.notes as string | undefined;
    const due = input.due as string | undefined;
    const taskId = input.task_id as string | undefined;

    const encodedList = encodeURIComponent(taskList);

    try {
      switch (action) {
        case "list": {
          const url = `${BASE_URL}/lists/${encodedList}/tasks?showCompleted=false&maxResults=50`;
          const res = await googleFetch(url);

          if (!res.ok) {
            const body = await res.text();
            return {
              content: `列出任务失败（${res.status}）：${body}`,
              isError: true,
            };
          }

          const data = (await res.json()) as GoogleTaskListResponse;
          const tasks = data.items ?? [];

          if (tasks.length === 0) {
            return { content: "当前任务列表为空，没有待办任务。" };
          }

          const lines: string[] = [
            `任务列表（${taskList}）共 ${tasks.length} 条待办任务：`,
            "",
          ];
          tasks.forEach((task, idx) => {
            lines.push(formatTask(task, idx + 1));
            lines.push("");
          });

          return { content: lines.join("\n").trimEnd() };
        }

        case "create": {
          if (!title) {
            return {
              content: "创建任务失败：缺少必填参数 title（任务标题）。",
              isError: true,
            };
          }

          const url = `${BASE_URL}/lists/${encodedList}/tasks`;
          const body: Record<string, string> = { title };
          if (notes) body.notes = notes;
          if (due) body.due = due;

          const res = await googleFetch(url, {
            method: "POST",
            body: JSON.stringify(body),
          });

          if (!res.ok) {
            const errBody = await res.text();
            return {
              content: `创建任务失败（${res.status}）：${errBody}`,
              isError: true,
            };
          }

          const task = (await res.json()) as GoogleTask;
          const lines: string[] = [`任务创建成功！`, ""];
          lines.push(formatTask(task, 1));

          return { content: lines.join("\n") };
        }

        case "complete": {
          if (!taskId) {
            return {
              content: "标记完成失败：缺少必填参数 task_id（任务 ID）。",
              isError: true,
            };
          }

          const encodedTaskId = encodeURIComponent(taskId);
          const url = `${BASE_URL}/lists/${encodedList}/tasks/${encodedTaskId}`;
          const res = await googleFetch(url, {
            method: "PATCH",
            body: JSON.stringify({ status: "completed" }),
          });

          if (!res.ok) {
            const errBody = await res.text();
            return {
              content: `标记任务完成失败（${res.status}）：${errBody}`,
              isError: true,
            };
          }

          const task = (await res.json()) as GoogleTask;
          return {
            content: `任务「${task.title}」已标记为完成。`,
          };
        }

        case "delete": {
          if (!taskId) {
            return {
              content: "删除任务失败：缺少必填参数 task_id（任务 ID）。",
              isError: true,
            };
          }

          const encodedTaskId = encodeURIComponent(taskId);
          const url = `${BASE_URL}/lists/${encodedList}/tasks/${encodedTaskId}`;
          const res = await googleFetch(url, { method: "DELETE" });

          if (!res.ok) {
            const errBody = await res.text();
            return {
              content: `删除任务失败（${res.status}）：${errBody}`,
              isError: true,
            };
          }

          // DELETE 成功返回 204 No Content
          return {
            content: `任务（ID：${taskId}）已成功删除。`,
          };
        }

        default: {
          return {
            content: `不支持的操作：${action}。有效操作为：list、create、complete、delete。`,
            isError: true,
          };
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: `Google Tasks 操作出错：${message}`,
        isError: true,
      };
    }
  },
};
