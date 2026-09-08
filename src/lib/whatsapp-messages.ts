import { createServerFn } from "@tanstack/react-start";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { appConfig, clients, scheduledMessageMedia, scheduledMessageRecipients, scheduledMessages, whatsappInstances } from "@/db/schema";
import { requireOrgContext } from "@/server/session";

const mediaItemSchema = z.object({
  base64: z.string(),
  mimetype: z.string(),
  filename: z.string(),
});
export type MediaItem = z.infer<typeof mediaItemSchema>;

// Resolve qual instância Evolution usar: se clientId for dado, usa a do cliente
// (clients.whatsappInstanceId); senão, resolve a "padrão" da organização — a
// instância atribuída ao usuário logado, senão a mais antiga ativa.
// Envolvida em createServerFn (como tudo mais neste arquivo) pra garantir que o
// código que toca o Postgres nunca vaze pro bundle do navegador — este módulo é
// importado por componentes de cliente (ex: ClientFormDialog), então qualquer
// função solta aqui que use `db` diretamente entraria no bundle do cliente.
const _resolveWhatsappInstance = createServerFn({ method: "GET" })
  .inputValidator(z.object({ clientId: z.string().optional() }))
  .handler(async ({ data }): Promise<{ instanceId: string; url: string; apiKey: string; instance: string }> => {
    const { organizationId, userId } = await requireOrgContext();

    if (data.clientId) {
      const client = await db.query.clients.findFirst({
        where: eq(clients.id, data.clientId),
        columns: { organizationId: true, whatsappInstanceId: true },
      });
      if (!client || client.organizationId !== organizationId) throw new Error("Cliente não encontrado.");
      if (client.whatsappInstanceId) {
        const row = await db.query.whatsappInstances.findFirst({ where: eq(whatsappInstances.id, client.whatsappInstanceId) });
        if (row?.active) return { instanceId: row.id, url: row.evolutionUrl, apiKey: row.evolutionKey, instance: row.instanceName };
      }
    }

    const candidates = await db
      .select()
      .from(whatsappInstances)
      .where(and(eq(whatsappInstances.organizationId, organizationId), eq(whatsappInstances.active, true)))
      .orderBy(whatsappInstances.createdAt);
    const chosen = candidates.find((i) => i.assignedUserId === userId) ?? candidates[0];
    if (!chosen) throw new Error("Nenhuma instância de WhatsApp configurada. Acesse Configurações.");
    return { instanceId: chosen.id, url: chosen.evolutionUrl, apiKey: chosen.evolutionKey, instance: chosen.instanceName };
  });

export async function resolveWhatsappInstance(clientId?: string): Promise<{
  instanceId: string;
  url: string;
  apiKey: string;
  instance: string;
}> {
  return _resolveWhatsappInstance({ data: { clientId } });
}

// ── Instâncias WhatsApp (CRUD, admin) ──────────────────────────────

export interface WhatsappInstanceRow {
  id: string;
  label: string;
  instanceName: string;
  assignedUserId: string | null;
  active: boolean;
  createdAt: string;
}

const _fetchWhatsappInstances = createServerFn({ method: "GET" }).handler(async (): Promise<WhatsappInstanceRow[]> => {
  const { organizationId } = await requireOrgContext();
  return db
    .select({
      id: whatsappInstances.id,
      label: whatsappInstances.label,
      instanceName: whatsappInstances.instanceName,
      assignedUserId: whatsappInstances.assignedUserId,
      active: whatsappInstances.active,
      createdAt: whatsappInstances.createdAt,
    })
    .from(whatsappInstances)
    .where(eq(whatsappInstances.organizationId, organizationId))
    .orderBy(whatsappInstances.createdAt);
});

export async function fetchWhatsappInstances(): Promise<WhatsappInstanceRow[]> {
  return _fetchWhatsappInstances();
}

