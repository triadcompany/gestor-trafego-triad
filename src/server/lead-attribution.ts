import { createServerFn } from "@tanstack/react-start";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clients, metaLeadAttributions } from "@/db/schema";
import { requireOrgContext } from "@/server/session";
import { canAccessClient } from "@/lib/client-access";

// Painel de rastreamento de leads do Meta Ads por cliente — dados gravados
// pelo webhook da Evolution API (ver evolution-webhook.ts). Só leitura aqui;
// quem escreve é o webhook, sem sessão de usuário.

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
      .select()
      .from(metaLeadAttributions)
      .where(eq(metaLeadAttributions.clientId, data.clientId))
      .orderBy(desc(metaLeadAttributions.firstMessageAt))
      .limit(200);
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
  qualified_leads: number;
  qualification_rate: number | null;
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
      })
      .from(metaLeadAttributions)
      .where(eq(metaLeadAttributions.clientId, data.clientId));

    const byCampaign = new Map<string, CampaignAttributionStats>();
    let qualifiedTotal = 0;
    let lastAt: string | null = null;
    for (const r of rows) {
      const key = r.campaignId ?? "__sem_campanha__";
      const isQualified = QUALIFIED_STATUSES.has(r.status);
      if (isQualified) qualifiedTotal++;
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
      qualified_leads: qualifiedTotal,
      qualification_rate: rows.length > 0 ? Math.round((qualifiedTotal / rows.length) * 1000) / 10 : null,
      by_campaign: Array.from(byCampaign.values()).sort((a, b) => b.total_leads - a.total_leads),
      last_attribution_at: lastAt,
    };
  });

export async function fetchLeadAttributionSummary(clientId: string): Promise<LeadAttributionSummary> {
  return _fetchLeadAttributionSummary({ data: { clientId } });
}
