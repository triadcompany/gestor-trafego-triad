import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/db/client";
import { clients, metaLeadAttributions, sales, whatsappInstances } from "@/db/schema";
import { requireOrgContext } from "@/server/session";
import { canAccessClient } from "@/lib/client-access";
import { getMetaToken, getMetaTokenForClient, fetchAdSpendByIds, fetchAdCreativeMedia, fetchAccountInsightsForRange } from "@/lib/meta";
import { sendQualifiedLeadEvent, sendPurchaseEvent, sendCustomMessagingEvent } from "@/server/meta-capi";
import { periodDateRange, type DashboardPeriod } from "@/lib/queries";
import { isoDateInBrasilia, brasiliaMidnightUTC } from "@/lib/brasilia-date";

const periodInputSchema = z.object({
  clientId: z.string(),
  period: z
    .enum(["today", "yesterday", "last_3d", "last_7d", "last_30d", "this_month", "last_month", "maximum", "custom"])
    .optional(),
  customSince: z.string().optional(),
  customUntil: z.string().optional(),
});

const publicPeriodInputSchema = z.object({
  token: z.string(),
  period: z
    .enum(["today", "yesterday", "last_3d", "last_7d", "last_30d", "this_month", "last_month", "maximum", "custom"])
    .optional(),
  customSince: z.string().optional(),
  customUntil: z.string().optional(),
});

// Intervalo de datas em timestamps (o range vem em dias "YYYY-MM-DD", mas
// first_message_at é timestamp — precisa cobrir o dia inteiro do fim).
// minStartTs (só usado no link público) empurra o início pra frente quando o
// período pedido começa antes dele — nunca deixa ver antes disso.
function periodTimestampRange(period: DashboardPeriod | undefined, customSince?: string, customUntil?: string, minStartTs?: string) {
  const { start, end } = periodDateRange(period ?? "maximum", customSince && customUntil ? { since: customSince, until: customUntil } : undefined);
  let startTs = brasiliaMidnightUTC(start);
  if (minStartTs && minStartTs > startTs) startTs = minStartTs;
  return {
    startTs,
    endTsExclusive: new Date(new Date(brasiliaMidnightUTC(end)).getTime() + 86400000).toISOString(),
  };
}

// Piso de data pro link público de rastreamento: o gestor vê o histórico
// inteiro, mas o cliente só vê a partir de 1 dia depois de conectar o
// WhatsApp. Sem isso, se o WhatsApp foi conectado depois de campanhas já
// estarem ativas, o cliente veria "muitas conversas iniciadas" (a Meta já
// contava antes) e "poucos leads" (rastreamento só começou depois) sem
// entender que não é um problema — só que o rastreamento chegou atrasado.
async function getPublicReportFloorTs(clientId: string): Promise<string | undefined> {
  const client = await db.query.clients.findFirst({
    where: eq(clients.id, clientId),
    columns: { whatsappInstanceId: true },
  });
  if (!client?.whatsappInstanceId) return undefined;
  const instance = await db.query.whatsappInstances.findFirst({
    where: eq(whatsappInstances.id, client.whatsappInstanceId),
    columns: { createdAt: true },
  });
  if (!instance) return undefined;
  return new Date(new Date(instance.createdAt).getTime() + 86400000).toISOString();
}

// Dia da semana (0=domingo) e hora (0-23) no horário de Brasília, a partir de
// um timestamp UTC — usado pra montar o mapa de calor de horários.
function dayHourInSaoPaulo(input: string | Date): { day: number; hour: number } {
  const date = typeof input === "string" ? new Date(input) : input;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "00";
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = parseInt(hourStr, 10) % 24; // meia-noite pode vir como "24" dependendo do runtime
  return { day: dayMap[weekdayStr] ?? 0, hour };
}

// Resolve o cliente a partir do token do link público de rastreamento
// (/r/$token) — é a própria autenticação do link, sem sessão/organização.
// Exportada (via createServerOnlyFn, não plain function) porque outros
// módulos de servidor (ex: whatsapp-messages.ts) também precisam resolver o
// cliente a partir do mesmo token — sem o wrapper, o acesso a `db` aqui
// vazava o driver do Postgres pro bundle do navegador assim que outro
// arquivo importado por componentes client-side passou a importar esta
// função (mesmo bug já visto com getMetaTokenForClient em meta.ts).
export const resolvePublicClientId = createServerOnlyFn(async function resolvePublicClientId(token: string): Promise<string> {
  const client = await db.query.clients.findFirst({
    where: eq(clients.publicTrackingToken, token),
    columns: { id: true },
  });
  if (!client) throw new Error("Link inválido ou revogado.");
  return client.id;
});

export interface LeadTimeHeatmap {
  leads: number[][]; // [dia 0-6][hora 0-23]
  sales: number[][];
  totalLeads: number;
  totalSales: number;
}

