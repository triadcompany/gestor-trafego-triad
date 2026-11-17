// Módulo SERVER-ONLY. Único ponto por onde os eventos de conversão (lead
// qualificado, lead, compra) saem pra Meta — tanto do botão quanto da
// palavra-chave. Com N8N_META_EVENTS_WEBHOOK_URL + N8N_WEBHOOK_SECRET definidos,
// o envio vai pelo workflow do n8n (que descobre o pixel pelo anúncio); sem
// eles, cai no envio direto (dataset cadastrado no cliente), como era antes.
// Ver docs/superpowers/specs/2026-11-17-eventos-meta-via-n8n-design.md
import { db } from "@/db/client";
import { metaEventLog } from "@/db/schema";
import { buildEventId, type MetaEventKind } from "@/lib/keyword-match";
import { buildMetaEvent, postMetaEventDirect } from "@/server/meta-capi";

export interface DispatchInput {
  kind: MetaEventKind;
  leadId: string;
  lead: { ctwaClid: string; remoteJid: string; leadEmail: string | null; contactName: string | null; adId: string };
  client: { metaCapiDatasetId: string | null; metaPageId: string | null };
  token: string;
  value?: number | null;
  trigger: "manual" | "keyword";
  keyword?: string;
  messageExcerpt?: string;
  occurredAtMs?: number;
}

export interface DispatchResult {
  datasetId: string;
  pageId: string | null;
}

interface N8nReply {
  ok?: boolean;
  datasetId?: string;
  pageId?: string | null;
  error?: string;
}

const N8N_TIMEOUT_MS = 20_000;

async function sendViaN8n(url: string, secret: string, i: DispatchInput, event: Record<string, unknown>): Promise<DispatchResult> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-webhook-secret": secret },
    body: JSON.stringify({
      adId: i.lead.adId,
      token: i.token,
      event, // sem page_id: o n8n injeta a página descoberta pelo anúncio
      fallbackDatasetId: i.client.metaCapiDatasetId ?? undefined,
      fallbackPageId: i.client.metaPageId ?? undefined,
    }),
    signal: AbortSignal.timeout(N8N_TIMEOUT_MS),
  });
  // O proxy do EasyPanel troca respostas 502 por HTML; qualquer coisa que não
  // seja JSON é tratada como falha de envio (e o lead pode ser reenviado).
  const text = await res.text();
  let reply: N8nReply;
  try {
    reply = JSON.parse(text) as N8nReply;
  } catch {
    throw new Error(`n8n devolveu uma resposta inválida (HTTP ${res.status}). Confira se o workflow está ativo.`);
  }
  if (!reply.ok || !reply.datasetId) throw new Error(reply.error || `n8n recusou o evento (HTTP ${res.status}).`);
  return { datasetId: reply.datasetId, pageId: reply.pageId ?? null };
}

async function sendDirect(i: DispatchInput, event: Record<string, unknown>): Promise<DispatchResult> {
  const datasetId = i.client.metaCapiDatasetId;
  if (!datasetId) throw new Error('Cliente sem "Identificação do conjunto de dados" configurada.');
  const pageId = i.client.metaPageId;
  if (pageId) (event.user_data as Record<string, string>).page_id = pageId;
  await postMetaEventDirect({ datasetId, event, token: i.token });
  return { datasetId, pageId: pageId ?? null };
}

async function writeLog(i: DispatchInput, eventId: string, outcome: { result?: DispatchResult; error?: string }): Promise<void> {
  try {
    await db.insert(metaEventLog).values({
      leadId: i.leadId,
      eventType: i.kind,
      trigger: i.trigger,
      keyword: i.keyword ?? null,
      messageExcerpt: i.messageExcerpt ? i.messageExcerpt.slice(0, 200) : null,
      datasetId: outcome.result?.datasetId ?? null,
      pageId: outcome.result?.pageId ?? null,
      eventId,
      status: outcome.error ? "failed" : "sent",
      error: outcome.error ?? null,
    });
  } catch (err) {
    // O histórico nunca pode derrubar nem mascarar o envio em si.
    console.warn("[meta-events] falha ao gravar meta_event_log:", err instanceof Error ? err.message : err);
  }
}

/**
 * Envia um evento de conversão pra Meta. Lança Error com mensagem legível em
 * caso de falha (o chamador grava o status no lead). Sempre registra em
 * meta_event_log.
 */
export async function dispatchMetaEvent(i: DispatchInput): Promise<DispatchResult> {
  const eventId = buildEventId(i.leadId, i.kind);
  const event = buildMetaEvent({
    kind: i.kind,
    leadId: i.leadId,
    ctwaClid: i.lead.ctwaClid,
    phoneRemoteJid: i.lead.remoteJid,
    email: i.lead.leadEmail,
    contactName: i.lead.contactName,
    value: i.value ?? null,
    occurredAtMs: i.occurredAtMs,
  });

  const n8nUrl = process.env.N8N_META_EVENTS_WEBHOOK_URL;
  const n8nSecret = process.env.N8N_WEBHOOK_SECRET;

  try {
    const result = n8nUrl && n8nSecret ? await sendViaN8n(n8nUrl, n8nSecret, i, event) : await sendDirect(i, event);
    await writeLog(i, eventId, { result });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeLog(i, eventId, { error: message });
    throw err instanceof Error ? err : new Error(message);
  }
}
