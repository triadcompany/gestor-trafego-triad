import { createServerFn } from "@tanstack/react-start";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clients, metaLeadAttributions, metricsDaily, sales } from "@/db/schema";
import { requireOrgContext } from "@/server/session";
import { canAccessClient } from "@/lib/client-access";
import { getMetaToken } from "@/lib/meta";
import { sendQualifiedLeadEvent, sendPurchaseEvent } from "@/server/meta-capi";

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

const _fetchLeadAttributions = createServerFn({ method: "GET" })
  .inputValidator(z.object({ clientId: z.string() }))
  .handler(async ({ data }): Promise<LeadAttributionRow[]> => {
    await assertAccessible(data.clientId);
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
      .where(eq(metaLeadAttributions.clientId, data.clientId))
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
  });

export async function fetchLeadAttributions(clientId: string): Promise<LeadAttributionRow[]> {
  return _fetchLeadAttributions({ data: { clientId } });
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

const _fetchLeadAttributionSummary = createServerFn({ method: "GET" })
  .inputValidator(z.object({ clientId: z.string() }))
  .handler(async ({ data }): Promise<LeadAttributionSummary> => {
    await assertAccessible(data.clientId);
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
      .where(eq(metaLeadAttributions.clientId, data.clientId));

    // "Conversas iniciadas" que o Gerenciador de Anúncios da Meta contabiliza —
    // fica sincronizado diariamente em metricsDaily. Comparado com total_leads
    // (o que de fato chegou no WhatsApp via webhook) mostra a diferença entre
    // cliques que a Meta conta como conversa e mensagens que realmente chegaram.
    // O mesmo gasto sincronizado dá dois custos: por lead real (chegou no
    // WhatsApp) e por conversa iniciada (CCI, a métrica que a Meta reporta).
    const [metaTotals] = await db
      .select({
        leads: sql<number>`coalesce(sum(${metricsDaily.leads}), 0)`,
        spend: sql<number>`coalesce(sum(${metricsDaily.spend}), 0)`,
      })
      .from(metricsDaily)
      .where(eq(metricsDaily.clientId, data.clientId));

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

    const metaLeadsTotal = Number(metaTotals?.leads ?? 0);
    const totalSpend = Number(metaTotals?.spend ?? 0);

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
  });

export async function fetchLeadAttributionSummary(clientId: string): Promise<LeadAttributionSummary> {
  return _fetchLeadAttributionSummary({ data: { clientId } });
}

async function loadLeadWithClient(leadId: string) {
  const lead = await db.query.metaLeadAttributions.findFirst({ where: eq(metaLeadAttributions.id, leadId) });
  if (!lead) throw new Error("Lead não encontrado.");
  const { organizationId, role, userId } = await requireOrgContext();
  const client = await db.query.clients.findFirst({
    where: eq(clients.id, lead.clientId),
    columns: { organizationId: true, ownerUserId: true, metaCapiDatasetId: true },
  });
  if (!client || !canAccessClient({ organizationId, role, userId }, client)) throw new Error("Lead não encontrado.");
  return { lead, client };
}

const _markLeadQualified = createServerFn({ method: "POST" })
  .inputValidator(z.object({ leadId: z.string() }))
  .handler(async ({ data }) => {
    const { lead, client } = await loadLeadWithClient(data.leadId);

    await db
      .update(metaLeadAttributions)
      .set({ status: "qualified", qualifiedAt: new Date().toISOString(), labelName: lead.labelName ?? "Marcado manualmente" })
      .where(eq(metaLeadAttributions.id, data.leadId));

    if (!client.metaCapiDatasetId) return;
    const token = await getMetaToken(lead.clientId);
    if (!token) return;

    try {
      await sendQualifiedLeadEvent({ datasetId: client.metaCapiDatasetId, ctwaClid: lead.ctwaClid, phoneRemoteJid: lead.remoteJid, email: lead.leadEmail ?? undefined, token });
      await db
        .update(metaLeadAttributions)
        .set({ status: "conversion_sent", conversionSentAt: new Date().toISOString() })
        .where(eq(metaLeadAttributions.id, data.leadId));
    } catch (err) {
      await db
        .update(metaLeadAttributions)
        .set({ status: "conversion_failed", conversionError: err instanceof Error ? err.message : String(err) })
        .where(eq(metaLeadAttributions.id, data.leadId));
      throw err;
    }
  });

export async function markLeadQualified(leadId: string): Promise<void> {
  await _markLeadQualified({ data: { leadId } });
}

const _convertLeadToSale = createServerFn({ method: "POST" })
  .inputValidator(z.object({ leadId: z.string(), value: z.number().nullable(), obs: z.string().optional(), email: z.string().optional() }))
  .handler(async ({ data }) => {
    const { lead, client } = await loadLeadWithClient(data.leadId);
    if (lead.saleId) throw new Error("Esse lead já foi convertido em venda.");

    const email = data.email?.trim() || lead.leadEmail || undefined;

    const [sale] = await db
      .insert(sales)
      .values({
        clientId: lead.clientId,
        date: new Date().toISOString().slice(0, 10),
        value: data.value,
        obs: data.obs?.trim() || `Venda a partir do lead ${lead.contactName ?? lead.remoteJid}`,
      })
      .returning({ id: sales.id });

    await db
      .update(metaLeadAttributions)
      .set({ saleId: sale.id, ...(email ? { leadEmail: email } : {}) })
      .where(eq(metaLeadAttributions.id, data.leadId));

    if (!client.metaCapiDatasetId) return;
    const token = await getMetaToken(lead.clientId);
    if (!token) return;

    try {
      await sendPurchaseEvent({ datasetId: client.metaCapiDatasetId, ctwaClid: lead.ctwaClid, value: data.value, phoneRemoteJid: lead.remoteJid, email, token });
      await db
        .update(metaLeadAttributions)
        .set({ purchaseEventSentAt: new Date().toISOString() })
        .where(eq(metaLeadAttributions.id, data.leadId));
    } catch (err) {
      await db
        .update(metaLeadAttributions)
        .set({ purchaseEventError: err instanceof Error ? err.message : String(err) })
        .where(eq(metaLeadAttributions.id, data.leadId));
      throw err;
    }
  });

export async function convertLeadToSale(leadId: string, value: number | null, obs?: string, email?: string): Promise<void> {
  await _convertLeadToSale({ data: { leadId, value, obs, email } });
}