async function getLeadTimeHeatmapCore(
  clientId: string,
  period: DashboardPeriod | undefined,
  customSince: string | undefined,
  customUntil: string | undefined,
  minStartTs: string | undefined,
): Promise<LeadTimeHeatmap> {
  const { startTs, endTsExclusive } = periodTimestampRange(period, customSince, customUntil, minStartTs);

  const leadRows = await db
    .select({ firstMessageAt: metaLeadAttributions.firstMessageAt })
    .from(metaLeadAttributions)
    .where(and(
      eq(metaLeadAttributions.clientId, clientId),
      gte(metaLeadAttributions.firstMessageAt, startTs),
      lt(metaLeadAttributions.firstMessageAt, endTsExclusive),
    ));

  const saleRows = await db
    .select({ createdAt: sales.createdAt })
    .from(sales)
    .innerJoin(metaLeadAttributions, eq(metaLeadAttributions.saleId, sales.id))
    .where(and(
      eq(metaLeadAttributions.clientId, clientId),
      gte(sales.createdAt, startTs),
      lt(sales.createdAt, endTsExclusive),
    ));

  const leads = Array.from({ length: 7 }, () => Array(24).fill(0));
  const salesGrid = Array.from({ length: 7 }, () => Array(24).fill(0));

  for (const r of leadRows) {
    const { day, hour } = dayHourInSaoPaulo(r.firstMessageAt);
    leads[day][hour]++;
  }
  for (const r of saleRows) {
    const { day, hour } = dayHourInSaoPaulo(r.createdAt);
    salesGrid[day][hour]++;
  }

  return { leads, sales: salesGrid, totalLeads: leadRows.length, totalSales: saleRows.length };
}

const _fetchLeadTimeHeatmap = createServerFn({ method: "GET" })
  .inputValidator(periodInputSchema)
  .handler(async ({ data }): Promise<LeadTimeHeatmap> => {
    await assertAccessible(data.clientId);
    return getLeadTimeHeatmapCore(data.clientId, data.period, data.customSince, data.customUntil, undefined);
  });

export async function fetchLeadTimeHeatmap(
  clientId: string,
  period?: DashboardPeriod,
  customRange?: { since: string; until: string },
): Promise<LeadTimeHeatmap> {
  return _fetchLeadTimeHeatmap({ data: { clientId, period, customSince: customRange?.since, customUntil: customRange?.until } });
}

const _fetchPublicLeadTimeHeatmap = createServerFn({ method: "GET" })
  .inputValidator(publicPeriodInputSchema)
  .handler(async ({ data }): Promise<LeadTimeHeatmap> => {
    const clientId = await resolvePublicClientId(data.token);
    const minStartTs = await getPublicReportFloorTs(clientId);
    return getLeadTimeHeatmapCore(clientId, data.period, data.customSince, data.customUntil, minStartTs);
  });

export async function fetchPublicLeadTimeHeatmap(
  token: string,
  period?: DashboardPeriod,
  customRange?: { since: string; until: string },
): Promise<LeadTimeHeatmap> {
  return _fetchPublicLeadTimeHeatmap({ data: { token, period, customSince: customRange?.since, customUntil: customRange?.until } });
}

export interface TopQualifiedLeadAd {
  ad_id: string;
  ad_name: string | null;
  adset_name: string | null;
  campaign_name: string | null;
  qualified_count: number;
  spend: number;
  cost_per_qualified_lead: number;
  thumbnail_url: string | null;
  video_url: string | null;
  embed_html: string | null;
  permalink_url: string | null;
}

// Ranking dos 3 anúncios com lead qualificado mais barato no período: agrupa
// os leads já qualificados (status != pending) por anúncio, busca o gasto de
// cada um na Meta (só dos anúncios candidatos, não da conta toda) e ordena
// pelo custo por lead qualificado — não por custo por lead simples, que não
// diz nada sobre qualidade.
async function getTopQualifiedLeadAdsCore(
  clientId: string,
  period: DashboardPeriod | undefined,
  customSince: string | undefined,
  customUntil: string | undefined,
  minStartTs: string | undefined,
  resolveToken: (clientId: string) => Promise<string | null>,
): Promise<TopQualifiedLeadAd[]> {
  const client = await db.query.clients.findFirst({
    where: eq(clients.id, clientId),
    columns: { metaAdAccountId: true },
  });
  if (!client) return [];

  let { start, end } = periodDateRange(
    period ?? "maximum",
    customSince && customUntil ? { since: customSince, until: customUntil } : undefined,
  );
  if (minStartTs) {
    const minDate = minStartTs.slice(0, 10);
    if (minDate > start) start = minDate;
  }
  const { startTs, endTsExclusive } = periodTimestampRange(period, customSince, customUntil, minStartTs);

  const groups = await db
    .select({
      adId: metaLeadAttributions.adId,
      adName: metaLeadAttributions.adName,
      adsetName: metaLeadAttributions.adsetName,
      campaignName: metaLeadAttributions.campaignName,
      qualifiedCount: sql<number>`count(*)::int`,
    })
    .from(metaLeadAttributions)
    .where(and(
      eq(metaLeadAttributions.clientId, clientId),
      gte(metaLeadAttributions.firstMessageAt, startTs),
      lt(metaLeadAttributions.firstMessageAt, endTsExclusive),
      sql`${metaLeadAttributions.status} != 'pending'`,
    ))
    .groupBy(metaLeadAttributions.adId, metaLeadAttributions.adName, metaLeadAttributions.adsetName, metaLeadAttributions.campaignName);

  if (groups.length === 0) return [];

  const token = await resolveToken(clientId);
  if (!token) return [];

  let spendByAdId: Record<string, number> = {};
  try {
    spendByAdId = await fetchAdSpendByIds(client.metaAdAccountId, token, groups.map((g) => g.adId), start, end);
  } catch {
    return []; // sem gasto não dá pra rankear por custo — evita mostrar dado incompleto/errado
  }

  const ranked = groups
    .map((g) => {
      const spend = spendByAdId[g.adId] ?? 0;
      return {
        adId: g.adId,
        adName: g.adName,
        adsetName: g.adsetName,
        campaignName: g.campaignName,
        qualifiedCount: g.qualifiedCount,
        spend,
        costPerQualifiedLead: spend / g.qualifiedCount,
      };
    })
    .filter((g) => g.spend > 0)
    .sort((a, b) => a.costPerQualifiedLead - b.costPerQualifiedLead)
    .slice(0, 3);

  const withMedia = await Promise.all(
    ranked.map(async (g) => {
      const media = await fetchAdCreativeMedia(g.adId, token).catch(() => ({ thumbnailUrl: null, videoUrl: null, embedHtml: null, permalinkUrl: null }));
      return {
        ad_id: g.adId,
        ad_name: g.adName,
        adset_name: g.adsetName,
        campaign_name: g.campaignName,
        qualified_count: g.qualifiedCount,
        spend: g.spend,
        cost_per_qualified_lead: Math.round(g.costPerQualifiedLead * 100) / 100,
        thumbnail_url: media.thumbnailUrl,
        video_url: media.videoUrl,
        embed_html: media.embedHtml,
        permalink_url: media.permalinkUrl,
      };
    })
  );

  return withMedia;
}