const upsertWhatsappInstanceSchema = z.object({
  id: z.string().optional(),
  label: z.string(),
  evolutionUrl: z.string().optional(), // vazio ao editar = mantém o valor salvo
  evolutionKey: z.string().optional(),
  instanceName: z.string().optional(),
  assignedUserId: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

const _upsertWhatsappInstance = createServerFn({ method: "POST" })
  .inputValidator(upsertWhatsappInstanceSchema)
  .handler(async ({ data }) => {
    const { organizationId } = await requireOrgContext("admin");
    if (data.id) {
      const existing = await db.query.whatsappInstances.findFirst({ where: eq(whatsappInstances.id, data.id) });
      if (!existing || existing.organizationId !== organizationId) throw new Error("Instância não encontrada.");
      await db
        .update(whatsappInstances)
        .set({
          label: data.label,
          ...(data.evolutionUrl ? { evolutionUrl: data.evolutionUrl } : {}),
          ...(data.evolutionKey ? { evolutionKey: data.evolutionKey } : {}),
          ...(data.instanceName ? { instanceName: data.instanceName } : {}),
          assignedUserId: data.assignedUserId ?? null,
          ...(data.active !== undefined ? { active: data.active } : {}),
        })
        .where(eq(whatsappInstances.id, data.id));
      return { id: data.id };
    }
    if (!data.evolutionUrl || !data.evolutionKey || !data.instanceName) {
      throw new Error("URL, chave e nome da instância são obrigatórios.");
    }
    const [row] = await db
      .insert(whatsappInstances)
      .values({
        organizationId,
        label: data.label,
        evolutionUrl: data.evolutionUrl,
        evolutionKey: data.evolutionKey,
        instanceName: data.instanceName,
        assignedUserId: data.assignedUserId ?? null,
      })
      .returning({ id: whatsappInstances.id });
    return { id: row.id };
  });

export async function upsertWhatsappInstance(data: z.infer<typeof upsertWhatsappInstanceSchema>): Promise<{ id: string }> {
  return _upsertWhatsappInstance({ data });
}

const _deleteWhatsappInstance = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const { organizationId } = await requireOrgContext("admin");
    const existing = await db.query.whatsappInstances.findFirst({ where: eq(whatsappInstances.id, data.id) });
    if (!existing || existing.organizationId !== organizationId) throw new Error("Instância não encontrada.");
    await db.delete(whatsappInstances).where(eq(whatsappInstances.id, data.id));
  });

export async function deleteWhatsappInstance(id: string): Promise<void> {
  await _deleteWhatsappInstance({ data: { id } });
}

export interface ScheduledMessageRecipientRow {
  id: string;
  remote_jid: string;
  name: string;
  status: "pending" | "sent" | "failed";
  sent_at: string | null;
  error_message: string | null;
}

export interface ScheduledMessageRow {
  id: string;
  body: string;
  media_count: number;
  scheduled_at: string;
  status: "pending" | "sent" | "partial" | "failed" | "canceled";
  created_at: string;
  recipients: ScheduledMessageRecipientRow[];
}

const _fetchScheduledMessages = createServerFn({ method: "GET" }).handler(async () => {
  const { organizationId } = await requireOrgContext();
  const messages = await db
    .select({
      id: scheduledMessages.id,
      body: scheduledMessages.body,
      mediaBase64: scheduledMessages.mediaBase64,
      scheduledAt: scheduledMessages.scheduledAt,
      status: scheduledMessages.status,
      createdAt: scheduledMessages.createdAt,
    })
    .from(scheduledMessages)
    .where(eq(scheduledMessages.organizationId, organizationId))
    .orderBy(desc(scheduledMessages.scheduledAt));

  if (messages.length === 0) return [];

  const [recipients, media] = await Promise.all([
    db
      .select()
      .from(scheduledMessageRecipients)
      .where(inArray(scheduledMessageRecipients.messageId, messages.map((m) => m.id))),
    db
      .select({ messageId: scheduledMessageMedia.messageId })
      .from(scheduledMessageMedia)
      .where(inArray(scheduledMessageMedia.messageId, messages.map((m) => m.id))),
  ]);

  return messages.map((m) => {
    const newMediaCount = media.filter((x) => x.messageId === m.id).length;
    return {
      id: m.id,
      body: m.body,
      media_count: newMediaCount > 0 ? newMediaCount : m.mediaBase64 ? 1 : 0,
      scheduled_at: m.scheduledAt,
      status: m.status as ScheduledMessageRow["status"],
      created_at: m.createdAt,
      recipients: recipients
        .filter((r) => r.messageId === m.id)
        .map((r) => ({
          id: r.id,
          remote_jid: r.remoteJid,
          name: r.name,
          status: r.status as ScheduledMessageRecipientRow["status"],
          sent_at: r.sentAt,
          error_message: r.errorMessage,
        })),
    };
  });
});

