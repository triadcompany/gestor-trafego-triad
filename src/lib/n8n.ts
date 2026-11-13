import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { n8nJobs } from "@/db/schema";
import { requireOrgContext } from "@/server/session";
import type { AdCreativeOptions, CreateFromScratchOptions, MetaWriteOp } from "./meta";

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

// ── Duplicar campanha via n8n ──────────────────────────────────
// Mesmo padrão do criar do zero (webhook + job assíncrono), mas num workflow
// separado ("Gestor Tráfego — Duplicar Campanha Meta") porque a duplicação
// não parte de um formulário — ela lê a campanha original na Meta e replica
// a estrutura, então tem um contrato de payload diferente.

export interface N8nDuplicatePayload {
  token: string;
  callbackId: string;
  adAccountId: string;
  campaignId: string; // campanha de origem
  newName: string;
  whatsappNumber?: string;
  adSetName?: string;
  adName?: string;
  flipObjective?: boolean;
}

const _isN8nDuplicateConfigured = createServerFn({ method: "GET" }).handler(async (): Promise<boolean> => {
  return !!process.env.N8N_DUPLICATE_CAMPAIGN_WEBHOOK_URL;
});

export async function isN8nDuplicateConfigured(): Promise<boolean> {
  return _isN8nDuplicateConfigured();
}

const _triggerN8nDuplicateCampaign = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      token: z.string(),
      callbackId: z.string(),
      adAccountId: z.string(),
      campaignId: z.string(),
      newName: z.string(),
      whatsappNumber: z.string().optional(),
      adSetName: z.string().optional(),
      adName: z.string().optional(),
      flipObjective: z.boolean().optional(),
    })
  )
  .handler(async ({ data }): Promise<{ jobId: string }> => {
    const { organizationId } = await requireOrgContext();
    const payload = data as N8nDuplicatePayload;
    const webhookUrl = process.env.N8N_DUPLICATE_CAMPAIGN_WEBHOOK_URL;
    if (!webhookUrl) throw new Error("N8N_DUPLICATE_CAMPAIGN_WEBHOOK_URL não configurado no servidor.");

    db.insert(n8nJobs)
      .values({
        id: payload.callbackId,
        organizationId,
        status: "pending",
        payload: { newName: payload.newName, campaignId: payload.campaignId },
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

export async function triggerN8nDuplicateCampaign(payload: N8nDuplicatePayload): Promise<{ jobId: string }> {
  return _triggerN8nDuplicateCampaign({ data: payload });
}

// ── Gravações avulsas na Meta via n8n ──────────────────────────
// Workflow "Gestor Tráfego — Executar Escritas Meta": recebe uma lista de
// gravações já montadas pelo app (ver MetaWriteOp) e executa em sequência, com
// a mesma espera automática no 613. Mesmo host dos outros webhooks, então a
// URL sai da de criar anúncio em vez de exigir mais uma variável de ambiente.
function metaWritesWebhookUrl(): string | null {
  if (process.env.N8N_META_WRITES_WEBHOOK_URL) return process.env.N8N_META_WRITES_WEBHOOK_URL;
  const base = process.env.N8N_CAMPAIGN_WEBHOOK_URL;
  return base ? new URL("executar-escritas-meta", base).toString() : null;
}

const _isN8nMetaWritesConfigured = createServerFn({ method: "GET" }).handler(async (): Promise<boolean> => {
  return !!metaWritesWebhookUrl();
});

const _triggerN8nMetaWrites = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      token: z.string(),
      callbackId: z.string(),
      label: z.string(),
      ops: z
        .array(z.object({ path: z.string(), params: z.record(z.string()), label: z.string().optional() }))
        .min(1)
        .max(20),
    })
  )
  .handler(async ({ data }): Promise<{ jobId: string }> => {
    const { organizationId } = await requireOrgContext();
    const webhookUrl = metaWritesWebhookUrl();
    if (!webhookUrl) throw new Error("Webhook do n8n não configurado no servidor.");

    await db.insert(n8nJobs).values({
      id: data.callbackId,
      organizationId,
      status: "pending",
      payload: { label: data.label, ops: data.ops.map((o) => o.label ?? o.path) },
    });

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, organizationId }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`n8n retornou erro ${res.status}: ${text}`);
    }
    return { jobId: data.callbackId };
  });

/**
 * Devolve um executor que manda as gravações pro n8n e espera ele terminar,
 * ou undefined quando o n8n não está configurado (aí quem chama grava direto).
 */
export async function getN8nMetaWriter(
  token: string,
  label: string,
  onProgress?: (msg: string) => void
): Promise<((ops: MetaWriteOp[]) => Promise<void>) | undefined> {
  if (!(await _isN8nMetaWritesConfigured())) return undefined;
  return async (ops) => {
    const callbackId = crypto.randomUUID();
    onProgress?.("Enviando para o n8n...");
    await _triggerN8nMetaWrites({ data: { token, callbackId, label, ops } });
    const start = Date.now();
    while (Date.now() - start < 5 * 60 * 1000) {
      await new Promise((r) => setTimeout(r, 2000));
      const status = await pollN8nJob(callbackId);
      if (status?.status === "done") return;
      if (status?.status === "error") throw new Error(status.errorMessage || "Erro desconhecido no n8n.");
      onProgress?.("Salvando na Meta via n8n...");
    }
    throw new Error("O n8n não respondeu a tempo (5min). A alteração pode ter sido aplicada mesmo assim.");
  };
}
