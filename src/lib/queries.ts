import { supabase } from "./supabase";
import type { ClientStatus, PeriodType, ReportStatus, TaskStatus } from "./database.types";

export type { ClientStatus, PeriodType, ReportStatus };

export interface ClientRow {
  id: string;
  name: string;
  meta_ad_account_id: string;
  meta_page_id: string | null;
  meta_whatsapp_number: string | null;
  segment: "popular" | "premium";
  cpl_min: number;
  cpl_max: number;
  active: boolean;
  created_at: string;
  meta_balance: number | null;
  payment_method: "pix" | "cartao";
  monthly_budget: number | null;
  pix_cycle: "semanal" | "quinzenal" | "mensal" | null;
  pix_reference_day: number | null;
  pix_active: boolean;
}

export interface MetricRow {
  date: string;
  spend: number;
  leads: number;
  cpl: number | null;
}

export interface ClientWithToday extends ClientRow {
  status: ClientStatus;
  cplToday: number | null;
  spendToday: number;
  leadsToday: number;
}

export interface ClientDetail extends ClientRow {
  status: ClientStatus;
  cplToday: number | null;
  spendToday: number;
  leadsToday: number;
  history: MetricRow[];
}

function computeStatus(
  cpl: number | null,
  spend: number,
  cplMax: number
): ClientStatus {
  if (spend === 0) return "no-data";
  if (cpl === null) return "critical";
  if (cpl <= cplMax) return "on-target";
  if (cpl <= cplMax * 1.3) return "attention";
  return "critical";
}

export type DashboardPeriod = "today" | "yesterday" | "last_7d" | "last_30d" | "this_month";

function periodDateRange(period: DashboardPeriod): { start: string; end: string } {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const today = iso(now);
  const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86400000));
  switch (period) {
    case "today":      return { start: today, end: today };
    case "yesterday":  return { start: daysAgo(1), end: daysAgo(1) };
    case "last_7d":    return { start: daysAgo(6), end: today };
    case "last_30d":   return { start: daysAgo(29), end: today };
    case "this_month": return { start: iso(new Date(now.getFullYear(), now.getMonth(), 1)), end: today };
  }
}

export async function fetchClients(period: DashboardPeriod = "today"): Promise<ClientWithToday[]> {
  const { start, end } = periodDateRange(period);
  const today = new Date().toISOString().slice(0, 10);

  const { data: clients, error } = await supabase
    .from("clients")
    .select("*")
    .eq("active", true)
    .order("name");

  if (error) throw error;

  const periodQuery = supabase
    .from("metrics_daily")
    .select("client_id, spend, leads, cpl")
    .gte("date", start)
    .lte("date", end);

  type PeriodRow = { client_id: string; spend: number; leads: number; cpl: number | null };
  type TodayRow  = { client_id: string; spend: number; cpl: number | null };

  if (period === "today") {
    const { data: metrics } = await periodQuery as { data: PeriodRow[] | null };
    const metricsMap = new Map<string, PeriodRow>();
    for (const m of metrics ?? []) metricsMap.set(m.client_id, m);

    return (clients as ClientRow[]).map((c) => {
      const m = metricsMap.get(c.id);
      const spend = m?.spend ?? 0;
      const leads = m?.leads ?? 0;
      const cpl = m?.cpl ?? null;
      return { ...c, spendToday: spend, leadsToday: leads, cplToday: cpl, status: computeStatus(cpl, spend, c.cpl_max) };
    });
  }

  const [{ data: periodRows }, { data: todayRows }] = await Promise.all([
    periodQuery as unknown as Promise<{ data: PeriodRow[] | null }>,
    supabase.from("metrics_daily").select("client_id, spend, cpl").eq("date", today) as unknown as Promise<{ data: TodayRow[] | null }>,
  ]);

  const metricsMap = new Map<string, { spend: number; leads: number }>();
  for (const m of periodRows ?? []) {
    const cur = metricsMap.get(m.client_id) ?? { spend: 0, leads: 0 };
    metricsMap.set(m.client_id, { spend: cur.spend + m.spend, leads: cur.leads + m.leads });
  }
  const todayMap = new Map((todayRows ?? []).map((m) => [m.client_id, m]));

  return (clients as ClientRow[]).map((c) => {
    const agg = metricsMap.get(c.id);
    const spend = agg?.spend ?? 0;
    const leads = agg?.leads ?? 0;
    const cpl = leads > 0 ? spend / leads : null;
    const td = todayMap.get(c.id);
    return {
      ...c,
      spendToday: spend,
      leadsToday: leads,
      cplToday: cpl,
      status: computeStatus(td?.cpl ?? null, td?.spend ?? 0, c.cpl_max),
    };
  });
}

export async function fetchAllClients(): Promise<ClientRow[]> {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .order("name");
  if (error) throw error;
  return data as ClientRow[];
}

