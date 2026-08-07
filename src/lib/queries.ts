import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import {
  campaignSnapshots,
  clientNotes,
  clientTags,
  clients,
  conversationTemplates,
  metricsDaily,
  profiles,
  reportLog,
  sales,
  salesGoals,
  tags,
  tasks,
} from "@/db/schema";
import { getSessionUserId } from "@/server/session";
import type { ClientStatus, PeriodType, ReportStatus, TaskStatus } from "./database.types";
import { getMetaToken, fetchAccountInsightsForRange } from "./meta";

export type { ClientStatus, PeriodType, ReportStatus };

export interface TagRow {
  id: string;
  name: string;
  color: string;
}

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
  tags?: TagRow[];
}

export interface MetricRow {
  date: string;
  spend: number;
  leads: number;
  forms: number;
  cpl: number | null;
}

export interface ClientWithToday extends ClientRow {
  status: ClientStatus;
  cplToday: number | null;
  spendToday: number;
  leadsToday: number;
  formsToday: number;
}

export interface ClientDetail extends ClientRow {
  status: ClientStatus;
  cplToday: number | null;
  spendToday: number;
  leadsToday: number;
  formsToday: number;
  history: MetricRow[];
}

function toClientRow(c: typeof clients.$inferSelect): ClientRow {
  return {
    id: c.id,
    name: c.name,
    meta_ad_account_id: c.metaAdAccountId,
    meta_page_id: c.metaPageId,
    meta_whatsapp_number: c.metaWhatsappNumber,
    segment: c.segment as "popular" | "premium",
    cpl_min: c.cplMin,
    cpl_max: c.cplMax,
    active: c.active,
    created_at: c.createdAt,
    meta_balance: c.metaBalance,
    payment_method: c.paymentMethod as "pix" | "cartao",
    monthly_budget: c.monthlyBudget,
    pix_cycle: c.pixCycle as ClientRow["pix_cycle"],
    pix_reference_day: c.pixReferenceDay,
    pix_active: c.pixActive,
  };
}

function computeStatus(
  cpl: number | null,
  spend: number,
  cplMax: number
): ClientStatus {
  if (spend === 0) return "no-data";
  if (cpl === null || cpl < 0) return "critical";
  if (cpl <= cplMax) return "on-target";
  if (cpl <= cplMax * 1.3) return "attention";
  return "critical";
}

export type DashboardPeriod =
  | "today"
  | "yesterday"
  | "last_7d"
  | "last_30d"
  | "this_month"
  | "last_month"
  | "maximum"
  | "custom";

function periodDateRange(
  period: DashboardPeriod,
  customRange?: { since: string; until: string },
): { start: string; end: string } {
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
    case "last_month": {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last  = new Date(now.getFullYear(), now.getMonth(), 0);
      return { start: iso(first), end: iso(last) };
    }
    case "maximum":    return { start: "2000-01-01", end: today };
    case "custom":
      return customRange
        ? { start: customRange.since, end: customRange.until }
        : { start: today, end: today };
  }
}

const _fetchActiveClients = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await db.select().from(clients).where(eq(clients.active, true)).orderBy(clients.name);
  return rows.map(toClientRow);
});

const _fetchClientsForDate = createServerFn({ method: "GET" })
  .inputValidator(z.object({ date: z.string() }))
  .handler(async ({ data }) => {
    const [clientRows, metricRows] = await Promise.all([
      db.select().from(clients).where(eq(clients.active, true)).orderBy(clients.name),
      db
        .select({
          clientId: metricsDaily.clientId,
          spend: metricsDaily.spend,
          leads: metricsDaily.leads,
          forms: metricsDaily.forms,
          cpl: metricsDaily.cpl,
        })
        .from(metricsDaily)
        .where(eq(metricsDaily.date, data.date)),
    ]);
    return { clientRows: clientRows.map(toClientRow), metricRows };
  });