const _fetchTopQualifiedLeadAds = createServerFn({ method: "GET" })
  .inputValidator(periodInputSchema)
  .handler(async ({ data }): Promise<TopQualifiedLeadAd[]> => {
    await assertAccessible(data.clientId);
    return getTopQualifiedLeadAdsCore(data.clientId, data.period, data.customSince, data.customUntil, undefined, getMetaToken);
  });

export async function fetchTopQualifiedLeadAds(
  clientId: string,
  period?: DashboardPeriod,
  customRange?: { since: string; until: string },
): Promise<TopQualifiedLeadAd[]> {
  return _fetchTopQualifiedLeadAds({ data: { clientId, period, customSince: customRange?.since, customUntil: customRange?.until } });
}

const _fetchPublicTopQualifiedLeadAds = createServerFn({ method: "GET" })
  .inputValidator(publicPeriodInputSchema)
  .handler(async ({ data }): Promise<TopQualifiedLeadAd[]> => {
    const clientId = await resolvePublicClientId(data.token);
    const minStartTs = await getPublicReportFloorTs(clientId);
    return getTopQualifiedLeadAdsCore(clientId, data.period, data.customSince, data.customUntil, minStartTs, getMetaTokenForClient);
  });

export async function fetchPublicTopQualifiedLeadAds(
  token: string,
  period?: DashboardPeriod,
  customRange?: { since: string; until: string },
): Promise<TopQualifiedLeadAd[]> {
  return _fetchPublicTopQualifiedLeadAds({ data: { token, period, customSince: customRange?.since, customUntil: customRange?.until } });
}

// Painel de rastreamento de leads do Meta Ads por cliente — a captura em si
// (ctwa_clid, anúncio de origem) é gravada pelo webhook da Evolution API sem
// sessão (ver evolution-webhook.ts). Aqui: leitura pro painel + as duas ações
// manuais (marcar qualificado / converter em venda), que disparam os mesmos
// eventos de conversão pra Meta que a etiqueta do WhatsApp dispararia.

export interface LeadAttributionRow {
  id: string;
  remote_jid: string;
  contact_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_name: string | null;
  ad_name: string | null;
  status: "pending" | "qualified" | "conversion_sent" | "conversion_failed";
  first_message_at: string;
  qualified_at: string | null;
  conversion_error: string | null;
  sale_id: string | null;
  sale_value: number | null;
  sale_date: string | null;
  purchase_event_error: string | null;
}

async function assertAccessible(clientId: string) {
  const { organizationId, role, userId } = await requireOrgContext();
  const client = await db.query.clients.findFirst({
    where: eq(clients.id, clientId),
    columns: { organizationId: true, ownerUserId: true },
  });
  if (!client || !canAccessClient({ organizationId, role, userId }, client)) throw new Error("Cliente não encontrado.");
}

async function getLeadAttributionsCore(
  clientId: string,
  period: DashboardPeriod | undefined,
  customSince: string | undefined,
  customUntil: string | undefined,
  minStartTs: string | undefined,
): Promise<LeadAttributionRow[]> {
  const { startTs, endTsExclusive } = periodTimestampRange(period, customSince, customUntil, minStartTs);
  const rows = await db
    .select({
      id: metaLeadAttributions.id,
      remoteJid: metaLeadAttributions.remoteJid,
      contactName: metaLeadAttributions.contactName,
      campaignId: metaLeadAttributions.campaignId,
      campaignName: metaLeadAttributions.campaignName,
      adsetName: metaLeadAttributions.adsetName,
      adName: metaLeadAttributions.adName,
      status: metaLeadAttributions.status,
      firstMessageAt: metaLeadAttributions.firstMessageAt,
      qualifiedAt: metaLeadAttributions.qualifiedAt,
      conversionError: metaLeadAttributions.conversionError,
      saleId: metaLeadAttributions.saleId,
      purchaseEventError: metaLeadAttributions.purchaseEventError,
      saleValue: sales.value,
      saleDate: sales.date,
    })
    .from(metaLeadAttributions)
    .leftJoin(sales, eq(sales.id, metaLeadAttributions.saleId))
    .where(and(
      eq(metaLeadAttributions.clientId, clientId),
      gte(metaLeadAttributions.firstMessageAt, startTs),
      lt(metaLeadAttributions.firstMessageAt, endTsExclusive),
    ))
    .orderBy(desc(metaLeadAttributions.firstMessageAt))
    .limit(300);
  return rows.map((r) => ({
    id: r.id,
    remote_jid: r.remoteJid,
    contact_name: r.contactName,
    campaign_id: r.campaignId,
    campaign_name: r.campaignName,
    adset_name: r.adsetName,
    ad_name: r.adName,
    status: r.status as LeadAttributionRow["status"],
    first_message_at: r.firstMessageAt,
    qualified_at: r.qualifiedAt,
    conversion_error: r.conversionError,
    sale_id: r.saleId,
    sale_value: r.saleValue,
    sale_date: r.saleDate,
    purchase_event_error: r.purchaseEventError,
  }));
}

