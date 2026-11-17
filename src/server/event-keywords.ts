// Funções de servidor da página "Conversões" (palavras-chave por cliente,
// histórico de eventos enviados pra Meta e checagem de prontidão).
// Acesso: mesma regra dos demais dados do cliente (organização + dono, ou admin).
import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, gte, like } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clientEventKeywords, clients, metaEventLog, metaLeadAttributions, whatsappInstances } from "@/db/schema";
import { canAccessClient } from "@/lib/client-access";
import { normalizeText } from "@/lib/keyword-match";
import { getMetaToken } from "@/lib/meta";
import { configureEvolutionWebhook } from "@/lib/whatsapp-messages";
import { requireOrgContext } from "@/server/session";

export interface EventKeywordRow {
  id: string;
  eventType: "qualified_lead" | "purchase";
  keyword: string;
  source: "team" | "lead" | "any";
  defaultValue: number | null;
  active: boolean;
  createdAt: string;
}

export interface MetaEventLogRow {
  id: string;
  createdAt: string;
  eventType: "qualified" | "lead" | "purchase";
  trigger: "manual" | "keyword";
  keyword: string | null;
  messageExcerpt: string | null;
  datasetId: string | null;
  pageId: string | null;
  status: "sent" | "failed";
  error: string | null;
  contactName: string | null;
  remoteJid: string;
  adName: string | null;
}

export interface ConversionsReadiness {
  metaTokenOk: boolean;
  whatsappConnected: boolean;
  n8nConfigured: boolean;
  fallbackDatasetSet: boolean;
  noPixelFailuresLast7d: number;
}

async function assertAccessible(clientId: string): Promise<void> {
  const { organizationId, role, userId } = await requireOrgContext();
  const client = await db.query.clients.findFirst({
    where: eq(clients.id, clientId),
    columns: { organizationId: true, ownerUserId: true },
  });
  if (!client || !canAccessClient({ organizationId, role, userId }, client)) throw new Error("Cliente não encontrado.");
}

// Regra pertence a um cliente acessível pelo usuário (evita mexer na regra de outro gestor por id).
async function assertRuleAccessible(ruleId: string): Promise<string> {
  const rule = await db.query.clientEventKeywords.findFirst({
    where: eq(clientEventKeywords.id, ruleId),
    columns: { clientId: true },
  });
  if (!rule) throw new Error("Palavra-chave não encontrada.");
  await assertAccessible(rule.clientId);
  return rule.clientId;
}

const eventTypeSchema = z.enum(["qualified_lead", "purchase"]);
const sourceSchema = z.enum(["team", "lead", "any"]);
const keywordSchema = z
  .string()
  .trim()
  .min(2, "A palavra-chave precisa ter pelo menos 2 caracteres.")
  .max(80, "A palavra-chave pode ter no máximo 80 caracteres.");

// ---------- Regras ----------

const _listEventKeywords = createServerFn({ method: "GET" })
  .inputValidator(z.object({ clientId: z.string() }))
  .handler(async ({ data }): Promise<EventKeywordRow[]> => {
    await assertAccessible(data.clientId);
    const rows = await db
      .select()
      .from(clientEventKeywords)
      .where(eq(clientEventKeywords.clientId, data.clientId))
      .orderBy(clientEventKeywords.createdAt);
    return rows.map((r) => ({
      id: r.id,
      eventType: r.eventType as EventKeywordRow["eventType"],
      keyword: r.keyword,
      source: r.source as EventKeywordRow["source"],
      defaultValue: r.defaultValue,
      active: r.active,
      createdAt: r.createdAt,
    }));
  });

export async function listEventKeywords(clientId: string): Promise<EventKeywordRow[]> {
  return _listEventKeywords({ data: { clientId } });
}

const _addEventKeyword = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      clientId: z.string(),
      eventType: eventTypeSchema,
      keyword: keywordSchema,
      source: sourceSchema,
      defaultValue: z.number().min(0).max(10_000_000).nullable().optional(),
    })
  )
  .handler(async ({ data }): Promise<void> => {
    await assertAccessible(data.clientId);
    const keywordNormalized = normalizeText(data.keyword);
    if (keywordNormalized.length < 2) throw new Error("A palavra-chave precisa ter pelo menos 2 letras ou números.");
    try {
      await db.insert(clientEventKeywords).values({
        clientId: data.clientId,
        eventType: data.eventType,
        keyword: data.keyword,
        keywordNormalized,
        source: data.source,
        // valor padrão só faz sentido pra compra
        defaultValue: data.eventType === "purchase" ? (data.defaultValue ?? null) : null,
      });
    } catch (err) {
      if ((err as { code?: string }).code === "23505") throw new Error("Essa palavra já existe nessa lista.");
      throw err;
    }
  });

export async function addEventKeyword(input: {
  clientId: string;
  eventType: "qualified_lead" | "purchase";
  keyword: string;
  source: "team" | "lead" | "any";
  defaultValue?: number | null;
}): Promise<void> {
  await _addEventKeyword({ data: input });
}

