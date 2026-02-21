import type { Tool, ToolResult } from "@agentclaw/types";
import { googleFetch } from "./google-auth.js";

const CALENDAR_API_BASE =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";

/** Google Calendar event item (partial) */
interface CalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  htmlLink?: string;
}

interface ListEventsResponse {
  items?: CalendarEvent[];
  nextPageToken?: string;
}

/** Format a single event for display */
function formatEvent(event: CalendarEvent): string {
  const title = event.summary ?? "(无标题)";

  let timeStr: string;
  if (event.start?.date) {
    // All-day event
    const endDate = event.end?.date ?? event.start.date;
    timeStr =
      event.start.date === endDate
        ? `全天 ${event.start.date}`
        : `全天 ${event.start.date} ~ ${endDate}`;
  } else if (event.start?.dateTime) {
    const start = new Date(event.start.dateTime);
    const end = event.end?.dateTime ? new Date(event.end.dateTime) : null;
    const fmt = (d: Date) =>
      d.toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    timeStr = end ? `${fmt(start)} ~ ${fmt(end)}` : fmt(start);
  } else {
    timeStr = "(未知时间)";
  }

  return `• ${title}\n  时间：${timeStr}\n  ID：${event.id}`;
}

/** Build ISO string for "now" */
function nowIso(): string {
  return new Date().toISOString();
}

/** Build ISO string for N days from now */
function daysFromNowIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export const googleCalendarTool: Tool = {
  name: "google_calendar",
  description: "管理 Google 日历：查询/创建/删除事件。",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "create", "delete"] },
      query: { type: "string" },
      time_min: { type: "string" },
      time_max: { type: "string" },
      summary: { type: "string" },
      description: { type: "string" },
      start_time: { type: "string" },
      end_time: { type: "string" },
      all_day: { type: "boolean", default: false },
      reminder_minutes: { type: "number", default: 10 },
      event_id: { type: "string" },
    },
    required: ["action"],
  },

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const action = input.action as string;

    try {
      // ─── LIST ────────────────────────────────────────────────────────────
      if (action === "list") {
        const timeMin = (input.time_min as string | undefined) ?? nowIso();
        const timeMax = (input.time_max as string | undefined) ?? daysFromNowIso(7);
        const query = input.query as string | undefined;

        const params = new URLSearchParams({
          timeMin,
          timeMax,
          singleEvents: "true",
          orderBy: "startTime",
          maxResults: "20",
        });
        if (query) {
          params.set("q", query);
        }

        const res = await googleFetch(`${CALENDAR_API_BASE}?${params.toString()}`);

        if (!res.ok) {
          const body = await res.text();
          return {
            content: `Google Calendar API 错误 (${res.status}): ${body}`,
            isError: true,
          };
        }

        const data = (await res.json()) as ListEventsResponse;
        const items = data.items ?? [];

        if (items.length === 0) {
          return {
            content: "在指定时间范围内没有找到任何日历事件。",
            metadata: { action, timeMin, timeMax, count: 0 },
          };
        }

        const lines = [`共找到 ${items.length} 个事件：`, ""];
        for (const event of items) {
          lines.push(formatEvent(event));
        }

        return {
          content: lines.join("\n"),
          metadata: { action, timeMin, timeMax, count: items.length },
        };
      }

      // ─── CREATE ───────────────────────────────────────────────────────────
      if (action === "create") {
        const summary = input.summary as string | undefined;
        if (!summary) {
          return {
            content: "创建事件时必须提供 summary（事件标题）。",
            isError: true,
          };
        }

        const startTimeStr = input.start_time as string | undefined;
        if (!startTimeStr) {
          return {
            content: "创建事件时必须提供 start_time（开始时间）。",
            isError: true,
          };
        }

        const allDay = Boolean(input.all_day);
        const description = input.description as string | undefined;

        let startField: { date: string } | { dateTime: string };
        let endField: { date: string } | { dateTime: string };

        if (allDay) {
          // Extract date portion only (YYYY-MM-DD)
          const startDate = startTimeStr.slice(0, 10);
          let endDate: string;
          if (input.end_time) {
            endDate = (input.end_time as string).slice(0, 10);
          } else {
            // For all-day events, Google Calendar uses exclusive end date
            const d = new Date(startDate);
            d.setDate(d.getDate() + 1);
            endDate = d.toISOString().slice(0, 10);
          }
          startField = { date: startDate };
          endField = { date: endDate };
        } else {
          const endTimeStr = input.end_time as string | undefined;
          let endDateTime: string;
          if (endTimeStr) {
            endDateTime = endTimeStr;
          } else {
            // Default: start + 1 hour
            const startDate = new Date(startTimeStr);
            startDate.setHours(startDate.getHours() + 1);
            endDateTime = startDate.toISOString();
          }
          startField = { dateTime: startTimeStr };
          endField = { dateTime: endDateTime };
        }

        const reminderMinutes =
          input.reminder_minutes !== undefined
            ? (input.reminder_minutes as number)
            : 10;

        const body: Record<string, unknown> = {
          summary,
          start: startField,
          end: endField,
          reminders: {
            useDefault: false,
            overrides: [{ method: "popup", minutes: reminderMinutes }],
          },
        };
        if (description) {
          body.description = description;
        }

        const res = await googleFetch(CALENDAR_API_BASE, {
          method: "POST",
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const errBody = await res.text();
          return {
            content: `创建事件失败 (${res.status}): ${errBody}`,
            isError: true,
          };
        }

        const created = (await res.json()) as CalendarEvent;
        return {
          content: `事件创建成功！\n${formatEvent(created)}`,
          metadata: { action, eventId: created.id },
        };
      }

      // ─── DELETE ───────────────────────────────────────────────────────────
      if (action === "delete") {
        const eventId = input.event_id as string | undefined;
        if (!eventId) {
          return {
            content: "删除事件时必须提供 event_id。",
            isError: true,
          };
        }

        const res = await googleFetch(`${CALENDAR_API_BASE}/${encodeURIComponent(eventId)}`, {
          method: "DELETE",
        });

        if (!res.ok) {
          // 404 means the event doesn't exist
          if (res.status === 404) {
            return {
              content: `未找到 ID 为 "${eventId}" 的事件，可能已被删除。`,
              isError: true,
            };
          }
          const errBody = await res.text();
          return {
            content: `删除事件失败 (${res.status}): ${errBody}`,
            isError: true,
          };
        }

        // 204 No Content on success
        return {
          content: `事件 "${eventId}" 已成功删除。`,
          metadata: { action, eventId },
        };
      }

      // ─── UNKNOWN ACTION ───────────────────────────────────────────────────
      return {
        content: `不支持的操作：${action}。支持的操作为 list、create、delete。`,
        isError: true,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: `Google Calendar 工具执行出错：${message}`,
        isError: true,
      };
    }
  },
};
