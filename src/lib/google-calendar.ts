import { supabase } from "./supabase";

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

export async function exchangeGoogleCode(code: string): Promise<void> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error_description ?? "Falha ao conectar Google Agenda");

  const { access_token, refresh_token, expires_in } = json;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Usuário não autenticado");

  const expires_at = new Date(Date.now() + expires_in * 1000).toISOString();

  const { error } = await supabase.from("google_calendar_tokens").upsert(
    { user_id: user.id, access_token, refresh_token, expires_at },
    { onConflict: "user_id" }
  );
  if (error) throw error;
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
  const expires_at = new Date(Date.now() + expires_in * 1000).toISOString();

  await supabase
    .from("google_calendar_tokens")
    .update({ access_token, expires_at })
    .eq("user_id", userId);

  return access_token;
}

export async function getValidToken(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("google_calendar_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", user.id)
    .single();

  if (!data) return null;

  const expiresAt = new Date(data.expires_at);
  const bufferMs = 5 * 60 * 1000;

  if (expiresAt.getTime() > Date.now() + bufferMs) {
    return data.access_token;
  }

  if (!data.refresh_token) return null;
  return refreshToken(user.id, data.refresh_token);
}

export async function isGoogleCalendarConnected(): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { data } = await supabase
    .from("google_calendar_tokens")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  return !!data;
}

export async function disconnectGoogleCalendar(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("google_calendar_tokens").delete().eq("user_id", user.id);
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