export async function fetchClientDetail(id: string): Promise<ClientDetail> {
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000)
    .toISOString()
    .slice(0, 10);

  const [{ data: client, error }, { data: history }] = await Promise.all([
    supabase.from("clients").select("*").eq("id", id).single(),
    supabase
      .from("metrics_daily")
      .select("date, spend, leads, cpl")
      .eq("client_id", id)
      .gte("date", thirtyDaysAgo)
      .order("date"),
  ]);

  if (error || !client) throw error ?? new Error("Cliente não encontrado");

  const todayMetric = (history ?? []).find((m) => m.date === today);
  const spend = todayMetric?.spend ?? 0;
  const leads = todayMetric?.leads ?? 0;
  const cpl = todayMetric?.cpl ?? null;

  return {
    ...(client as ClientRow),
    spendToday: spend,
    leadsToday: leads,
    cplToday: cpl,
    status: computeStatus(cpl, spend, client.cpl_max),
    history: history ?? [],
  };
}

export async function upsertClient(data: {
  id?: string;
  name: string;
  meta_ad_account_id: string;
  meta_page_id?: string;
  meta_whatsapp_number?: string;
  segment: "popular" | "premium";
  cpl_min: number;
  cpl_max: number;
  payment_method?: "pix" | "cartao";
  pix_active?: boolean;
  monthly_budget?: number | null;
  pix_cycle?: "semanal" | "quinzenal" | "mensal" | null;
  pix_reference_day?: number | null;
}) {
  const { error } = await supabase.from("clients").upsert({
    ...data,
    active: true,
  });
  if (error) throw error;
}

export async function toggleClientActive(id: string, active: boolean) {
  const { error } = await supabase
    .from("clients")
    .update({ active })
    .eq("id", id);
  if (error) throw error;
}

export async function updateClientGoal(
  id: string,
  cpl_min: number,
  cpl_max: number
) {
  const { error } = await supabase
    .from("clients")
    .update({ cpl_min, cpl_max })
    .eq("id", id);
  if (error) throw error;
}

export interface ClientBalance {
  id: string;
  name: string;
  segment: "popular" | "premium";
  payment_method: "pix" | "cartao";
  meta_balance: number | null;
  spendToday: number;
}

export async function fetchClientBalances(): Promise<ClientBalance[]> {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  const [{ data: clients }, { data: metrics }] = await Promise.all([
    supabase.from("clients").select("id, name, segment, payment_method, meta_balance").eq("active", true).order("name"),
    supabase.from("metrics_daily").select("client_id, spend").eq("date", yesterday),
  ]);

  const metricsMap = new Map((metrics ?? []).map((m) => [m.client_id, m.spend as number]));

  return (clients ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    segment: c.segment as "popular" | "premium",
    payment_method: (c.payment_method ?? "pix") as "pix" | "cartao",
    meta_balance: c.meta_balance ?? null,
    spendToday: metricsMap.get(c.id) ?? 0,
  }));
}

// ─── Notas ───────────────────────────────────────────────────────────────────