export async function fetchClients(
  period: DashboardPeriod = "today",
  customRange?: { since: string; until: string },
): Promise<ClientWithToday[]> {
  const { start, end } = periodDateRange(period, customRange);

  // Single-day (today / yesterday): usa metrics_daily cache — fast e sempre atualizado pelo auto-sync.
  // Uma única RPC (clientes + métricas juntos) em vez de duas, pra economizar uma ida-e-volta de rede.
  if (start === end) {
    const { clientRows, metricRows } = await _fetchClientsForDate({ data: { date: start } });

    const metricsMap = new Map<string, { spend: number; leads: number; forms: number; cpl: number | null }>();
    for (const m of metricRows) {
      metricsMap.set(m.clientId, { spend: m.spend, leads: m.leads, forms: m.forms ?? 0, cpl: m.cpl });
    }

    return clientRows.map((c) => {
      const agg = metricsMap.get(c.id);
      const spend = agg?.spend ?? 0;
      const leads = agg?.leads ?? 0;
      const forms = agg?.forms ?? 0;
      const cpl = agg?.cpl ?? (leads > 0 ? spend / leads : null);
      return { ...c, spendToday: spend, leadsToday: leads, formsToday: forms, cplToday: cpl, status: computeStatus(cpl, spend, c.cpl_max) };
    });
  }

  const clientRows = await _fetchActiveClients();

  // Multi-day: busca totais agregados direto na API do Meta (metrics_daily só guarda o dia atual)
  const token = await getMetaToken();

  if (!token) {
    return clientRows.map((c) => ({ ...c, spendToday: 0, leadsToday: 0, formsToday: 0, cplToday: null, status: "no-data" as ClientStatus }));
  }

  const results = await Promise.allSettled(
    clientRows.map((c) => fetchAccountInsightsForRange(c.meta_ad_account_id, token, start, end))
  );

  return clientRows.map((c, i) => {
    const result = results[i];
    if (result.status === "rejected") {
      return { ...c, spendToday: 0, leadsToday: 0, formsToday: 0, cplToday: null, status: "no-data" as ClientStatus };
    }
    const { spend, leads, forms } = result.value;
    const cpl = leads > 0 ? spend / leads : null;
    return { ...c, spendToday: spend, leadsToday: leads, formsToday: forms, cplToday: cpl, status: computeStatus(cpl, spend, c.cpl_max) };
  });
}

const _fetchAllClients = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await db.query.clients.findMany({
    orderBy: clients.name,
    with: { clientTags: { with: { tag: true } } },
  });
  return rows.map((c) => ({
    ...toClientRow(c),
    tags: c.clientTags.map((ct) => ct.tag).filter(Boolean) as TagRow[],
  }));
});

export async function fetchAllClients(): Promise<ClientRow[]> {
  return _fetchAllClients();
}

const _fetchClientDetail = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const today = new Date().toISOString().slice(0, 10);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

    const [client, history] = await Promise.all([
      db.query.clients.findFirst({
        where: eq(clients.id, data.id),
        with: { clientTags: { with: { tag: true } } },
      }),
      db
        .select({
          date: metricsDaily.date,
          spend: metricsDaily.spend,
          leads: metricsDaily.leads,
          forms: metricsDaily.forms,
          cpl: metricsDaily.cpl,
        })
        .from(metricsDaily)
        .where(and(eq(metricsDaily.clientId, data.id), gte(metricsDaily.date, thirtyDaysAgo)))
        .orderBy(metricsDaily.date),
    ]);

    if (!client) throw new Error("Cliente não encontrado");

    const todayMetric = history.find((m) => m.date === today);
    const spend = todayMetric?.spend ?? 0;
    const leads = todayMetric?.leads ?? 0;
    const forms = todayMetric?.forms ?? 0;
    const cpl = todayMetric?.cpl ?? null;

    return {
      ...toClientRow(client),
      tags: client.clientTags.map((ct) => ct.tag).filter(Boolean) as TagRow[],
      spendToday: spend,
      leadsToday: leads,
      formsToday: forms,
      cplToday: cpl,
      status: computeStatus(cpl, spend, client.cplMax),
      history: history.map((m) => ({ ...m, forms: m.forms ?? 0 })),
    };
  });

export async function fetchClientDetail(id: string): Promise<ClientDetail> {
  return _fetchClientDetail({ data: { id } });
}

const upsertClientSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  meta_ad_account_id: z.string(),
  meta_page_id: z.string().optional(),
  meta_whatsapp_number: z.string().optional(),
  segment: z.enum(["popular", "premium"]),
  cpl_min: z.number(),
  cpl_max: z.number(),
  payment_method: z.enum(["pix", "cartao"]).optional(),
  pix_active: z.boolean().optional(),
  monthly_budget: z.number().nullable().optional(),
  pix_cycle: z.enum(["semanal", "quinzenal", "mensal"]).nullable().optional(),
  pix_reference_day: z.number().nullable().optional(),
});

const _upsertClient = createServerFn({ method: "POST" })
  .inputValidator(upsertClientSchema)
  .handler(async ({ data }) => {
    const values = {
      ...(data.id ? { id: data.id } : {}),
      name: data.name,
      metaAdAccountId: data.meta_ad_account_id,
      metaPageId: data.meta_page_id ?? null,
      metaWhatsappNumber: data.meta_whatsapp_number ?? null,
      segment: data.segment,
      cplMin: data.cpl_min,
      cplMax: data.cpl_max,
      active: true,
      ...(data.payment_method !== undefined ? { paymentMethod: data.payment_method } : {}),
      ...(data.pix_active !== undefined ? { pixActive: data.pix_active } : {}),
      ...(data.monthly_budget !== undefined ? { monthlyBudget: data.monthly_budget ?? 0 } : {}),
      ...(data.pix_cycle !== undefined ? { pixCycle: data.pix_cycle } : {}),
      ...(data.pix_reference_day !== undefined ? { pixReferenceDay: data.pix_reference_day } : {}),
    };
    const [row] = await db
      .insert(clients)
      .values(values)
      .onConflictDoUpdate({ target: clients.id, set: values })
      .returning({ id: clients.id });
    return { id: row.id };
  });

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
}): Promise<{ id: string }> {
  return _upsertClient({ data });
}

// ── Tags ──────────────────────────────────────────────────────────────────────

const _fetchTags = createServerFn({ method: "GET" }).handler(async () => {
  return db.select({ id: tags.id, name: tags.name, color: tags.color }).from(tags).orderBy(tags.name);
});

export async function fetchTags(): Promise<TagRow[]> {
  return _fetchTags();
}

const _createTag = createServerFn({ method: "POST" })
  .inputValidator(z.object({ name: z.string(), color: z.string() }))
  .handler(async ({ data }) => {
    const [row] = await db
      .insert(tags)
      .values({ name: data.name, color: data.color })
      .returning({ id: tags.id, name: tags.name, color: tags.color });
    return row;
  });

export async function createTag(name: string, color: string): Promise<TagRow> {
  return _createTag({ data: { name, color } });
}

const _setClientTags = createServerFn({ method: "POST" })
  .inputValidator(z.object({ clientId: z.string(), tagIds: z.array(z.string()) }))
  .handler(async ({ data }) => {
    await db.transaction(async (tx) => {
      await tx.delete(clientTags).where(eq(clientTags.clientId, data.clientId));
      if (data.tagIds.length > 0) {
        await tx.insert(clientTags).values(data.tagIds.map((tagId) => ({ clientId: data.clientId, tagId })));
      }
    });
  });

export async function setClientTags(clientId: string, tagIds: string[]): Promise<void> {
  await _setClientTags({ data: { clientId, tagIds } });
}

const _toggleClientActive = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string(), active: z.boolean() }))
  .handler(async ({ data }) => {
    await db.update(clients).set({ active: data.active }).where(eq(clients.id, data.id));
  });

export async function toggleClientActive(id: string, active: boolean) {
  await _toggleClientActive({ data: { id, active } });
}

const _deleteClient = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await db.delete(clients).where(eq(clients.id, data.id));
  });

export async function deleteClient(id: string): Promise<void> {
  await _deleteClient({ data: { id } });
}

const _updateClientGoal = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string(), cpl_min: z.number(), cpl_max: z.number() }))
  .handler(async ({ data }) => {
    await db.update(clients).set({ cplMin: data.cpl_min, cplMax: data.cpl_max }).where(eq(clients.id, data.id));
  });

