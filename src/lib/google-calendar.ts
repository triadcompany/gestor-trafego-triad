import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { googleCalendarTokens } from "@/db/schema";
import { getSessionUserId } from "@/server/session";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;
const CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET as string;
const REDIRECT_URI = import.meta.env.VITE_GOOGLE_REDIRECT_URI as string;

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "openid",
  "email",
].join(" ");

export function getGoogleAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

const _exchangeGoogleCode = createServerFn({ method: "POST" })
  .inputValidator(z.object({ code: z.string() }))
  .handler(async ({ data }) => {
    const userId = await getSessionUserId();
    if (!userId) throw new Error("Usuário não autenticado");

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: data.code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    const json = await res.json();
    if (!res.ok) throw new Error(json.error_description ?? "Falha ao conectar Google Agenda");

    const { access_token, refresh_token, expires_in } = json;
    const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString();

    await db
      .insert(googleCalendarTokens)
      .values({ userId, accessToken: access_token, refreshToken: refresh_token, expiresAt })
      .onConflictDoUpdate({
        target: googleCalendarTokens.userId,
        set: { accessToken: access_token, refreshToken: refresh_token, expiresAt },
      });
  });

export async function exchangeGoogleCode(code: string): Promise<void> {
  await _exchangeGoogleCode({ data: { code } });
}

async function refreshToken(userId: string, refreshTokenValue: string): Promise<string | null> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshTokenValue,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) return null;

  const { access_token, expires_in } = await res.json();
  const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString();

  await db
    .update(googleCalendarTokens)
    .set({ accessToken: access_token, expiresAt })
    .where(eq(googleCalendarTokens.userId, userId));

  return access_token;
}

const _getValidToken = createServerFn({ method: "GET" }).handler(async (): Promise<string | null> => {
  const userId = await getSessionUserId();
  if (!userId) return null;

  const rows = await db
    .select({ accessToken: googleCalendarTokens.accessToken, refreshToken: googleCalendarTokens.refreshToken, expiresAt: googleCalendarTokens.expiresAt })
    .from(googleCalendarTokens)
    .where(eq(googleCalendarTokens.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const expiresAt = new Date(row.expiresAt);
  const bufferMs = 5 * 60 * 1000;

  if (expiresAt.getTime() > Date.now() + bufferMs) {
    return row.accessToken;
  }

  if (!row.refreshToken) return null;
  return refreshToken(userId, row.refreshToken);
});

export async function getValidToken(): Promise<string | null> {
  return _getValidToken();
}

const _isGoogleCalendarConnected = createServerFn({ method: "GET" }).handler(async (): Promise<boolean> => {
  const userId = await getSessionUserId();
  if (!userId) return false;

  const rows = await db.select({ id: googleCalendarTokens.id }).from(googleCalendarTokens).where(eq(googleCalendarTokens.userId, userId)).limit(1);
  return rows.length > 0;
});

export async function isGoogleCalendarConnected(): Promise<boolean> {
  return _isGoogleCalendarConnected();
}

const _disconnectGoogleCalendar = createServerFn({ method: "POST" }).handler(async () => {
  const userId = await getSessionUserId();
  if (!userId) return;
  await db.delete(googleCalendarTokens).where(eq(googleCalendarTokens.userId, userId));
});

export async function disconnectGoogleCalendar(): Promise<void> {
  await _disconnectGoogleCalendar();
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  color: string;
}

export async function fetchCalendarEvents(
  timeMin: Date,
  timeMax: Date,
): Promise<CalendarEvent[]> {
  const token = await getValidToken();
  if (!token) return [];

  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) return [];

  const { items = [] } = await res.json();

  return (items as any[]).map((item) => {
    const isAllDay = !!item.start?.date;
    return {
      id: item.id,
      title: item.summary ?? "(sem título)",
      start: new Date(item.start?.dateTime ?? item.start?.date),
      end: new Date(item.end?.dateTime ?? item.end?.date),
      allDay: isAllDay,
      color: "#3b82f6",
    };
  });
}
