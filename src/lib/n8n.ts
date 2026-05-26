import { supabase } from "./supabase";
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

export async function getN8nWebhookUrl(): Promise<string | null> {
  const { data } = await supabase
    .from("app_config")
    .select("value")
    .eq("key", "n8n_campaign_webhook_url")
    .maybeSingle();
  return data?.value ?? null;
}

export async function saveN8nWebhookUrl(url: string): Promise<void> {
  const { error } = await supabase
    .from("app_config")
    .upsert({ key: "n8n_campaign_webhook_url", value: url }, { onConflict: "key" });
  if (error) throw error;
}

export async function triggerN8nCampaign(
  payload: N8nCampaignPayload
): Promise<{ jobId: string }> {
  const webhookUrl = await getN8nWebhookUrl();
  if (!webhookUrl) throw new Error("URL do webhook n8n não configurada. Acesse Configurações.");

  // Fire-and-forget — table may not exist yet; webhook call is what matters
  supabase.from("n8n_jobs").insert({
    id: payload.callbackId,
    status: "pending",
    payload: JSON.stringify({ campaignName: payload.campaignOptions.name }),
  }).then(({ error }) => {
    if (error && error.code !== "23505") console.warn("[n8n] job insert failed:", error.message);
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
}

export async function pollN8nJob(jobId: string): Promise<N8nJobStatus | null> {
  const { data } = await supabase
    .from("n8n_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  return data ?? null;
}