export async function updateClientGoal(id: string, cpl_min: number, cpl_max: number) {
  await _updateClientGoal({ data: { id, cpl_min, cpl_max } });
}

export interface ClientBalance {
  id: string;
  name: string;
  segment: "popular" | "premium";
  payment_method: "pix" | "cartao";
  meta_balance: number | null;
  spendToday: number;
}

const _fetchClientBalances = createServerFn({ method: "GET" }).handler(async () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  const [clientRows, metricRows] = await Promise.all([
    db
      .select({
        id: clients.id,
        name: clients.name,
        segment: clients.segment,
        paymentMethod: clients.paymentMethod,
        metaBalance: clients.metaBalance,
      })
      .from(clients)
      .where(eq(clients.active, true))
      .orderBy(clients.name),
    db.select({ clientId: metricsDaily.clientId, spend: metricsDaily.spend }).from(metricsDaily).where(eq(metricsDaily.date, yesterday)),
  ]);

  const metricsMap = new Map(metricRows.map((m) => [m.clientId, m.spend]));

  return clientRows.map((c) => ({
    id: c.id,
    name: c.name,
    segment: c.segment as "popular" | "premium",
    payment_method: (c.paymentMethod ?? "pix") as "pix" | "cartao",
    meta_balance: c.metaBalance ?? null,
    spendToday: metricsMap.get(c.id) ?? 0,
  }));
});

export async function fetchClientBalances(): Promise<ClientBalance[]> {
  return _fetchClientBalances();
}

// ─── Visão Geral (itens de atenção) ────────────────────────────────────────

export interface AttentionItem {
  clientId: string;
  clientName: string;
  type: "cpl_alto" | "sem_entrega" | "saldo_baixo";
  severity: "attention" | "critical";
  campaignId?: string;
  campaignName?: string;
  detail: string;
  value: string;
}

const brl = (reais: number) =>
  reais.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const _fetchAttentionItems = createServerFn({ method: "GET" }).handler(async (): Promise<AttentionItem[]> => {
  const items: AttentionItem[] = [];

  const campaignRows = await db
    .select({
      clientId: clients.id,
      clientName: clients.name,
      cplMax: clients.cplMax,
      campaignId: campaignSnapshots.campaignId,
      campaignName: campaignSnapshots.name,
      spend: campaignSnapshots.spend,
      cpl: campaignSnapshots.cpl,
    })
    .from(campaignSnapshots)
    .innerJoin(clients, eq(campaignSnapshots.clientId, clients.id))
    .where(and(eq(campaignSnapshots.status, "ACTIVE"), eq(clients.active, true)));

  for (const row of campaignRows) {
    if (row.cpl !== null && row.cpl > row.cplMax) {
      const severity = row.cpl <= row.cplMax * 1.3 ? "attention" : "critical";
      items.push({
        clientId: row.clientId,
        clientName: row.clientName,
        type: "cpl_alto",
        severity,
        campaignId: row.campaignId,
        campaignName: row.campaignName,
        detail: `Campanha "${row.campaignName}" · meta ${brl(row.cplMax)}`,
        value: brl(row.cpl),
      });
    } else if (row.spend === 0) {
      items.push({
        clientId: row.clientId,
        clientName: row.clientName,
        type: "sem_entrega",
        severity: "attention",
        campaignId: row.campaignId,
        campaignName: row.campaignName,
        detail: `Campanha "${row.campaignName}" ativa, sem gasto hoje`,
        value: brl(0),
      });
    }
  }

  const balances = await _fetchClientBalances();
  for (const b of balances) {
    if (b.meta_balance === null || b.spendToday <= 0) continue;
    const estimatedDays = b.meta_balance / (b.spendToday * 100);
    if (estimatedDays < 1) {
      items.push({
        clientId: b.id,
        clientName: b.name,
        type: "saldo_baixo",
        severity: "critical",
        detail: `Saldo cobre menos de 1 dia de veiculação (gasto médio: ${brl(b.spendToday)}/dia)`,
        value: brl(b.meta_balance / 100),
      });
    }
  }

  const severityOrder = { critical: 0, attention: 1 };
  return items.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
});