const _fetchLeadAttributions = createServerFn({ method: "GET" })
  .inputValidator(periodInputSchema)
  .handler(async ({ data }): Promise<LeadAttributionRow[]> => {
    await assertAccessible(data.clientId);
    return getLeadAttributionsCore(data.clientId, data.period, data.customSince, data.customUntil, undefined);
  });

export async function fetchLeadAttributions(
  clientId: string,
  period?: DashboardPeriod,
  customRange?: { since: string; until: string },
): Promise<LeadAttributionRow[]> {
  return _fetchLeadAttributions({ data: { clientId, period, customSince: customRange?.since, customUntil: customRange?.until } });
}

const _fetchPublicLeadAttributions = createServerFn({ method: "GET" })
  .inputValidator(publicPeriodInputSchema)
  .handler(async ({ data }): Promise<LeadAttributionRow[]> => {
    const clientId = await resolvePublicClientId(data.token);
    const minStartTs = await getPublicReportFloorTs(clientId);
    return getLeadAttributionsCore(clientId, data.period, data.customSince, data.customUntil, minStartTs);
  });

export async function fetchPublicLeadAttributions(
  token: string,
  period?: DashboardPeriod,
  customRange?: { since: string; until: string },
): Promise<LeadAttributionRow[]> {
  return _fetchPublicLeadAttributions({ data: { token, period, customSince: customRange?.since, customUntil: customRange?.until } });
}

export interface CampaignAttributionStats {
  campaign_id: string | null;
  campaign_name: string;
  total_leads: number;
  qualified_leads: number;
}

export interface LeadAttributionSummary {
  total_leads: number;
  meta_conversations_started: number;
  cost_per_lead: number | null;
  cost_per_conversation: number | null;
  qualified_leads: number;
  qualification_rate: number | null;
  sales_count: number;
  sales_value_total: number;
  sales_rate: number | null;
  by_campaign: CampaignAttributionStats[];
  last_attribution_at: string | null;
}

const QUALIFIED_STATUSES = new Set(["qualified", "conversion_sent", "conversion_failed"]);

async function getLeadAttributionSummaryCore(
  clientId: string,
  period: DashboardPeriod | undefined,
  customSince: string | undefined,
  customUntil: string | undefined,
  minStartTs: string | undefined,
  resolveToken: (clientId: string) => Promise<string | null>,
): Promise<LeadAttributionSummary> {
  let { start, end } = periodDateRange(
    period ?? "maximum",
    customSince && customUntil ? { since: customSince, until: customUntil } : undefined,
  );
  if (minStartTs) {
    const minDate = minStartTs.slice(0, 10);
    if (minDate > start) start = minDate;
  }
  const { startTs, endTsExclusive } = periodTimestampRange(period, customSince, customUntil, minStartTs);
  const rows = await db
    .select({
      campaignId: metaLeadAttributions.campaignId,
      campaignName: metaLeadAttributions.campaignName,
      status: metaLeadAttributions.status,
      firstMessageAt: metaLeadAttributions.firstMessageAt,
      saleId: metaLeadAttributions.saleId,
      saleValue: sales.value,
    })
    .from(metaLeadAttributions)
    .leftJoin(sales, eq(sales.id, metaLeadAttributions.saleId))
    .where(and(
      eq(metaLeadAttributions.clientId, clientId),
      gte(metaLeadAttributions.firstMessageAt, startTs),
      lt(metaLeadAttributions.firstMessageAt, endTsExclusive),
    ));

  // "Conversas iniciadas" que o Gerenciador de Anúncios da Meta contabiliza —
  // busca ao vivo (não do snapshot metricsDaily, que só sincroniza uma vez
  // por dia e ficava divergindo da aba Campanhas, que sempre busca ao vivo).
  // Comparado com total_leads (o que de fato chegou no WhatsApp via webhook)
  // mostra a diferença entre cliques que a Meta conta como conversa e
  // mensagens que realmente chegaram. O mesmo gasto dá dois custos: por lead
  // real (chegou no WhatsApp) e por conversa iniciada (CCI, a métrica que a
  // Meta reporta).
  let metaLeadsTotal = 0;
  let totalSpend = 0;
  const client = await db.query.clients.findFirst({
    where: eq(clients.id, clientId),
    columns: { metaAdAccountId: true },
  });
  if (client) {
    try {
      const token = await resolveToken(clientId);
      if (token) {
        const insights = await fetchAccountInsightsForRange(client.metaAdAccountId, token, start, end);
        metaLeadsTotal = insights.leads;
        totalSpend = insights.spend;
      }
    } catch {
      // sem dado ao vivo da Meta — mostra 0 em vez de quebrar o resto do painel
    }
  }

  const byCampaign = new Map<string, CampaignAttributionStats>();
  let qualifiedTotal = 0;
  let salesCount = 0;
  let salesValueTotal = 0;
  let lastAt: string | null = null;
  for (const r of rows) {
    const key = r.campaignId ?? "__sem_campanha__";
    const isQualified = QUALIFIED_STATUSES.has(r.status);
    if (isQualified) qualifiedTotal++;
    if (r.saleId) {
      salesCount++;
      salesValueTotal += r.saleValue ?? 0;
    }
    if (!lastAt || r.firstMessageAt > lastAt) lastAt = r.firstMessageAt;
    const entry = byCampaign.get(key) ?? {
      campaign_id: r.campaignId,
      campaign_name: r.campaignName ?? "Sem campanha identificada",
      total_leads: 0,
      qualified_leads: 0,
    };
    entry.total_leads++;
    if (isQualified) entry.qualified_leads++;
    byCampaign.set(key, entry);
  }

  return {
    total_leads: rows.length,
    meta_conversations_started: metaLeadsTotal,
    cost_per_lead: rows.length > 0 ? Math.round((totalSpend / rows.length) * 100) / 100 : null,
    cost_per_conversation: metaLeadsTotal > 0 ? Math.round((totalSpend / metaLeadsTotal) * 100) / 100 : null,
    qualified_leads: qualifiedTotal,
    qualification_rate: rows.length > 0 ? Math.round((qualifiedTotal / rows.length) * 1000) / 10 : null,
    sales_count: salesCount,
    sales_value_total: salesValueTotal,
    sales_rate: rows.length > 0 ? Math.round((salesCount / rows.length) * 1000) / 10 : null,
    by_campaign: Array.from(byCampaign.values()).sort((a, b) => b.total_leads - a.total_leads),
    last_attribution_at: lastAt,
  };
}