export async function fetchScheduledMessages(): Promise<ScheduledMessageRow[]> {
  return _fetchScheduledMessages();
}

const _createScheduledMessage = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      body: z.string().min(1),
      media: z.array(mediaItemSchema).default([]),
      scheduledAt: z.string(),
      recipients: z.array(z.object({ remoteJid: z.string(), name: z.string() })).min(1),
      whatsappInstanceId: z.string().optional(),
    })
  )
  .handler(async ({ data }) => {
    const { organizationId } = await requireOrgContext();
    // Resolve a instância agora (mesmo sem usá-la aqui) só pra validar que existe
    // uma configurada antes de agendar — evita criar uma mensagem que nunca vai sair.
    const resolved = data.whatsappInstanceId
      ? await db.query.whatsappInstances.findFirst({ where: eq(whatsappInstances.id, data.whatsappInstanceId) })
      : null;
    if (data.whatsappInstanceId && (!resolved || resolved.organizationId !== organizationId)) {
      throw new Error("Instância de WhatsApp não encontrada.");
    }
    const whatsappInstanceId = resolved?.id ?? (await resolveWhatsappInstance()).instanceId;

    await db.transaction(async (tx) => {
      const [message] = await tx
        .insert(scheduledMessages)
        .values({
          organizationId,
          whatsappInstanceId,
          body: data.body,
          scheduledAt: data.scheduledAt,
          status: "pending",
        })
        .returning();
      await tx.insert(scheduledMessageRecipients).values(
        data.recipients.map((r) => ({
          messageId: message.id,
          remoteJid: r.remoteJid,
          name: r.name,
          status: "pending" as const,
        }))
      );
      if (data.media.length > 0) {
        await tx.insert(scheduledMessageMedia).values(
          data.media.map((m, i) => ({
            messageId: message.id,
            base64: m.base64,
            mimetype: m.mimetype,
            filename: m.filename,
            sortOrder: i,
          }))
        );
      }
    });
  });

export async function createScheduledMessage(data: {
  body: string;
  media?: MediaItem[];
  scheduledAt: string;
  recipients: { remoteJid: string; name: string }[];
  whatsappInstanceId?: string;
}): Promise<void> {
  await _createScheduledMessage({ data: { ...data, media: data.media ?? [] } });
}

export interface ScheduledMessageDetail {
  id: string;
  body: string;
  media: MediaItem[];
  scheduled_at: string;
  status: ScheduledMessageRow["status"];
  recipients: { remote_jid: string; name: string }[];
}

async function assertScheduledMessageInOrg(id: string, organizationId: string): Promise<typeof scheduledMessages.$inferSelect> {
  const [message] = await db.select().from(scheduledMessages).where(eq(scheduledMessages.id, id));
  if (!message || message.organizationId !== organizationId) throw new Error("Mensagem não encontrada.");
  return message;
}