export async function fetchAttentionItems(): Promise<AttentionItem[]> {
  return _fetchAttentionItems();
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

const _fetchNotes = createServerFn({ method: "GET" })
  .inputValidator(z.object({ clientId: z.string().optional() }))
  .handler(async ({ data }) => {
    const rows = await db.query.clientNotes.findMany({
      where: data.clientId ? eq(clientNotes.clientId, data.clientId) : undefined,
      orderBy: desc(clientNotes.createdAt),
      with: { client: { columns: { name: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      client_id: row.clientId,
      client_name: row.client?.name ?? "",
      content: row.content,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    }));
  });

export async function fetchNotes(clientId?: string): Promise<NoteWithClient[]> {
  return _fetchNotes({ data: { clientId } });
}

const _createNote = createServerFn({ method: "POST" })
  .inputValidator(z.object({ client_id: z.string(), content: z.string() }))
  .handler(async ({ data }) => {
    const [row] = await db
      .insert(clientNotes)
      .values({ clientId: data.client_id, content: data.content })
      .returning();
    const client = await db.query.clients.findFirst({ where: eq(clients.id, row.clientId), columns: { name: true } });
    return {
      id: row.id,
      client_id: row.clientId,
      client_name: client?.name ?? "",
      content: row.content,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    };
  });

export async function createNote(payload: { client_id: string; content: string }): Promise<NoteWithClient> {
  return _createNote({ data: payload });
}

const _updateNote = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string(), content: z.string() }))
  .handler(async ({ data }) => {
    await db
      .update(clientNotes)
      .set({ content: data.content, updatedAt: new Date().toISOString() })
      .where(eq(clientNotes.id, data.id));
  });

export async function updateNote(id: string, content: string): Promise<void> {
  await _updateNote({ data: { id, content } });
}

const _deleteNote = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await db.delete(clientNotes).where(eq(clientNotes.id, data.id));
  });

export async function deleteNote(id: string): Promise<void> {
  await _deleteNote({ data: { id } });
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

const _fetchReports = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await db.query.reportLog.findMany({
    orderBy: desc(reportLog.createdAt),
    with: { client: { columns: { name: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    client_id: row.clientId,
    client_name: row.client?.name ?? "",
    period_type: row.periodType as PeriodType,
    period_start: row.periodStart,
    status: row.status as ReportStatus,
    sent_at: row.sentAt,
    created_at: row.createdAt,
  }));
});

export async function fetchReports(): Promise<ReportWithClient[]> {
  return _fetchReports();
}

const _createReport = createServerFn({ method: "POST" })
  .inputValidator(z.object({ client_id: z.string(), period_type: z.enum(["semanal", "mensal"]), period_start: z.string() }))
  .handler(async ({ data }) => {
    await db.insert(reportLog).values({
      clientId: data.client_id,
      periodType: data.period_type,
      periodStart: data.period_start,
      status: "pendente",
    });
  });

export async function createReport(payload: { client_id: string; period_type: PeriodType; period_start: string }): Promise<void> {
  await _createReport({ data: payload });
}

const _markReportSent = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await db.update(reportLog).set({ status: "enviado", sentAt: new Date().toISOString() }).where(eq(reportLog.id, data.id));
  });

export async function markReportSent(id: string): Promise<void> {
  await _markReportSent({ data: { id } });
}

const _markReportPending = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await db.update(reportLog).set({ status: "pendente", sentAt: null }).where(eq(reportLog.id, data.id));
  });

export async function markReportPending(id: string): Promise<void> {
  await _markReportPending({ data: { id } });
}

const _updateReport = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      id: z.string(),
      period_type: z.enum(["semanal", "mensal"]).optional(),
      period_start: z.string().optional(),
      sent_at: z.string().nullable().optional(),
    })
  )
  .handler(async ({ data }) => {
    const { id, ...fields } = data;
    await db
      .update(reportLog)
      .set({
        ...(fields.period_type !== undefined ? { periodType: fields.period_type } : {}),
        ...(fields.period_start !== undefined ? { periodStart: fields.period_start } : {}),
        ...(fields.sent_at !== undefined ? { sentAt: fields.sent_at } : {}),
      })
      .where(eq(reportLog.id, id));
  });

