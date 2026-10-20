import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { n8nJobs } from "@/db/schema";
import { requireOrgContext } from "@/server/session";
import type { AdCreativeOptions, CreateFromScratchOptions } from "./meta";

export interface N8nCampaignPayload {
  campaignOptions: Omit<CreateFromScratchOptions, "token">;
  creativeOptions: Omit<AdCreativeOptions, never>;
  adName?: string; // nome do anúncio (separado do nome do criativo, em creativeOptions.name)
  token: string;
  callbackId: string;
}

export interface N8nJobStatus {
  id: string;
  status: "pending" | "running" | "done" | "error";
  campaignId?: string;
  adId?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

// Só o booleano, nunca a URL em si — ela não deve chegar no navegador.
const _isN8nConfigured = createServerFn({ method: "GET" }).handler(async (): Promise<boolean> => {
  return !!process.env.N8N_CAMPAIGN_WEBHOOK_URL;
});

export async function isN8nConfigured(): Promise<boolean> {
  return _isN8nConfigured();
}

const _triggerN8nCampaign = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      campaignOptions: z.any(),
      creativeOptions: z.any(),
      adName: z.string().optional(),
      token: z.string(),
      callbackId: z.string(),
    })
  )
  .handler(async ({ data }): Promise<{ jobId: string }> => {
    const { organizationId } = await requireOrgContext();
    const payload = data as N8nCampaignPayload;
    // Fluxo único, compartilhado por todas as organizações (não configurável
    // por organização — ver settings.tsx, seção removida). O n8n identifica
    // de quem é cada job pelo organizationId que vai junto no payload.
    const webhookUrl = process.env.N8N_CAMPAIGN_WEBHOOK_URL;
    if (!webhookUrl) throw new Error("N8N_CAMPAIGN_WEBHOOK_URL não configurado no servidor.");

    // Fire-and-forget — tabela pode não existir ainda; o que importa é a chamada do webhook
    db.insert(n8nJobs)
      .values({
        id: payload.callbackId,
        organizationId,
        status: "pending",
        payload: { campaignName: payload.campaignOptions.name },
      })
      .catch((error: { code?: string; message?: string }) => {
        if (error?.code !== "23505") console.warn("[n8n] job insert failed:", error?.message);
      });

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, organizationId }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`n8n retornou erro ${res.status}: ${text}`);
    }

    return { jobId: payload.callbackId };
  });

export async function triggerN8nCampaign(payload: N8nCampaignPayload): Promise<{ jobId: string }> {
  return _triggerN8nCampaign({ data: payload });
}

const _pollN8nJob = createServerFn({ method: "GET" })
  .inputValidator(z.object({ jobId: z.string() }))
  .handler(async ({ data }): Promise<N8nJobStatus | null> => {
    const { organizationId } = await requireOrgContext();
    const rows = await db.select().from(n8nJobs).where(eq(n8nJobs.id, data.jobId)).limit(1);
    const row = rows[0];
    if (!row || row.organizationId !== organizationId) return null;
    return {
      id: row.id,
      status: row.status as N8nJobStatus["status"],
      campaignId: row.campaignId ?? undefined,
      adId: row.adId ?? undefined,
      errorMessage: row.errorMessage ?? undefined,
      createdAt: row.createdAt ?? "",
      updatedAt: row.updatedAt ?? "",
    };
  });

export async function pollN8nJob(jobId: string): Promise<N8nJobStatus | null> {
  return _pollN8nJob({ data: { jobId } });
}