const _fetchLeadAttributionSummary = createServerFn({ method: "GET" })
  .inputValidator(periodInputSchema)
  .handler(async ({ data }): Promise<LeadAttributionSummary> => {
    await assertAccessible(data.clientId);
    return getLeadAttributionSummaryCore(data.clientId, data.period, data.customSince, data.customUntil, undefined, getMetaToken);
  });

export async function fetchLeadAttributionSummary(
  clientId: string,
  period?: DashboardPeriod,
  customRange?: { since: string; until: string },
): Promise<LeadAttributionSummary> {
  return _fetchLeadAttributionSummary({ data: { clientId, period, customSince: customRange?.since, customUntil: customRange?.until } });
}

const _fetchPublicLeadAttributionSummary = createServerFn({ method: "GET" })
  .inputValidator(publicPeriodInputSchema)
  .handler(async ({ data }): Promise<LeadAttributionSummary> => {
    const clientId = await resolvePublicClientId(data.token);
    const minStartTs = await getPublicReportFloorTs(clientId);
    return getLeadAttributionSummaryCore(clientId, data.period, data.customSince, data.customUntil, minStartTs, getMetaTokenForClient);
  });

export async function fetchPublicLeadAttributionSummary(
  token: string,
  period?: DashboardPeriod,
  customRange?: { since: string; until: string },
): Promise<LeadAttributionSummary> {
  return _fetchPublicLeadAttributionSummary({ data: { token, period, customSince: customRange?.since, customUntil: customRange?.until } });
}

// Data (YYYY-MM-DD) no horário de Brasília, a partir de um timestamp UTC —
// usado pra casar a contagem diária de leads reais com as datas que a Meta
// já devolve no gráfico de CCI/Conversas da aba Campanhas.
function dateInSaoPaulo(input: string | Date): string {
  const date = typeof input === "string" ? new Date(input) : input;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export interface DailyLeadCount {
  date: string; // YYYY-MM-DD
  leads: number;
  qualified: number;
}

// Contagem diária de leads reais (chegaram no WhatsApp) e qualificados, pra
// alimentar o gráfico "CCI — período" da aba Campanhas com Leads/CPL/Lead
// Qualificado/CPLQ de verdade, ao lado das métricas que a Meta reporta.
const _fetchDailyLeadCounts = createServerFn({ method: "GET" })
  .inputValidator(z.object({ clientId: z.string(), since: z.string(), until: z.string() }))
  .handler(async ({ data }): Promise<DailyLeadCount[]> => {
    await assertAccessible(data.clientId);
    const startTs = brasiliaMidnightUTC(data.since);
    const endTsExclusive = new Date(new Date(brasiliaMidnightUTC(data.until)).getTime() + 86400000).toISOString();

    const rows = await db
      .select({ firstMessageAt: metaLeadAttributions.firstMessageAt, status: metaLeadAttributions.status })
      .from(metaLeadAttributions)
      .where(and(
        eq(metaLeadAttributions.clientId, data.clientId),
        gte(metaLeadAttributions.firstMessageAt, startTs),
        lt(metaLeadAttributions.firstMessageAt, endTsExclusive),
      ));

    const byDate = new Map<string, { leads: number; qualified: number }>();
    for (const r of rows) {
      const date = dateInSaoPaulo(r.firstMessageAt);
      const entry = byDate.get(date) ?? { leads: 0, qualified: 0 };
      entry.leads++;
      if (QUALIFIED_STATUSES.has(r.status)) entry.qualified++;
      byDate.set(date, entry);
    }

    return Array.from(byDate.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));
  });