const _updateEventKeyword = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      id: z.string(),
      active: z.boolean().optional(),
      source: sourceSchema.optional(),
      defaultValue: z.number().min(0).max(10_000_000).nullable().optional(),
    })
  )
  .handler(async ({ data }): Promise<void> => {
    await assertRuleAccessible(data.id);
    const patch: Partial<typeof clientEventKeywords.$inferInsert> = {};
    if (data.active !== undefined) patch.active = data.active;
    if (data.source !== undefined) patch.source = data.source;
    if (data.defaultValue !== undefined) patch.defaultValue = data.defaultValue;
    if (Object.keys(patch).length === 0) return;
    await db.update(clientEventKeywords).set(patch).where(eq(clientEventKeywords.id, data.id));
  });

export async function updateEventKeyword(input: {
  id: string;
  active?: boolean;
  source?: "team" | "lead" | "any";
  defaultValue?: number | null;
}): Promise<void> {
  await _updateEventKeyword({ data: input });
}

const _deleteEventKeyword = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }): Promise<void> => {
    await assertRuleAccessible(data.id);
    await db.delete(clientEventKeywords).where(eq(clientEventKeywords.id, data.id));
  });

export async function deleteEventKeyword(id: string): Promise<void> {
  await _deleteEventKeyword({ data: { id } });
}

// ---------- Histórico ----------

const _listMetaEventLog = createServerFn({ method: "GET" })
  .inputValidator(z.object({ clientId: z.string(), limit: z.number().int().min(1).max(200).optional() }))
  .handler(async ({ data }): Promise<MetaEventLogRow[]> => {
    await assertAccessible(data.clientId);
    const rows = await db
      .select({
        id: metaEventLog.id,
        createdAt: metaEventLog.createdAt,
        eventType: metaEventLog.eventType,
        trigger: metaEventLog.trigger,
        keyword: metaEventLog.keyword,
        messageExcerpt: metaEventLog.messageExcerpt,
        datasetId: metaEventLog.datasetId,
        pageId: metaEventLog.pageId,
        status: metaEventLog.status,
        error: metaEventLog.error,
        contactName: metaLeadAttributions.contactName,
        remoteJid: metaLeadAttributions.remoteJid,
        adName: metaLeadAttributions.adName,
      })
      .from(metaEventLog)
      .innerJoin(metaLeadAttributions, eq(metaEventLog.leadId, metaLeadAttributions.id))
      .where(eq(metaLeadAttributions.clientId, data.clientId))
      .orderBy(desc(metaEventLog.createdAt))
      .limit(data.limit ?? 50);
    return rows as MetaEventLogRow[];
  });

export async function listMetaEventLog(clientId: string, limit?: number): Promise<MetaEventLogRow[]> {
  return _listMetaEventLog({ data: { clientId, limit } });
}

// ---------- Prontidão ----------

const _getConversionsReadiness = createServerFn({ method: "GET" })
  .inputValidator(z.object({ clientId: z.string() }))
  .handler(async ({ data }): Promise<ConversionsReadiness> => {
    await assertAccessible(data.clientId);
    const client = await db.query.clients.findFirst({
      where: eq(clients.id, data.clientId),
      columns: { whatsappInstanceId: true, metaCapiDatasetId: true },
    });
    const token = await getMetaToken(data.clientId).catch(() => null);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const failures = await db
      .select({ id: metaEventLog.id })
      .from(metaEventLog)
      .innerJoin(metaLeadAttributions, eq(metaEventLog.leadId, metaLeadAttributions.id))
      .where(
        and(
          eq(metaLeadAttributions.clientId, data.clientId),
          eq(metaEventLog.status, "failed"),
          gte(metaEventLog.createdAt, sevenDaysAgo),
          like(metaEventLog.error, "Anúncio sem pixel%")
        )
      );
    return {
      metaTokenOk: !!token,
      whatsappConnected: !!client?.whatsappInstanceId,
      n8nConfigured: !!(process.env.N8N_META_EVENTS_WEBHOOK_URL && process.env.N8N_WEBHOOK_SECRET),
      fallbackDatasetSet: !!client?.metaCapiDatasetId,
      noPixelFailuresLast7d: failures.length,
    };
  });

export async function getConversionsReadiness(clientId: string): Promise<ConversionsReadiness> {
  return _getConversionsReadiness({ data: { clientId } });
}

// ---------- Reaplicar o webhook da instância ----------
// Instâncias criadas antes desta feature só estão assinadas em MESSAGES_UPSERT e
// LABELS_ASSOCIATION; mensagens enviadas por API só chegam com SEND_MESSAGE.

const _reapplyWhatsappWebhook = createServerFn({ method: "POST" })
  .inputValidator(z.object({ clientId: z.string() }))
  .handler(async ({ data }): Promise<void> => {
    await assertAccessible(data.clientId);
    const client = await db.query.clients.findFirst({
      where: eq(clients.id, data.clientId),
      columns: { whatsappInstanceId: true },
    });
    if (!client?.whatsappInstanceId) throw new Error("Esse cliente não tem WhatsApp conectado.");
    const instance = await db.query.whatsappInstances.findFirst({
      where: eq(whatsappInstances.id, client.whatsappInstanceId),
      columns: { instanceName: true, evolutionKey: true },
    });
    if (!instance) throw new Error("Instância de WhatsApp não encontrada.");
    await configureEvolutionWebhook(instance.instanceName, instance.evolutionKey);
  });

export async function reapplyWhatsappWebhook(clientId: string): Promise<void> {
  await _reapplyWhatsappWebhook({ data: { clientId } });
}