export async function updateReport(
  id: string,
  fields: { period_type?: PeriodType; period_start?: string; sent_at?: string | null }
): Promise<void> {
  await _updateReport({ data: { id, ...fields } });
}

const _deleteReport = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await db.delete(reportLog).where(eq(reportLog.id, data.id));
  });

export async function deleteReport(id: string): Promise<void> {
  await _deleteReport({ data: { id } });
}

// ── Conversation templates ─────────────────────────────────────

export interface ConversationTemplate {
  id: string;
  client_id: string | null;
  name: string;
  greeting: string | null;
  pre_message: string | null;
  created_at: string;
}

function toTemplate(row: typeof conversationTemplates.$inferSelect): ConversationTemplate {
  return {
    id: row.id,
    client_id: row.clientId,
    name: row.name,
    greeting: row.greeting,
    pre_message: row.preMessage,
    created_at: row.createdAt,
  };
}

const _fetchConversationTemplates = createServerFn({ method: "GET" })
  .inputValidator(z.object({ clientId: z.string() }))
  .handler(async ({ data }) => {
    const rows = await db
      .select()
      .from(conversationTemplates)
      .where(eq(conversationTemplates.clientId, data.clientId))
      .orderBy(conversationTemplates.name);
    return rows.map(toTemplate);
  });

export async function fetchConversationTemplates(clientId: string): Promise<ConversationTemplate[]> {
  return _fetchConversationTemplates({ data: { clientId } });
}

const _upsertConversationTemplate = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      id: z.string().optional(),
      clientId: z.string(),
      name: z.string(),
      greeting: z.string().nullable().optional(),
      pre_message: z.string().nullable().optional(),
    })
  )
  .handler(async ({ data }) => {
    const values = {
      ...(data.id ? { id: data.id } : {}),
      clientId: data.clientId,
      name: data.name,
      greeting: data.greeting ?? null,
      preMessage: data.pre_message ?? null,
    };
    const [row] = await db
      .insert(conversationTemplates)
      .values(values)
      .onConflictDoUpdate({ target: conversationTemplates.id, set: values })
      .returning();
    return toTemplate(row);
  });

export async function upsertConversationTemplate(template: {
  id?: string;
  clientId: string;
  name: string;
  greeting?: string | null;
  pre_message?: string | null;
}): Promise<ConversationTemplate> {
  return _upsertConversationTemplate({ data: template });
}

const _deleteConversationTemplate = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await db.delete(conversationTemplates).where(eq(conversationTemplates.id, data.id));
  });

export async function deleteConversationTemplate(id: string): Promise<void> {
  await _deleteConversationTemplate({ data: { id } });
}

// ── PIX ────────────────────────────────────────────────────────

export interface PixClient {
  id: string;
  name: string;
  monthly_budget: number;
  pix_cycle: "semanal" | "quinzenal" | "mensal";
  pix_reference_day: number;
  meta_ad_account_id: string;
}

const _fetchPixClients = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await db
    .select({
      id: clients.id,
      name: clients.name,
      monthlyBudget: clients.monthlyBudget,
      pixCycle: clients.pixCycle,
      pixReferenceDay: clients.pixReferenceDay,
      metaAdAccountId: clients.metaAdAccountId,
    })
    .from(clients)
    .where(and(eq(clients.pixActive, true), eq(clients.active, true)))
    .orderBy(clients.name);

  return rows
    .filter((c) => c.monthlyBudget !== null && c.pixCycle !== null && c.pixReferenceDay !== null)
    .map((c) => ({
      id: c.id,
      name: c.name,
      monthly_budget: c.monthlyBudget as number,
      pix_cycle: c.pixCycle as "semanal" | "quinzenal" | "mensal",
      pix_reference_day: c.pixReferenceDay as number,
      meta_ad_account_id: c.metaAdAccountId,
    }));
});

export async function fetchPixClients(): Promise<PixClient[]> {
  return _fetchPixClients();
}

