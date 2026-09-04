import { createServerFn } from "@tanstack/react-start";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { appConfig, clients, scheduledMessageMedia, scheduledMessageRecipients, scheduledMessages } from "@/db/schema";

const mediaItemSchema = z.object({
  base64: z.string(),
  mimetype: z.string(),
  filename: z.string(),
});
export type MediaItem = z.infer<typeof mediaItemSchema>;

async function getEvolutionConfig(): Promise<{ url: string; apiKey: string; instance: string }> {
  const rows = await db
    .select({ key: appConfig.key, value: appConfig.value })
    .from(appConfig)
    .where(inArray(appConfig.key, ["evolution_api_url", "evolution_api_key", "evolution_instance"]));
  const values = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const url = values["evolution_api_url"];
  const apiKey = values["evolution_api_key"];
  const instance = values["evolution_instance"];
  if (!url || !apiKey || !instance) {
    throw new Error("Evolution API não configurada (evolution_api_url/evolution_api_key/evolution_instance em app_config).");
  }
  return { url, apiKey, instance };
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
    })
  )
  .handler(async ({ data }) => {
    await db.transaction(async (tx) => {
      const [message] = await tx
        .insert(scheduledMessages)
        .values({
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

const _fetchScheduledMessageById = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }): Promise<ScheduledMessageDetail | null> => {
    const [message] = await db
      .select()
      .from(scheduledMessages)
      .where(eq(scheduledMessages.id, data.id));
    if (!message) return null;

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
    const { url, apiKey, instance } = await getEvolutionConfig();
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
    const { url, apiKey, instance } = await getEvolutionConfig();
    const rows = await db
      .select({ key: appConfig.key, value: appConfig.value })
      .from(appConfig)
      .where(inArray(appConfig.key, ["whatsapp_group_operacional_id", "campaigns_list_destination"]));
    const configValues = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const destination = configValues["campaigns_list_destination"] || "operacional";
    const operacionalGroupId = configValues["whatsapp_group_operacional_id"];

    let groupId = operacionalGroupId;
    if (destination === "client_group") {
      const [client] = await db
        .select({ whatsappGroupId: clients.whatsappGroupId })
        .from(clients)
        .where(eq(clients.id, data.clientId));
      if (client?.whatsappGroupId) groupId = client.whatsappGroupId;
    }
    if (!groupId) {
      throw new Error("Grupo de destino não configurado (whatsapp_group_operacional_id em app_config).");
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