export async function fetchDailyLeadCounts(clientId: string, since: string, until: string): Promise<DailyLeadCount[]> {
  return _fetchDailyLeadCounts({ data: { clientId, since, until } });
}

export interface EntityLeadStats {
  id: string; // campaign_id, adset_id ou ad_id, dependendo de `level`
  leads: number;
  qualified: number;
  sales: number;
  salesValue: number;
}

// Leads/qualificados/vendas reais por campanha, conjunto ou anúncio — pra
// colocar ao lado das métricas que a Meta reporta na tabela de campanhas.
const _fetchEntityLeadStats = createServerFn({ method: "GET" })
  .inputValidator(z.object({
    clientId: z.string(),
    level: z.enum(["campaign", "adset", "ad"]),
    since: z.string(),
    until: z.string(),
  }))
  .handler(async ({ data }): Promise<EntityLeadStats[]> => {
    await assertAccessible(data.clientId);
    const startTs = brasiliaMidnightUTC(data.since);
    const endTsExclusive = new Date(new Date(brasiliaMidnightUTC(data.until)).getTime() + 86400000).toISOString();

    const idColumn = data.level === "campaign"
      ? metaLeadAttributions.campaignId
      : data.level === "adset"
      ? metaLeadAttributions.adsetId
      : metaLeadAttributions.adId;

    const rows = await db
      .select({ entityId: idColumn, status: metaLeadAttributions.status, saleId: metaLeadAttributions.saleId, saleValue: sales.value })
      .from(metaLeadAttributions)
      .leftJoin(sales, eq(sales.id, metaLeadAttributions.saleId))
      .where(and(
        eq(metaLeadAttributions.clientId, data.clientId),
        gte(metaLeadAttributions.firstMessageAt, startTs),
        lt(metaLeadAttributions.firstMessageAt, endTsExclusive),
      ));

    const byEntity = new Map<string, EntityLeadStats>();
    for (const r of rows) {
      if (!r.entityId) continue;
      const entry = byEntity.get(r.entityId) ?? { id: r.entityId, leads: 0, qualified: 0, sales: 0, salesValue: 0 };
      entry.leads++;
      if (QUALIFIED_STATUSES.has(r.status)) entry.qualified++;
      if (r.saleId) {
        entry.sales++;
        entry.salesValue += r.saleValue ?? 0;
      }
      byEntity.set(r.entityId, entry);
    }
    return Array.from(byEntity.values());
  });

export async function fetchEntityLeadStats(
  clientId: string,
  level: "campaign" | "adset" | "ad",
  since: string,
  until: string,
): Promise<EntityLeadStats[]> {
  return _fetchEntityLeadStats({ data: { clientId, level, since, until } });
}

export interface PublicClientInfo {
  client_id: string;
  client_name: string;
}

const _fetchPublicClientInfo = createServerFn({ method: "GET" })
  .inputValidator(z.object({ token: z.string() }))
  .handler(async ({ data }): Promise<PublicClientInfo> => {
    const client = await db.query.clients.findFirst({
      where: eq(clients.publicTrackingToken, data.token),
      columns: { id: true, name: true },
    });
    if (!client) throw new Error("Link inválido ou revogado.");
    return { client_id: client.id, client_name: client.name };
  });

export async function fetchPublicClientInfo(token: string): Promise<PublicClientInfo> {
  return _fetchPublicClientInfo({ data: { token } });
}

// Gera/troca o token do link público de rastreamento (/r/$token) desse
// cliente — gerar de novo invalida qualquer link já compartilhado antes.
const _generatePublicTrackingLink = createServerFn({ method: "POST" })
  .inputValidator(z.object({ clientId: z.string() }))
  .handler(async ({ data }): Promise<string> => {
    await assertAccessible(data.clientId);
    const token = randomBytes(24).toString("base64url");
    await db.update(clients).set({ publicTrackingToken: token }).where(eq(clients.id, data.clientId));
    return token;
  });

export async function generatePublicTrackingLink(clientId: string): Promise<string> {
  return _generatePublicTrackingLink({ data: { clientId } });
}

const _revokePublicTrackingLink = createServerFn({ method: "POST" })
  .inputValidator(z.object({ clientId: z.string() }))
  .handler(async ({ data }): Promise<void> => {
    await assertAccessible(data.clientId);
    await db.update(clients).set({ publicTrackingToken: null }).where(eq(clients.id, data.clientId));
  });

export async function revokePublicTrackingLink(clientId: string): Promise<void> {
  await _revokePublicTrackingLink({ data: { clientId } });
}

async function loadLeadWithClient(leadId: string) {
  const lead = await db.query.metaLeadAttributions.findFirst({ where: eq(metaLeadAttributions.id, leadId) });
  if (!lead) throw new Error("Lead não encontrado.");
  const { organizationId, role, userId } = await requireOrgContext();
  const client = await db.query.clients.findFirst({
    where: eq(clients.id, lead.clientId),
    columns: { organizationId: true, ownerUserId: true, metaCapiDatasetId: true, metaPageId: true },
  });
  if (!client || !canAccessClient({ organizationId, role, userId }, client)) throw new Error("Lead não encontrado.");
  return { lead, client };
}

