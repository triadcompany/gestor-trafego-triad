// Recebe os webhooks da WhatsApp Business Platform OFICIAL da Meta (Cloud
// API) — caminho alternativo ao da Evolution (ver evolution-webhook.ts, que
// continua funcionando exatamente como antes, sem nenhuma mudança). Usado só
// por clientes que já têm o número conectado à API oficial (geralmente num
// CRM próprio) e compartilharam o WABA com a gente via Business Manager.
//
// Só processa a atribuição de lead (mesma tabela meta_lead_attributions que
// o rastreamento já usa) — não envia nada, não escreve em nenhum CRM
// terceiro. "Marcar qualificado"/"converter" continuam na tela de
// Rastreamento, sem mudança nenhuma — essas ações já são genéricas, não
// dependem de qual caminho (Evolution ou API oficial) gerou o lead.
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, metaLeadAttributions } from "@/db/schema";
import { fetchAdContext } from "@/lib/meta";
import { pickMetaTokenRow } from "./automations-core";

interface CloudApiMessage {
  from?: string;
  id?: string;
  timestamp?: string;
  referral?: {
    source_id?: string;
    ctwa_clid?: string;
  };
}

interface CloudApiValue {
  metadata?: { phone_number_id?: string };
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
  messages?: CloudApiMessage[];
}

interface CloudApiWebhookBody {
  object?: string;
  entry?: Array<{
    id?: string; // WABA id
    changes?: Array<{ field?: string; value?: CloudApiValue }>;
  }>;
}

export interface WebhookResult {
  handled: boolean;
  reason?: string;
}

export async function handleMetaWhatsappWebhook(body: CloudApiWebhookBody): Promise<WebhookResult> {
  if (body.object !== "whatsapp_business_account") return { handled: false, reason: "objeto inesperado" };

  let anyHandled = false;
  const reasons: string[] = [];

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) {
        reasons.push("sem phone_number_id");
        continue;
      }

      const client = await db.query.clients.findFirst({
        where: eq(clients.metaPhoneNumberId, phoneNumberId),
        columns: { id: true, organizationId: true },
      });
      if (!client) {
        reasons.push(`nenhum cliente vinculado ao phone_number_id ${phoneNumberId}`);
        continue;
      }

      const contactsByWaId = new Map((value?.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? null]));

      for (const msg of value?.messages ?? []) {
        const handled = await ingestLead(client.id, client.organizationId, msg, contactsByWaId);
        if (handled) anyHandled = true;
      }
    }
  }

  return anyHandled ? { handled: true } : { handled: false, reason: reasons.join("; ") || "nada pra processar" };
}

async function ingestLead(
  clientId: string,
  organizationId: string,
  msg: CloudApiMessage,
  contactsByWaId: Map<string | undefined, string | null>
): Promise<boolean> {
  const referral = msg.referral;
  if (!referral?.source_id || !referral.ctwa_clid) return false; // conversa sem clique de anúncio — nada a atribuir
  if (!msg.from) return false;

  const tokenRow = await pickMetaTokenRow({ organizationId, clientId });
  const token = tokenRow?.accessToken ?? null;
  let context = { adName: null as string | null, adsetId: null as string | null, adsetName: null as string | null, campaignId: null as string | null, campaignName: null as string | null };
  if (token) {
    try {
      context = await fetchAdContext(referral.source_id, token);
    } catch {
      // segue sem os nomes — melhor gravar a atribuição incompleta do que perder o ctwa_clid
    }
  }

  const timestampSeconds = msg.timestamp ? Number(msg.timestamp) : Math.floor(Date.now() / 1000);
  const firstMessageAt = new Date((Number.isFinite(timestampSeconds) ? timestampSeconds : Math.floor(Date.now() / 1000)) * 1000);

  // Normaliza pro mesmo formato de remote_jid usado em todo o resto do
  // sistema (Evolution sempre manda "55...@s.whatsapp.net") — garante que
  // formatPhoneFromJid e qualquer outro código que faz .split("@")[0]
  // continue funcionando igual, sem precisar saber de onde o lead veio.
  const remoteJid = `${msg.from}@s.whatsapp.net`;

  await db
    .insert(metaLeadAttributions)
    .values({
      clientId,
      remoteJid,
      contactName: contactsByWaId.get(msg.from) ?? null,
      ctwaClid: referral.ctwa_clid,
      adId: referral.source_id,
      adName: context.adName,
      adsetId: context.adsetId,
      adsetName: context.adsetName,
      campaignId: context.campaignId,
      campaignName: context.campaignName,
      firstMessageAt: firstMessageAt.toISOString(),
    })
    .onConflictDoNothing({
      target: [metaLeadAttributions.clientId, metaLeadAttributions.remoteJid, metaLeadAttributions.firstMessageAt],
    });

  return true;
}
