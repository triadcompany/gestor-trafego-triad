// Módulo SERVER-ONLY. Núcleo compartilhado de qualificar lead e converter em
// venda (com envio do evento pra Meta e registro de status). Usado pelos
// botões (lead-attribution.ts), pela etiqueta do WhatsApp (evolution-webhook.ts)
// e pelas palavras-chave (keyword-triggers.ts).
//
// Fica FORA de lead-attribution.ts de propósito: aquele arquivo também é
// importado pelo navegador (server functions), e funções exportadas dele vão
// pro bundle do cliente junto com db/postgres/node:crypto e quebram o build.
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { metaLeadAttributions, sales } from "@/db/schema";
import { isoDateInBrasilia } from "@/lib/brasilia-date";
import { dispatchMetaEvent } from "@/server/meta-events";

// De onde veio o disparo do evento: clique do gestor/etiqueta ("manual") ou
// palavra-chave numa mensagem ("keyword"). Vai pro histórico meta_event_log.
export interface EventTrigger {
  trigger: "manual" | "keyword";
  keyword?: string;
  messageExcerpt?: string;
  occurredAtMs?: number;
}
const MANUAL_TRIGGER: EventTrigger = { trigger: "manual" };

// Campos do lead que o envio da Meta precisa (a linha inteira de
// meta_lead_attributions já tem todos).
export type LeadForEvent = { clientId: string; ctwaClid: string; remoteJid: string; leadEmail: string | null; contactName: string | null; adId: string };

// Tenta (de novo, se preciso) mandar o evento QualifiedLead pra Meta. Usada
// tanto na primeira qualificação quanto no botão "Reenviar" de um lead que
// ficou "conversion_failed" — mesma lógica, sem duplicar o try/catch.
export async function sendQualifiedLeadEventWithStatus(
  leadId: string,
  lead: LeadForEvent,
  client: { metaCapiDatasetId: string | null; metaPageId: string | null },
  resolveToken: (clientId: string) => Promise<string | null>,
  trig: EventTrigger = MANUAL_TRIGGER,
): Promise<void> {
  // Antes retornava calado quando faltava token — o lead ficava travado em
  // "qualified" pra sempre, sem erro registrado e sem opção de reenviar (que só
  // aparece em "conversion_failed"). Agora sempre marca a falha explicitamente.
  // A falta de dataset é tratada pelo dispatcher: com o n8n o pixel vem do
  // anúncio; só no envio direto o dataset do cliente é obrigatório.
  const token = await resolveToken(lead.clientId);
  if (!token) {
    const error = "Token da Meta não configurado ou expirado pra esse cliente.";
    await db.update(metaLeadAttributions).set({ status: "conversion_failed", conversionError: error }).where(eq(metaLeadAttributions.id, leadId));
    throw new Error(error);
  }

  try {
    await dispatchMetaEvent({ kind: "qualified", leadId, lead, client, token, ...trig });
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
  // rastreamento). Manda em seguida, sem afetar o status acima — se falhar,
  // não deve travar a qualificação real.
  try {
    await dispatchMetaEvent({ kind: "lead", leadId, lead, client, token, ...trig });
  } catch {
    // não deve impedir nem confundir o fluxo de qualificação real
  }
}

export async function qualifyLeadCore(
  leadId: string,
  lead: LeadForEvent & { labelName: string | null },
  client: { metaCapiDatasetId: string | null; metaPageId: string | null },
  resolveToken: (clientId: string) => Promise<string | null>,
  trig: EventTrigger = MANUAL_TRIGGER,
): Promise<void> {
  const labelName = lead.labelName ?? (trig.trigger === "keyword" ? `Palavra-chave: ${trig.keyword ?? ""}`.trim() : "Marcado manualmente");
  await db
    .update(metaLeadAttributions)
    .set({ status: "qualified", qualifiedAt: new Date().toISOString(), labelName })
    .where(eq(metaLeadAttributions.id, leadId));

  await sendQualifiedLeadEventWithStatus(leadId, lead, client, resolveToken, trig);
}

// Manda o evento Purchase do lead e grava o resultado (purchase_event_sent_at /
// purchase_event_error). Separada da criação da venda pra que a palavra-chave
// possa reivindicar o lead dentro de uma transação e só depois enviar.
export async function sendPurchaseEventWithStatus(
  leadId: string,
  lead: LeadForEvent,
  client: { metaCapiDatasetId: string | null; metaPageId: string | null },
  value: number | null,
  resolvedEmail: string | undefined,
  resolveToken: (clientId: string) => Promise<string | null>,
  trig: EventTrigger = MANUAL_TRIGGER,
): Promise<void> {
  const token = await resolveToken(lead.clientId);
  if (!token) {
    await db.update(metaLeadAttributions).set({ purchaseEventError: "Token da Meta não configurado ou expirado pra esse cliente." }).where(eq(metaLeadAttributions.id, leadId));
    return;
  }

  try {
    // Sem dataset no cliente: com o n8n o pixel vem do anúncio; no envio direto
    // o dispatcher lança o erro "Cliente sem Identificação do conjunto de dados".
    await dispatchMetaEvent({ kind: "purchase", leadId, lead: { ...lead, leadEmail: resolvedEmail ?? lead.leadEmail }, client, token, value, ...trig });
    await db
      .update(metaLeadAttributions)
      .set({ purchaseEventSentAt: new Date().toISOString(), purchaseEventError: null })
      .where(eq(metaLeadAttributions.id, leadId));
  } catch (err) {
    await db
      .update(metaLeadAttributions)
      .set({ purchaseEventError: err instanceof Error ? err.message : String(err) })
      .where(eq(metaLeadAttributions.id, leadId));
    throw err;
  }
}

export async function convertLeadToSaleCore(
  leadId: string,
  lead: LeadForEvent & { saleId: string | null },
  client: { metaCapiDatasetId: string | null; metaPageId: string | null },
  value: number | null,
  obs: string | undefined,
  email: string | undefined,
  resolveToken: (clientId: string) => Promise<string | null>,
  trig: EventTrigger = MANUAL_TRIGGER,
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

  await sendPurchaseEventWithStatus(leadId, lead, client, value, resolvedEmail, resolveToken, trig);
}