const _fetchScheduledMessageById = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }): Promise<ScheduledMessageDetail | null> => {
    const { organizationId } = await requireOrgContext();
    const [message] = await db.select().from(scheduledMessages).where(eq(scheduledMessages.id, data.id));
    if (!message || message.organizationId !== organizationId) return null;

    const [recipients, media] = await Promise.all([
      db
        .select()
        .from(scheduledMessageRecipients)
        .where(eq(scheduledMessageRecipients.messageId, data.id)),
      db
        .select({
          base64: scheduledMessageMedia.base64,
          mimetype: scheduledMessageMedia.mimetype,
          filename: scheduledMessageMedia.filename,
        })
        .from(scheduledMessageMedia)
        .where(eq(scheduledMessageMedia.messageId, data.id))
        .orderBy(asc(scheduledMessageMedia.sortOrder)),
    ]);

    // Mensagens antigas (antes de scheduled_message_media existir) guardavam 1 mídia direto nas colunas legadas.
    const legacyMedia: MediaItem[] =
      media.length === 0 && message.mediaBase64 && message.mediaMimetype && message.mediaFilename
        ? [{ base64: message.mediaBase64, mimetype: message.mediaMimetype, filename: message.mediaFilename }]
        : [];

    return {
      id: message.id,
      body: message.body,
      media: media.length > 0 ? media : legacyMedia,
      scheduled_at: message.scheduledAt,
      status: message.status as ScheduledMessageRow["status"],
      recipients: recipients.map((r) => ({ remote_jid: r.remoteJid, name: r.name })),
    };
  });

export async function fetchScheduledMessageById(id: string): Promise<ScheduledMessageDetail | null> {
  return _fetchScheduledMessageById({ data: { id } });
}

const _updateScheduledMessage = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      id: z.string(),
      body: z.string().min(1),
      media: z.array(mediaItemSchema).default([]),
      scheduledAt: z.string(),
      recipients: z.array(z.object({ remoteJid: z.string(), name: z.string() })).min(1),
    })
  )
  .handler(async ({ data }) => {
    const { organizationId } = await requireOrgContext();
    await assertScheduledMessageInOrg(data.id, organizationId);
    await db.transaction(async (tx) => {
      const [message] = await tx
        .update(scheduledMessages)
        .set({
          body: data.body,
          scheduledAt: data.scheduledAt,
          // Zera as colunas legadas — a partir da edição, a mídia passa a viver só em scheduled_message_media.
          mediaBase64: null,
          mediaMimetype: null,
          mediaFilename: null,
        })
        .where(and(eq(scheduledMessages.id, data.id), eq(scheduledMessages.status, "pending")))
        .returning();
      if (!message) throw new Error("Só é possível editar mensagens ainda pendentes.");

      await tx.delete(scheduledMessageRecipients).where(eq(scheduledMessageRecipients.messageId, data.id));
      await tx.insert(scheduledMessageRecipients).values(
        data.recipients.map((r) => ({
          messageId: data.id,
          remoteJid: r.remoteJid,
          name: r.name,
          status: "pending" as const,
        }))
      );

      await tx.delete(scheduledMessageMedia).where(eq(scheduledMessageMedia.messageId, data.id));
      if (data.media.length > 0) {
        await tx.insert(scheduledMessageMedia).values(
          data.media.map((m, i) => ({
            messageId: data.id,
            base64: m.base64,
            mimetype: m.mimetype,
            filename: m.filename,
            sortOrder: i,
          }))
        );
      }
    });
  });

export async function updateScheduledMessage(data: {
  id: string;
  body: string;
  media?: MediaItem[];
  scheduledAt: string;
  recipients: { remoteJid: string; name: string }[];
}): Promise<void> {
  await _updateScheduledMessage({ data: { ...data, media: data.media ?? [] } });
}

const _cancelScheduledMessage = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const { organizationId } = await requireOrgContext();
    await assertScheduledMessageInOrg(data.id, organizationId);
    await db
      .update(scheduledMessages)
      .set({ status: "canceled" })
      .where(eq(scheduledMessages.id, data.id));
  });

export async function cancelScheduledMessage(id: string): Promise<void> {
  await _cancelScheduledMessage({ data: { id } });
}

export interface EvolutionRecipient {
  remoteJid: string;
  name: string;
  isGroup: boolean;
}