export interface NoteWithClient {
  id: string;
  client_id: string;
  client_name: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export async function fetchNotes(clientId?: string): Promise<NoteWithClient[]> {
  let query = supabase
    .from("client_notes")
    .select("id, client_id, content, created_at, updated_at, clients(name)")
    .order("created_at", { ascending: false });

  if (clientId) query = query.eq("client_id", clientId);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: row.id,
    client_id: row.client_id,
    client_name: row.clients?.name ?? "",
    content: row.content,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

export async function createNote(payload: {
  client_id: string;
  content: string;
}): Promise<NoteWithClient> {
  const { data, error } = await supabase
    .from("client_notes")
    .insert(payload)
    .select("id, client_id, content, created_at, updated_at, clients(name)")
    .single();
  if (error) throw error;
  return {
    id: (data as any).id,
    client_id: (data as any).client_id,
    client_name: (data as any).clients?.name ?? "",
    content: (data as any).content,
    created_at: (data as any).created_at,
    updated_at: (data as any).updated_at,
  };
}

export async function updateNote(id: string, content: string): Promise<void> {
  const { error } = await supabase
    .from("client_notes")
    .update({ content, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteNote(id: string): Promise<void> {
  const { error } = await supabase.from("client_notes").delete().eq("id", id);
  if (error) throw error;
}

// ─── Relatórios ──────────────────────────────────────────────────────────────

export interface ReportWithClient {
  id: string;
  client_id: string;
  client_name: string;
  period_type: PeriodType;
  period_start: string;
  status: ReportStatus;
  sent_at: string | null;
  created_at: string;
}

export async function fetchReports(): Promise<ReportWithClient[]> {
  const { data, error } = await supabase
    .from("report_log")
    .select("id, client_id, period_type, period_start, status, sent_at, created_at, clients(name)")
    .order("created_at", { ascending: false });
  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: row.id,
    client_id: row.client_id,
    client_name: row.clients?.name ?? "",
    period_type: row.period_type as PeriodType,
    period_start: row.period_start,
    status: row.status as ReportStatus,
    sent_at: row.sent_at,
    created_at: row.created_at,
  }));
}

export async function createReport(payload: {
  client_id: string;
  period_type: PeriodType;
  period_start: string;
}): Promise<void> {
  const { error } = await supabase.from("report_log").insert({
    ...payload,
    status: "pendente",
  });
  if (error) throw error;
}

export async function markReportSent(id: string): Promise<void> {
  const { error } = await supabase
    .from("report_log")
    .update({ status: "enviado", sent_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function markReportPending(id: string): Promise<void> {
  const { error } = await supabase
    .from("report_log")
    .update({ status: "pendente", sent_at: null })
    .eq("id", id);
  if (error) throw error;
}

export async function updateReport(
  id: string,
  fields: { period_type?: PeriodType; period_start?: string; sent_at?: string | null }
): Promise<void> {
  const { error } = await supabase.from("report_log").update(fields).eq("id", id);
  if (error) throw error;
}

export async function deleteReport(id: string): Promise<void> {
  const { error } = await supabase.from("report_log").delete().eq("id", id);
  if (error) throw error;
}

// ── Conversation templates ─────────────────────────────────────

export interface ConversationTemplate {
  id: string;
  name: string;
  greeting: string | null;
  pre_message: string | null;
  created_at: string;
}

export async function fetchConversationTemplates(): Promise<ConversationTemplate[]> {
  const { data, error } = await supabase
    .from("conversation_templates")
    .select("*")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function upsertConversationTemplate(template: {
  id?: string;
  name: string;
  greeting?: string | null;
  pre_message?: string | null;
}): Promise<ConversationTemplate> {
  const payload = {
    ...(template.id ? { id: template.id } : {}),
    name: template.name,
    greeting: template.greeting ?? null,
    pre_message: template.pre_message ?? null,
  };
  const { data, error } = await supabase
    .from("conversation_templates")
    .upsert(payload, { onConflict: "id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteConversationTemplate(id: string): Promise<void> {
  const { error } = await supabase.from("conversation_templates").delete().eq("id", id);
  if (error) throw error;
}

// ── PIX ────────────────────────────────────────────────────────

export interface PixClient {
  id: string;
  name: string;
  monthly_budget: number;
  pix_cycle: "semanal" | "quinzenal" | "mensal";
  pix_reference_day: number;
}

export async function fetchPixClients(): Promise<PixClient[]> {
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, monthly_budget, pix_cycle, pix_reference_day")
    .eq("pix_active", true)
    .eq("active", true)
    .order("name");
  if (error) throw error;
  return (data ?? []).filter(
    (c) => c.monthly_budget !== null && c.pix_cycle !== null && c.pix_reference_day !== null
  ) as PixClient[];
}

export async function updateClientPix(
  id: string,
  fields: {
    pix_active: boolean;
    monthly_budget: number | null;
    pix_cycle: "semanal" | "quinzenal" | "mensal" | null;
    pix_reference_day: number | null;
  }
): Promise<void> {
  const { error } = await supabase.from("clients").update(fields).eq("id", id);
  if (error) throw error;
}

// ── Profiles ─────────────────────────────────────────────────────────────────

export interface Profile {
  id: string;
  full_name: string;
}

export async function fetchCurrentProfile(): Promise<Profile | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("id", user.id)
    .single();
  if (error) return null;
  return data as Profile;
}

export async function fetchProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .order("full_name");
  if (error) throw error;
  return (data ?? []) as Profile[];
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export interface TaskRow {
  id: string;
  title: string;
  status: TaskStatus;
  due_date: string | null;
  client_id: string | null;
  client_name: string | null;
  assigned_to: string | null;
  assignee_name: string | null;
  created_by: string | null;
  created_at: string;
}

export async function fetchTasks(): Promise<TaskRow[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select(`
      id, title, status, due_date, client_id, assigned_to, created_by, created_at,
      clients:client_id (name),
      assignee:assigned_to (full_name)
    `)
    .order("created_at", { ascending: false });
  if (error) throw error;

  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status as TaskStatus,
    due_date: r.due_date,
    client_id: r.client_id,
    client_name: r.clients?.name ?? null,
    assigned_to: r.assigned_to,
    assignee_name: r.assignee?.full_name ?? null,
    created_by: r.created_by,
    created_at: r.created_at,
  }));
}

export async function createTask(fields: {
  title: string;
  status: TaskStatus;
  due_date?: string | null;
  client_id?: string | null;
  assigned_to?: string | null;
}): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("tasks").insert({
    ...fields,
    created_by: user?.id ?? null,
  });
  if (error) throw error;
}

export async function updateTask(
  id: string,
  fields: {
    title?: string;
    status?: TaskStatus;
    due_date?: string | null;
    client_id?: string | null;
    assigned_to?: string | null;
  }
): Promise<void> {
  const { error } = await supabase.from("tasks").update(fields).eq("id", id);
  if (error) throw error;
}

export async function deleteTask(id: string): Promise<void> {
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) throw error;
}