async function loadLeadWithClientByToken(token: string, leadId: string) {
  const clientId = await resolvePublicClientId(token);
  const lead = await db.query.metaLeadAttributions.findFirst({ where: eq(metaLeadAttributions.id, leadId) });
  if (!lead || lead.clientId !== clientId) throw new Error("Lead não encontrado.");
  const client = await db.query.clients.findFirst({
    where: eq(clients.id, clientId),
    columns: { metaCapiDatasetId: true, metaPageId: true },
  });
  if (!client) throw new Error("Lead não encontrado.");
  return { lead, client };
}

// Tenta (de novo, se preciso) mandar o evento QualifiedLead pra Meta. Usada
// tanto na primeira qualificação quanto no botão "Reenviar" de um lead que
// ficou "conversion_failed" — mesma lógica, sem duplicar o try/catch.
async function sendQualifiedLeadEventWithStatus(
  leadId: string,
  lead: { clientId: string; ctwaClid: string; remoteJid: string; leadEmail: string | null },
  client: { metaCapiDatasetId: string | null; metaPageId: string | null },
  resolveToken: (clientId: string) => Promise<string | null>,
): Promise<void> {
  // Antes retornava calado quando faltava dataset/token — o lead ficava
  // travado em "qualified" pra sempre, sem erro nenhum registrado e sem
  // opção de reenviar (que só aparece em "conversion_failed"). Agora sempre
  // marca a falha explicitamente.
  if (!client.metaCapiDatasetId) {
    const error = 'Cliente sem "Identificação do conjunto de dados" configurada.';
    await db.update(metaLeadAttributions).set({ status: "conversion_failed", conversionError: error }).where(eq(metaLeadAttributions.id, leadId));
    throw new Error(error);
  }
  const token = await resolveToken(lead.clientId);
  if (!token) {
    const error = "Token da Meta não configurado ou expirado pra esse cliente.";
    await db.update(metaLeadAttributions).set({ status: "conversion_failed", conversionError: error }).where(eq(metaLeadAttributions.id, leadId));
    throw new Error(error);
  }

  try {
    await sendQualifiedLeadEvent({ datasetId: client.metaCapiDatasetId, ctwaClid: lead.ctwaClid, phoneRemoteJid: lead.remoteJid, email: lead.leadEmail ?? undefined, pageId: client.metaPageId ?? undefined, token });
    await db
      .update(metaLeadAttributions)
      .set({ status: "conversion_sent", conversionSentAt: new Date().toISOString(), conversionError: null })
      .where(eq(metaLeadAttributions.id, leadId));
  } catch (err) {
    await db
      .update(metaLeadAttributions)
      .set({ status: "conversion_failed", conversionError: err instanceof Error ? err.message : String(err) })
      .where(eq(metaLeadAttributions.id, leadId));
    throw err;
  }

  // "LeadSubmitted" é o evento que confirmamos aparecer como coluna nativa no
  // Gerenciador de Anúncios (diferente de "QualifiedLead", que só serve pra
  // rastreamento). Manda em paralelo, sem afetar o status acima — se falhar,
  // não deve travar a qualificação real.
  try {
    await sendCustomMessagingEvent({ eventName: "LeadSubmitted", datasetId: client.metaCapiDatasetId, ctwaClid: lead.ctwaClid, phoneRemoteJid: lead.remoteJid, email: lead.leadEmail ?? undefined, pageId: client.metaPageId ?? undefined, token });
  } catch {
    // não deve impedir nem confundir o fluxo de qualificação real
  }
}

async function qualifyLeadCore(
  leadId: string,
  lead: { clientId: string; ctwaClid: string; remoteJid: string; leadEmail: string | null; labelName: string | null },
  client: { metaCapiDatasetId: string | null; metaPageId: string | null },
  resolveToken: (clientId: string) => Promise<string | null>,
): Promise<void> {
  await db
    .update(metaLeadAttributions)
    .set({ status: "qualified", qualifiedAt: new Date().toISOString(), labelName: lead.labelName ?? "Marcado manualmente" })
    .where(eq(metaLeadAttributions.id, leadId));

  await sendQualifiedLeadEventWithStatus(leadId, lead, client, resolveToken);
}

const _markLeadQualified = createServerFn({ method: "POST" })
  .inputValidator(z.object({ leadId: z.string() }))
  .handler(async ({ data }) => {
    const { lead, client } = await loadLeadWithClient(data.leadId);
    await qualifyLeadCore(data.leadId, lead, client, getMetaToken);
  });

export async function markLeadQualified(leadId: string): Promise<void> {
  await _markLeadQualified({ data: { leadId } });
}

const _publicMarkLeadQualified = createServerFn({ method: "POST" })
  .inputValidator(z.object({ token: z.string(), leadId: z.string() }))
  .handler(async ({ data }) => {
    const { lead, client } = await loadLeadWithClientByToken(data.token, data.leadId);
    await qualifyLeadCore(data.leadId, lead, client, getMetaTokenForClient);
  });

export async function publicMarkLeadQualified(token: string, leadId: string): Promise<void> {
  await _publicMarkLeadQualified({ data: { token, leadId } });
}

