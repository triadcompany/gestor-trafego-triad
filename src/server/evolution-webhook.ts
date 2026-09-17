import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, metaLeadAttributions, whatsappInstances } from "@/db/schema";
import { fetchAdContext } from "@/lib/meta";
import { sendQualifiedLeadEvent } from "@/server/meta-capi";
import { pickMetaTokenRow } from "./automations-core";

// Recebe os webhooks da Evolution API (não passa por sessão — a instância
// identifica o cliente). Dois eventos importam aqui:
// - messages.upsert: captura o ctwa_clid + o anúncio de origem na primeira
//   mensagem de uma conversa nova (só existe depois do patch que devolve
//   esse dado no payload — ver spec).
// - labels.association: quando o gestor/cliente etiqueta a conversa no
//   WhatsApp Business do celular. Se o nome bater com a etiqueta configurada
//   pro cliente, marca o lead como qualificado e dispara o evento pra Meta.
//
// A forma exata do payload que a Evolution API manda pra cada evento não é
// 100% documentada (varia entre versões) — a extração abaixo tenta vários
// formatos plausíveis de propósito. Se nada bater, a função simplesmente não
// encontra o dado e não faz nada (não derruba o webhook) — o jeito de
// depurar é olhar o `raw` logado.

type JsonRecord = Record<string, unknown>;

interface EvolutionWebhookBody {
  event?: string;
  instance?: string;
  data?: unknown;
}

export interface WebhookResult {
  handled: boolean;
  reason?: string;
}

export async function handleEvolutionWebhook(body: EvolutionWebhookBody): Promise<WebhookResult> {
  const instanceName = body.instance;
  if (!instanceName) return { handled: false, reason: "sem campo instance" };

  const instance = await db.query.whatsappInstances.findFirst({
    where: eq(whatsappInstances.instanceName, instanceName),
  });
  if (!instance) return { handled: false, reason: "instância desconhecida" };

  const client = await db.query.clients.findFirst({
    where: eq(clients.whatsappInstanceId, instance.id),
    columns: { id: true, qualifiedLeadLabel: true, metaCapiDatasetId: true },
  });
  if (!client) return { handled: false, reason: "nenhum cliente vinculado a essa instância" };

  const eventName = (body.event ?? "").toLowerCase();
  if (eventName === "messages.upsert") {
    await handleNewMessage(client.id, instance.organizationId, body.data);
    return { handled: true };
  }
  if (eventName === "labels.association") {
    await handleLabelAssociation(client, instance, body.data);
    return { handled: true };
  }
  return { handled: false, reason: `evento ignorado: ${body.event}` };
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" ? (value as JsonRecord) : null;
}

function extractMessageEnvelope(data: unknown): { fromMe: boolean; remoteJid: string; pushName: string | null; timestamp: number; raw: JsonRecord } | null {
  const root = asRecord(data);
  if (!root) return null;
  const msg = root.key ? root : Array.isArray((root as { messages?: unknown[] }).messages) ? asRecord((root as { messages: unknown[] }).messages[0]) : Array.isArray(data) ? asRecord((data as unknown[])[0]) : null;
  const key = msg ? asRecord(msg.key) : null;
  const remoteJid = key?.remoteJid;
  if (!msg || typeof remoteJid !== "string") return null;
  const ts = msg.messageTimestamp;
  const timestamp = typeof ts === "number" ? ts : typeof ts === "string" ? Number(ts) : Math.floor(Date.now() / 1000);
  return {
    fromMe: key?.fromMe === true,
    remoteJid,
    pushName: typeof msg.pushName === "string" ? msg.pushName : null,
    timestamp: Number.isFinite(timestamp) ? timestamp : Math.floor(Date.now() / 1000),
    raw: msg,
  };
}

function extractReferral(raw: JsonRecord): { ctwaClid: string; sourceId: string | null } | null {
  const message = asRecord(raw.message);
  const rawContextInfo = asRecord(raw.contextInfo);
  const extendedText = message ? asRecord(message.extendedTextMessage) : null;
  const extendedContextInfo = extendedText ? asRecord(extendedText.contextInfo) : null;
  const messageContextInfo = message ? asRecord(message.contextInfo) : null;
  // "externalAdReply" é o nome real do campo no Baileys/Evolution API (confirmado
  // no patch aplicado no servidor); "externalAdReplyInfo" é mantido como
  // fallback caso alguma versão futura da Evolution API mude o nome do campo.
  const candidates: Array<JsonRecord | null> = [
    asRecord(raw.referral),
    asRecord(raw.adReferral),
    rawContextInfo ? asRecord(rawContextInfo.externalAdReply) : null,
    rawContextInfo ? asRecord(rawContextInfo.externalAdReplyInfo) : null,
    extendedContextInfo ? asRecord(extendedContextInfo.externalAdReply) : null,
    extendedContextInfo ? asRecord(extendedContextInfo.externalAdReplyInfo) : null,
    messageContextInfo ? asRecord(messageContextInfo.externalAdReply) : null,
    messageContextInfo ? asRecord(messageContextInfo.externalAdReplyInfo) : null,
  ];
  for (const c of candidates) {
    if (!c) continue;
    const ctwaClid = c.ctwaClid ?? c.ctwa_clid;
    if (typeof ctwaClid === "string" && ctwaClid) {
      const sourceId = c.sourceId ?? c.source_id;
      return { ctwaClid, sourceId: typeof sourceId === "string" ? sourceId : null };
    }
  }
  return null;
}

