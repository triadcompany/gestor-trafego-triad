// Módulo SERVER-ONLY. Quando uma mensagem de texto de uma conversa de um lead
// (de anúncio) contém uma palavra-chave cadastrada pro cliente, qualifica o
// lead ou converte em venda automaticamente e manda o evento pra Meta — pelo
// mesmo caminho dos botões (lead-attribution.ts → dispatchMetaEvent).
// Chamado pelo webhook da Evolution (evolution-webhook.ts), sem sessão de
// usuário: o cliente vem da instância do WhatsApp.
//
// "Uma vez só": a reivindicação do lead é atômica no banco (UPDATE condicional
// pra qualificar; transação com a linha travada pra vender). Se a Evolution
// reenviar a mesma mensagem, ou duas mensagens chegarem juntas, só uma passa.
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clientEventKeywords, clients, metaLeadAttributions, sales } from "@/db/schema";
import { isoDateInBrasilia } from "@/lib/brasilia-date";
import { extractBrlAmount, matchRule, type EventType, type KeywordRule, type RuleSource } from "@/lib/keyword-match";
import { sendPurchaseEventWithStatus, sendQualifiedLeadEventWithStatus, type EventTrigger } from "@/server/lead-events-core";
import { pickMetaTokenRow } from "./automations-core";

export interface KeywordMessage {
  clientId: string;
  organizationId: string;
  remoteJid: string;
  fromMe: boolean;
  text: string;
  timestampMs: number;
}

const EXCERPT_MAX = 200;

async function loadActiveRules(clientId: string): Promise<KeywordRule[]> {
  const rows = await db
    .select()
    .from(clientEventKeywords)
    .where(and(eq(clientEventKeywords.clientId, clientId), eq(clientEventKeywords.active, true)));
  return rows.map((r) => ({
    id: r.id,
    eventType: r.eventType as EventType,
    keyword: r.keyword,
    keywordNormalized: r.keywordNormalized,
    source: r.source as RuleSource,
    defaultValue: r.defaultValue,
    active: r.active,
  }));
}

export async function processKeywordMessage(msg: KeywordMessage): Promise<void> {
  const text = msg.text.trim();
  if (!text) return;

  try {
    const rules = await loadActiveRules(msg.clientId);
    if (!rules.length) return;

    const qualifiedRule = matchRule(rules, "qualified_lead", text, msg.fromMe);
    const purchaseRule = matchRule(rules, "purchase", text, msg.fromMe);
    if (!qualifiedRule && !purchaseRule) return;

    // Conversa sem anúncio de origem (sem ctwa_clid capturado) não tem como ser atribuída.
    const [lead] = await db
      .select()
      .from(metaLeadAttributions)
      .where(and(eq(metaLeadAttributions.clientId, msg.clientId), eq(metaLeadAttributions.remoteJid, msg.remoteJid)))
      .orderBy(desc(metaLeadAttributions.firstMessageAt))
      .limit(1);
    if (!lead) return;

    const client = await db.query.clients.findFirst({
      where: eq(clients.id, msg.clientId),
      columns: { metaCapiDatasetId: true, metaPageId: true },
    });
    if (!client) return;

    const resolveToken = async (clientId: string) =>
      (await pickMetaTokenRow({ organizationId: msg.organizationId, clientId }))?.accessToken ?? null;
    const excerpt = text.slice(0, EXCERPT_MAX);

    if (qualifiedRule) {
      const trig: EventTrigger = { trigger: "keyword", keyword: qualifiedRule.keyword, messageExcerpt: excerpt, occurredAtMs: msg.timestampMs };
      const claimed = await db
        .update(metaLeadAttributions)
        .set({ status: "qualified", qualifiedAt: new Date().toISOString(), labelName: `Palavra-chave: ${qualifiedRule.keyword}` })
        .where(and(eq(metaLeadAttributions.id, lead.id), eq(metaLeadAttributions.status, "pending")))
        .returning({ id: metaLeadAttributions.id });
      if (claimed.length) {
        try {
          await sendQualifiedLeadEventWithStatus(lead.id, lead, client, resolveToken, trig);
        } catch {
          // status e erro já gravados no lead (reenviável pelo botão)
        }
      }
    }

    if (purchaseRule) {
      const value = extractBrlAmount(text) ?? purchaseRule.defaultValue ?? null;
      const trig: EventTrigger = { trigger: "keyword", keyword: purchaseRule.keyword, messageExcerpt: excerpt, occurredAtMs: msg.timestampMs };
      const claimed = await db.transaction(async (tx) => {
        const [row] = await tx
          .select({ saleId: metaLeadAttributions.saleId })
          .from(metaLeadAttributions)
          .where(eq(metaLeadAttributions.id, lead.id))
          .for("update");
        if (!row || row.saleId) return false;
        const [sale] = await tx
          .insert(sales)
          .values({
            clientId: msg.clientId,
            date: isoDateInBrasilia(),
            value,
            obs: `Venda por palavra-chave "${purchaseRule.keyword}" (lead ${lead.contactName ?? lead.remoteJid})`,
          })
          .returning({ id: sales.id });
        await tx.update(metaLeadAttributions).set({ saleId: sale.id }).where(eq(metaLeadAttributions.id, lead.id));
        return true;
      });
      if (claimed) {
        try {
          await sendPurchaseEventWithStatus(lead.id, lead, client, value, undefined, resolveToken, trig);
        } catch {
          // erro já gravado em purchase_event_error e em meta_event_log
        }
      }
    }
  } catch (err) {
    // Nunca derruba o webhook da Evolution por causa de uma palavra-chave.
    console.error("[keyword-triggers] erro ao processar mensagem:", err instanceof Error ? err.message : err);
  }
}