const _updateClientPix = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      id: z.string(),
      pix_active: z.boolean(),
      monthly_budget: z.number().nullable(),
      pix_cycle: z.enum(["semanal", "quinzenal", "mensal"]).nullable(),
      pix_reference_day: z.number().nullable(),
    })
  )
  .handler(async ({ data }) => {
    await db
      .update(clients)
      .set({
        pixActive: data.pix_active,
        monthlyBudget: data.monthly_budget ?? 0,
        pixCycle: data.pix_cycle,
        pixReferenceDay: data.pix_reference_day,
      })
      .where(eq(clients.id, data.id));
  });

export async function updateClientPix(
  id: string,
  fields: {
    pix_active: boolean;
    monthly_budget: number | null;
    pix_cycle: "semanal" | "quinzenal" | "mensal" | null;
    pix_reference_day: number | null;
  }
): Promise<void> {
  await _updateClientPix({ data: { id, ...fields } });
}

// ── Profiles ─────────────────────────────────────────────────────────────────

export interface Profile {
  id: string;
  full_name: string;
}

export async function fetchCurrentProfile(): Promise<Profile | null> {
  const { getCurrentUser } = await import("@/server/session");
  const user = await getCurrentUser();
  if (!user) return null;
  return { id: user.id, full_name: user.fullName };
}

const _fetchProfiles = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await db.select({ id: profiles.id, fullName: profiles.fullName }).from(profiles).orderBy(profiles.fullName);
  return rows.map((r) => ({ id: r.id, full_name: r.fullName }));
});

export async function fetchProfiles(): Promise<Profile[]> {
  return _fetchProfiles();
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

function mapTask(r: {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  clientId: string | null;
  assignedTo: string | null;
  createdBy: string | null;
  createdAt: string;
  client?: { name: string } | null;
  assignee?: { fullName: string } | null;
}): TaskRow {
  return {
    id: r.id,
    title: r.title,
    status: r.status as TaskStatus,
    due_date: r.dueDate,
    client_id: r.clientId,
    client_name: r.client?.name ?? null,
    assigned_to: r.assignedTo,
    assignee_name: r.assignee?.fullName ?? null,
    created_by: r.createdBy,
    created_at: r.createdAt,
  };
}

const _fetchTasks = createServerFn({ method: "GET" })
  .inputValidator(z.object({ clientId: z.string().optional() }))
  .handler(async ({ data }) => {
    const rows = await db.query.tasks.findMany({
      where: data.clientId ? eq(tasks.clientId, data.clientId) : undefined,
      orderBy: desc(tasks.createdAt),
      with: {
        client: { columns: { name: true } },
        assignee: { columns: { fullName: true } },
      },
    });
    return rows.map(mapTask);
  });

export async function fetchTasks(): Promise<TaskRow[]> {
  return _fetchTasks({ data: {} });
}

export async function fetchTasksByClient(clientId: string): Promise<TaskRow[]> {
  return _fetchTasks({ data: { clientId } });
}

const _createTask = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      title: z.string(),
      status: z.enum(["pendente", "em_andamento", "concluida"]),
      due_date: z.string().nullable().optional(),
      client_id: z.string().nullable().optional(),
      assigned_to: z.string().nullable().optional(),
    })
  )
  .handler(async ({ data }) => {
    const userId = await getSessionUserId();
    await db.insert(tasks).values({
      title: data.title,
      status: data.status,
      dueDate: data.due_date ?? null,
      clientId: data.client_id ?? null,
      assignedTo: data.assigned_to ?? null,
      createdBy: userId,
    });
  });

export async function createTask(fields: {
  title: string;
  status: TaskStatus;
  due_date?: string | null;
  client_id?: string | null;
  assigned_to?: string | null;
}): Promise<void> {
  await _createTask({ data: fields });
}