const _searchEvolutionRecipients = createServerFn({ method: "GET" })
  .inputValidator(z.object({ query: z.string(), groupsOnly: z.boolean().optional() }))
  .handler(async ({ data }): Promise<EvolutionRecipient[]> => {
    const { url, apiKey, instance } = await resolveWhatsappInstance();
    const headers = { apikey: apiKey, "Content-Type": "application/json" };
    const q = data.query.trim().toLowerCase();

    const results: EvolutionRecipient[] = [];

    if (!data.groupsOnly) {
      try {
        const res = await fetch(`${url}/chat/findContacts/${instance}`, {
          method: "POST",
          headers,
          body: JSON.stringify({}),
        });
        const contacts = (await res.json()) as Array<{ remoteJid?: string; pushName?: string | null; isGroup?: boolean }>;
        for (const c of contacts ?? []) {
          if (!c.remoteJid || c.isGroup) continue;
          const name = c.pushName || c.remoteJid.split("@")[0];
          if (q && !name.toLowerCase().includes(q) && !c.remoteJid.includes(q)) continue;
          results.push({ remoteJid: c.remoteJid, name, isGroup: false });
        }
      } catch {
        // segue só com o que conseguir (grupos), não derruba a busca inteira
      }
    }

    try {
      const res = await fetch(`${url}/group/fetchAllGroups/${instance}?getParticipants=false`, {
        method: "GET",
        headers,
      });
      const groups = (await res.json()) as Array<{ id?: string; subject?: string }>;
      if (Array.isArray(groups)) {
        for (const g of groups) {
          if (!g.id) continue;
          const name = g.subject || g.id;
          if (q && !name.toLowerCase().includes(q)) continue;
          results.push({ remoteJid: g.id, name, isGroup: true });
        }
      }
    } catch {
      // instância pode estar desconectada — segue só com contatos
    }

    return results.slice(0, 30);
  });

export async function searchEvolutionRecipients(query: string, groupsOnly?: boolean): Promise<EvolutionRecipient[]> {
  return _searchEvolutionRecipients({ data: { query, groupsOnly } });
}

const _sendActiveCampaignsList = createServerFn({ method: "POST" })
  .inputValidator(z.object({ clientId: z.string(), clientName: z.string(), campaignNames: z.array(z.string()) }))
  .handler(async ({ data }) => {
    const { organizationId } = await requireOrgContext();
    const client = await db.query.clients.findFirst({
      where: eq(clients.id, data.clientId),
      columns: { organizationId: true, whatsappGroupId: true },
    });
    if (!client || client.organizationId !== organizationId) throw new Error("Cliente não encontrado.");

    const { url, apiKey, instance } = await resolveWhatsappInstance(data.clientId);
    const rows = await db
      .select({ key: appConfig.key, value: appConfig.value })
      .from(appConfig)
      .where(and(eq(appConfig.organizationId, organizationId), inArray(appConfig.key, ["whatsapp_group_operacional_id", "campaigns_list_destination"])));
    const configValues = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const destination = configValues["campaigns_list_destination"] || "operacional";
    const operacionalGroupId = configValues["whatsapp_group_operacional_id"];

    let groupId = operacionalGroupId;
    if (destination === "client_group" && client.whatsappGroupId) {
      groupId = client.whatsappGroupId;
    }
    if (!groupId) {
      throw new Error("Grupo de destino não configurado (whatsapp_group_operacional_id em Configurações).");
    }

    const text = `📋 ${data.campaignNames.length} Campanhas ativas — ${data.clientName}\n\n${data.campaignNames.map((n) => `• ${n}`).join("\n")}`;

    const res = await fetch(`${url}/message/sendText/${instance}`, {
      method: "POST",
      headers: { apikey: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ number: groupId, text }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Erro ao enviar mensagem: ${res.status} - ${body}`);
    }
  });

export async function sendActiveCampaignsList(clientId: string, clientName: string, campaignNames: string[]): Promise<void> {
  await _sendActiveCampaignsList({ data: { clientId, clientName, campaignNames } });
}