async function retryQualifiedLeadCore(
  leadId: string,
  lead: { clientId: string; ctwaClid: string; remoteJid: string; leadEmail: string | null; status: string },
  client: { metaCapiDatasetId: string | null; metaPageId: string | null },
  resolveToken: (clientId: string) => Promise<string | null>,
): Promise<void> {
  // "qualified" também é reenviável: é o estado em que um lead pode ficar
  // travado se o envio nunca chegou a ser tentado de fato (bug antigo —
  // faltava dataset/token e a função saía calada, sem marcar falha).
  if (lead.status !== "conversion_failed" && lead.status !== "qualified") {
    throw new Error("Esse lead não está com envio pendente ou falhado.");
  }
  await sendQualifiedLeadEventWithStatus(leadId, lead, client, resolveToken);
}

const _retryQualifiedLeadEvent = createServerFn({ method: "POST" })
  .inputValidator(z.object({ leadId: z.string() }))
  .handler(async ({ data }) => {
    const { lead, client } = await loadLeadWithClient(data.leadId);
    await retryQualifiedLeadCore(data.leadId, lead, client, getMetaToken);
  });

export async function retryQualifiedLeadEvent(leadId: string): Promise<void> {
  await _retryQualifiedLeadEvent({ data: { leadId } });
}

const _publicRetryQualifiedLeadEvent = createServerFn({ method: "POST" })
  .inputValidator(z.object({ token: z.string(), leadId: z.string() }))
  .handler(async ({ data }) => {
    const { lead, client } = await loadLeadWithClientByToken(data.token, data.leadId);
    await retryQualifiedLeadCore(data.leadId, lead, client, getMetaTokenForClient);
  });

export async function publicRetryQualifiedLeadEvent(token: string, leadId: string): Promise<void> {
  await _publicRetryQualifiedLeadEvent({ data: { token, leadId } });
}

async function convertLeadToSaleCore(
  leadId: string,
  lead: { clientId: string; ctwaClid: string; remoteJid: string; leadEmail: string | null; saleId: string | null; contactName: string | null },
  client: { metaCapiDatasetId: string | null; metaPageId: string | null },
  value: number | null,
  obs: string | undefined,
  email: string | undefined,
  resolveToken: (clientId: string) => Promise<string | null>,
): Promise<void> {
  if (lead.saleId) throw new Error("Esse lead já foi convertido em venda.");

  const resolvedEmail = email?.trim() || lead.leadEmail || undefined;

  const [sale] = await db
    .insert(sales)
    .values({
      clientId: lead.clientId,
      date: isoDateInBrasilia(),
      value,
      obs: obs?.trim() || `Venda a partir do lead ${lead.contactName ?? lead.remoteJid}`,
    })
    .returning({ id: sales.id });

  await db
    .update(metaLeadAttributions)
    .set({ saleId: sale.id, ...(resolvedEmail ? { leadEmail: resolvedEmail } : {}) })
    .where(eq(metaLeadAttributions.id, leadId));

  if (!client.metaCapiDatasetId) {
    await db.update(metaLeadAttributions).set({ purchaseEventError: 'Cliente sem "Identificação do conjunto de dados" configurada.' }).where(eq(metaLeadAttributions.id, leadId));
    return;
  }
  const token = await resolveToken(lead.clientId);
  if (!token) {
    await db.update(metaLeadAttributions).set({ purchaseEventError: "Token da Meta não configurado ou expirado pra esse cliente." }).where(eq(metaLeadAttributions.id, leadId));
    return;
  }

  try {
    await sendPurchaseEvent({ datasetId: client.metaCapiDatasetId, ctwaClid: lead.ctwaClid, value, phoneRemoteJid: lead.remoteJid, email: resolvedEmail, pageId: client.metaPageId ?? undefined, token });
    await db
      .update(metaLeadAttributions)
      .set({ purchaseEventSentAt: new Date().toISOString() })
      .where(eq(metaLeadAttributions.id, leadId));
  } catch (err) {
    await db
      .update(metaLeadAttributions)
      .set({ purchaseEventError: err instanceof Error ? err.message : String(err) })
      .where(eq(metaLeadAttributions.id, leadId));
    throw err;
  }
}

const _convertLeadToSale = createServerFn({ method: "POST" })
  .inputValidator(z.object({ leadId: z.string(), value: z.number().nullable(), obs: z.string().optional(), email: z.string().optional() }))
  .handler(async ({ data }) => {
    const { lead, client } = await loadLeadWithClient(data.leadId);
    await convertLeadToSaleCore(data.leadId, lead, client, data.value, data.obs, data.email, getMetaToken);
  });

export async function convertLeadToSale(leadId: string, value: number | null, obs?: string, email?: string): Promise<void> {
  await _convertLeadToSale({ data: { leadId, value, obs, email } });
}

const _publicConvertLeadToSale = createServerFn({ method: "POST" })
  .inputValidator(z.object({ token: z.string(), leadId: z.string(), value: z.number().nullable(), obs: z.string().optional(), email: z.string().optional() }))
  .handler(async ({ data }) => {
    const { lead, client } = await loadLeadWithClientByToken(data.token, data.leadId);
    await convertLeadToSaleCore(data.leadId, lead, client, data.value, data.obs, data.email, getMetaTokenForClient);
  });

export async function publicConvertLeadToSale(token: string, leadId: string, value: number | null, obs?: string, email?: string): Promise<void> {
  await _publicConvertLeadToSale({ data: { token, leadId, value, obs, email } });
}