async function handleNewMessage(clientId: string, organizationId: string, data: unknown): Promise<void> {
  const envelope = extractMessageEnvelope(data);
  if (!envelope || envelope.fromMe) return;
  const referral = extractReferral(envelope.raw);
  if (!referral || !referral.sourceId) return; // conversa sem clique de anúncio — nada a atribuir

  const tokenRow = await pickMetaTokenRow({ organizationId, clientId });
  const token = tokenRow?.accessToken ?? null;
  let context = { adName: null as string | null, adsetId: null as string | null, adsetName: null as string | null, campaignId: null as string | null, campaignName: null as string | null };
  if (token) {
    try {
      context = await fetchAdContext(referral.sourceId, token);
    } catch {
      // segue sem os nomes — melhor gravar a atribuição incompleta do que perder o ctwa_clid
    }
  }

  await db
    .insert(metaLeadAttributions)
    .values({
      clientId,
      remoteJid: envelope.remoteJid,
      contactName: envelope.pushName,
      ctwaClid: referral.ctwaClid,
      adId: referral.sourceId,
      adName: context.adName,
      adsetId: context.adsetId,
      adsetName: context.adsetName,
      campaignId: context.campaignId,
      campaignName: context.campaignName,
      firstMessageAt: new Date(envelope.timestamp * 1000).toISOString(),
    })
    .onConflictDoNothing({
      target: [metaLeadAttributions.clientId, metaLeadAttributions.remoteJid, metaLeadAttributions.firstMessageAt],
    });
}

async function resolveLabelName(instance: { evolutionUrl: string; evolutionKey: string; instanceName: string }, labelId: string): Promise<string | null> {
  try {
    const res = await fetch(`${instance.evolutionUrl}/label/findLabels/${instance.instanceName}`, {
      headers: { apikey: instance.evolutionKey },
    });
    const json = (await res.json()) as Array<{ id?: string; name?: string }>;
    if (!Array.isArray(json)) return null;
    return json.find((l) => l.id === labelId)?.name ?? null;
  } catch {
    return null;
  }
}

async function handleLabelAssociation(
  client: { id: string; qualifiedLeadLabel: string | null; metaCapiDatasetId: string | null },
  instance: { evolutionUrl: string; evolutionKey: string; instanceName: string; organizationId: string },
  data: unknown
): Promise<void> {
  if (!client.qualifiedLeadLabel) return;

  const d = asRecord(data);
  if (!d) return;
  const chatId = d.chatId ?? d.remoteJid ?? d.jid;
  const type = d.type ?? d.action;
  if (typeof chatId !== "string") return;
  if (type === "remove") return; // só a associação (adicionar a etiqueta) qualifica

  let labelName = typeof d.labelName === "string" ? d.labelName : typeof d.name === "string" ? d.name : null;
  const labelId = d.labelId ?? d.id;
  if (!labelName && typeof labelId === "string") {
    labelName = await resolveLabelName(instance, labelId);
  }
  if (!labelName || labelName !== client.qualifiedLeadLabel) return;

  const [attribution] = await db
    .select()
    .from(metaLeadAttributions)
    .where(and(eq(metaLeadAttributions.clientId, client.id), eq(metaLeadAttributions.remoteJid, chatId), eq(metaLeadAttributions.status, "pending")))
    .orderBy(desc(metaLeadAttributions.firstMessageAt))
    .limit(1);
  if (!attribution) return; // conversa sem atribuição capturada (ex: conversa iniciada antes do rastreamento existir)

  await db
    .update(metaLeadAttributions)
    .set({ status: "qualified", qualifiedAt: new Date().toISOString(), labelName })
    .where(eq(metaLeadAttributions.id, attribution.id));

  if (!client.metaCapiDatasetId) return; // qualificado, mas sem dataset configurado — não envia evento

  const tokenRow = await pickMetaTokenRow({ organizationId: instance.organizationId, clientId: client.id });
  const token = tokenRow?.accessToken ?? null;
  if (!token) return;

  try {
    await sendQualifiedLeadEvent({ datasetId: client.metaCapiDatasetId, ctwaClid: attribution.ctwaClid, phoneRemoteJid: attribution.remoteJid, token });
    await db
      .update(metaLeadAttributions)
      .set({ status: "conversion_sent", conversionSentAt: new Date().toISOString() })
      .where(eq(metaLeadAttributions.id, attribution.id));
  } catch (err) {
    await db
      .update(metaLeadAttributions)
      .set({ status: "conversion_failed", conversionError: err instanceof Error ? err.message : String(err) })
      .where(eq(metaLeadAttributions.id, attribution.id));
  }
}