const _updateTask = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      id: z.string(),
      title: z.string().optional(),
      status: z.enum(["pendente", "em_andamento", "concluida"]).optional(),
      due_date: z.string().nullable().optional(),
      client_id: z.string().nullable().optional(),
      assigned_to: z.string().nullable().optional(),
    })
  )
  .handler(async ({ data }) => {
    const { id, ...fields } = data;
    await db
      .update(tasks)
      .set({
        ...(fields.title !== undefined ? { title: fields.title } : {}),
        ...(fields.status !== undefined ? { status: fields.status } : {}),
        ...(fields.due_date !== undefined ? { dueDate: fields.due_date } : {}),
        ...(fields.client_id !== undefined ? { clientId: fields.client_id } : {}),
        ...(fields.assigned_to !== undefined ? { assignedTo: fields.assigned_to } : {}),
      })
      .where(eq(tasks.id, id));
  });

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
  await _updateTask({ data: { id, ...fields } });
}

const _deleteTask = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await db.delete(tasks).where(eq(tasks.id, data.id));
  });

export async function deleteTask(id: string): Promise<void> {
  await _deleteTask({ data: { id } });
}

// ── Vendas ────────────────────────────────────────────────────────────────────

export interface SaleRow {
  id: string;
  client_id: string;
  date: string;
  value: number | null;
  obs: string | null;
  created_at: string;
}

export interface SalesGoalRow {
  id: string;
  client_id: string;
  month: string;
  goal: number;
}

function toSaleRow(r: typeof sales.$inferSelect): SaleRow {
  return { id: r.id, client_id: r.clientId, date: r.date, value: r.value, obs: r.obs, created_at: r.createdAt };
}

const _fetchSales = createServerFn({ method: "GET" })
  .inputValidator(z.object({ clientId: z.string().optional(), since: z.string(), until: z.string() }))
  .handler(async ({ data }) => {
    const rows = await db
      .select()
      .from(sales)
      .where(
        and(
          data.clientId ? eq(sales.clientId, data.clientId) : undefined,
          gte(sales.date, data.since),
          lte(sales.date, data.until)
        )
      )
      .orderBy(desc(sales.date));
    return rows.map(toSaleRow);
  });

export async function fetchSales(since: string, until: string): Promise<SaleRow[]> {
  return _fetchSales({ data: { since, until } });
}

export async function fetchSalesByClient(clientId: string, since: string, until: string): Promise<SaleRow[]> {
  return _fetchSales({ data: { clientId, since, until } });
}

const _createSale = createServerFn({ method: "POST" })
  .inputValidator(z.object({ client_id: z.string(), date: z.string(), value: z.number().nullable().optional(), obs: z.string().nullable().optional() }))
  .handler(async ({ data }) => {
    await db.insert(sales).values({ clientId: data.client_id, date: data.date, value: data.value ?? null, obs: data.obs ?? null });
  });

export async function createSale(payload: { client_id: string; date: string; value?: number | null; obs?: string | null }): Promise<void> {
  await _createSale({ data: payload });
}

const _deleteSale = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await db.delete(sales).where(eq(sales.id, data.id));
  });

export async function deleteSale(id: string): Promise<void> {
  await _deleteSale({ data: { id } });
}

const _fetchSalesGoals = createServerFn({ method: "GET" })
  .inputValidator(z.object({ month: z.string() }))
  .handler(async ({ data }) => {
    const rows = await db
      .select({ id: salesGoals.id, clientId: salesGoals.clientId, month: salesGoals.month, goal: salesGoals.goal })
      .from(salesGoals)
      .where(eq(salesGoals.month, data.month));
    return rows.map((r) => ({ id: r.id, client_id: r.clientId, month: r.month, goal: r.goal }));
  });

export async function fetchSalesGoals(month: string): Promise<SalesGoalRow[]> {
  return _fetchSalesGoals({ data: { month } });
}

const _upsertSalesGoal = createServerFn({ method: "POST" })
  .inputValidator(z.object({ clientId: z.string(), month: z.string(), goal: z.number() }))
  .handler(async ({ data }) => {
    await db
      .insert(salesGoals)
      .values({ clientId: data.clientId, month: data.month, goal: data.goal })
      .onConflictDoUpdate({ target: [salesGoals.clientId, salesGoals.month], set: { goal: data.goal } });
  });

export async function upsertSalesGoal(clientId: string, month: string, goal: number): Promise<void> {
  await _upsertSalesGoal({ data: { clientId, month, goal } });
}
