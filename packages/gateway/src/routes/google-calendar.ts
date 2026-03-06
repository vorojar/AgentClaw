import type { FastifyInstance } from "fastify";
import { runGws } from "../gws.js";

/** Normalized calendar event */
interface CalendarEvent {
  id: string;
  summary: string;
  description: string;
  start: string; // ISO dateTime or date
  end: string;
  allDay: boolean;
  location?: string;
  htmlLink?: string;
}

function normalizeEvent(raw: Record<string, unknown>): CalendarEvent {
  const startObj = raw.start as Record<string, string> | undefined;
  const endObj = raw.end as Record<string, string> | undefined;
  const allDay = !!(startObj?.date && !startObj?.dateTime);

  return {
    id: raw.id as string,
    summary: (raw.summary as string) || "(no title)",
    description: (raw.description as string) || "",
    start: startObj?.dateTime || startObj?.date || "",
    end: endObj?.dateTime || endObj?.date || "",
    allDay,
    location: raw.location as string | undefined,
    htmlLink: raw.htmlLink as string | undefined,
  };
}

export function registerGoogleCalendarRoutes(app: FastifyInstance): void {
  // GET /api/google-calendar?days=7
  app.get<{
    Querystring: { days?: string; calendarId?: string };
  }>("/api/google-calendar", async (req, reply) => {
    const days = Math.min(parseInt(req.query.days || "14", 10), 90);
    const calendarId = req.query.calendarId || "primary";

    const now = new Date();
    const timeMin = now.toISOString();
    const future = new Date(now.getTime() + days * 86400_000);
    const timeMax = future.toISOString();

    const result = await runGws([
      "calendar",
      "events",
      "list",
      "--params",
      JSON.stringify({
        calendarId,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 50,
      }),
    ]);

    if (!result.ok) {
      return reply.status(502).send({ error: result.error });
    }

    const data = result.data as { items?: Record<string, unknown>[] };
    const items = (data?.items || []).map(normalizeEvent);
    return reply.send({ items });
  });
}
