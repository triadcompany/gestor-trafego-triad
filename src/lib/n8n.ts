import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { appConfig, n8nJobs } from "@/db/schema";
import type { AdCreativeOptions, CreateFromScratchOptions } from "./meta";

export interface N8nCampaignPayload {
  campaignOptions: Omit<CreateFromScratchOptions, "token">;
  creativeOptions: Omit<AdCreativeOptions, never>;
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

const _getN8nWebhookUrl = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await db.select({ value: appConfig.value }).from(appConfig).where(eq(appConfig.key, "n8n_campaign_webhook_url")).limit(1);
  return rows[0]?.value ?? null;
});

export async function getN8nWebhookUrl(): Promise<string | null> {
  return _getN8nWebhookUrl();
}

const _saveN8nWebhookUrl = createServerFn({ method: "POST" })
  .inputValidator(z.object({ url: z.string() }))
  .handler(async ({ data }) => {
    await db
      .insert(appConfig)
      .values({ key: "n8n_campaign_webhook_url", value: data.url })
      .onConflictDoUpdate({ target: appConfig.key, set: { value: data.url } });
  });

export async function saveN8nWebhookUrl(url: string): Promise<void> {
  await _saveN8nWebhookUrl({ data: { url } });
}

const _triggerN8nCampaign = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      campaignOptions: z.any(),
      creativeOptions: z.any(),
      token: z.string(),
      callbackId: z.string(),
    })
  )
  .handler(async ({ data }): Promise<{ jobId: string }> => {
    const payload = data as N8nCampaignPayload;
    const webhookUrl = await _getN8nWebhookUrl();
    if (!webhookUrl) throw new Error("URL do webhook n8n não configurada. Acesse Configurações.");

    // Fire-and-forget — tabela pode não existir ainda; o que importa é a chamada do webhook
    db.insert(n8nJobs)
      .values({
        id: payload.callbackId,
        status: "pending",
        payload: { campaignName: payload.campaignOptions.name },
      })
      .catch((error: { code?: string; message?: string }) => {
        if (error?.code !== "23505") console.warn("[n8n] job insert failed:", error?.message);
      });

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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
    const rows = await db.select().from(n8nJobs).where(eq(n8nJobs.id, data.jobId)).limit(1);
    const row = rows[0];
    if (!row) return null;
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
