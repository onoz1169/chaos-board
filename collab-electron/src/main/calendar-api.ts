import { google } from "googleapis";
import type { calendar_v3 } from "googleapis";
import type { AppConfig } from "./config";
import { buildAuthedClient } from "./calendar-auth";

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  description?: string;
  location?: string;
  htmlLink?: string;
  calendarId?: string;
  color?: string;
}

export interface CalendarInfo {
  id: string;
  summary: string;
  backgroundColor: string;
  foregroundColor: string;
  primary: boolean;
}

export interface EventInput {
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  description?: string;
  location?: string;
}

export async function fetchCalendarList(config: AppConfig): Promise<CalendarInfo[]> {
  const auth = buildAuthedClient(config);
  if (!auth) throw new Error("Not authenticated");

  const calendar = google.calendar({ version: "v3", auth });
  const res = await calendar.calendarList.list({ minAccessRole: "reader" });

  return (res.data.items ?? []).map((c) => ({
    id: c.id ?? "",
    summary: c.summary ?? c.id ?? "",
    backgroundColor: c.backgroundColor ?? "#4a9eff",
    foregroundColor: c.foregroundColor ?? "#ffffff",
    primary: !!c.primary,
  }));
}

export async function fetchEvents(
  config: AppConfig,
  timeMin: string,
  timeMax: string,
  calendarIds: string[] = ["primary"],
): Promise<CalendarEvent[]> {
  const auth = buildAuthedClient(config);
  if (!auth) throw new Error("Not authenticated");

  const calendar = google.calendar({ version: "v3", auth });

  const results = await Promise.all(
    calendarIds.map(async (calendarId) => {
      const res = await calendar.events.list({
        calendarId,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 250,
      });
      return (res.data.items ?? []).map((e) => {
        const isAllDay = !!e.start?.date;
        return {
          id: `${calendarId}::${e.id ?? ""}`,
          title: e.summary ?? "(No title)",
          start: e.start?.dateTime ?? e.start?.date ?? "",
          end: e.end?.dateTime ?? e.end?.date ?? "",
          allDay: isAllDay,
          description: e.description ?? undefined,
          location: e.location ?? undefined,
          htmlLink: e.htmlLink ?? undefined,
          calendarId,
          color: e.colorId ?? undefined,
        };
      });
    }),
  );

  return results.flat();
}

export async function createEvent(
  config: AppConfig,
  input: EventInput,
): Promise<CalendarEvent> {
  const auth = buildAuthedClient(config);
  if (!auth) throw new Error("Not authenticated");

  const calendar = google.calendar({ version: "v3", auth });

  const body: calendar_v3.Schema$Event = {
    summary: input.title,
    description: input.description,
    location: input.location,
  };

  if (input.allDay) {
    body.start = { date: input.start.split("T")[0] };
    body.end = { date: input.end.split("T")[0] };
  } else {
    body.start = { dateTime: input.start, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    body.end = { dateTime: input.end, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  }

  const res = await calendar.events.insert({ calendarId: "primary", requestBody: body });
  const e = res.data;
  return {
    id: e.id ?? "",
    title: e.summary ?? "(No title)",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    allDay: !!e.start?.date,
    description: e.description ?? undefined,
    location: e.location ?? undefined,
    htmlLink: e.htmlLink ?? undefined,
  };
}

export async function updateEvent(
  config: AppConfig,
  eventId: string,
  input: EventInput,
): Promise<CalendarEvent> {
  const auth = buildAuthedClient(config);
  if (!auth) throw new Error("Not authenticated");

  const calendar = google.calendar({ version: "v3", auth });

  const body: calendar_v3.Schema$Event = {
    summary: input.title,
    description: input.description,
    location: input.location,
  };

  if (input.allDay) {
    body.start = { date: input.start.split("T")[0] };
    body.end = { date: input.end.split("T")[0] };
  } else {
    body.start = { dateTime: input.start, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    body.end = { dateTime: input.end, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  }

  const [parsedCalendarId, parsedEventId] = eventId.includes("::")
    ? eventId.split("::", 2)
    : ["primary", eventId];
  const res = await calendar.events.update({ calendarId: parsedCalendarId, eventId: parsedEventId, requestBody: body });
  const e = res.data;
  return {
    id: e.id ?? "",
    title: e.summary ?? "(No title)",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    allDay: !!e.start?.date,
    description: e.description ?? undefined,
    location: e.location ?? undefined,
    htmlLink: e.htmlLink ?? undefined,
  };
}
