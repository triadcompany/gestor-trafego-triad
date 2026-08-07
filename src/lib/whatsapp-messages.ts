import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { appConfig, scheduledMessageRecipients, scheduledMessages } from "@/db/schema";

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
  has_media: boolean;
  media_filename: string | null;
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
      mediaFilename: scheduledMessages.mediaFilename,
      scheduledAt: scheduledMessages.scheduledAt,
      status: scheduledMessages.status,
      createdAt: scheduledMessages.createdAt,
    })
    .from(scheduledMessages)
    .orderBy(desc(scheduledMessages.scheduledAt));

  if (messages.length === 0) return [];

  const recipients = await db
    .select()
    .from(scheduledMessageRecipients)
    .where(inArray(scheduledMessageRecipients.messageId, messages.map((m) => m.id)));

  return messages.map((m) => ({
    id: m.id,
    body: m.body,
    has_media: !!m.mediaBase64,
    media_filename: m.mediaFilename,
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
  }));
});

export async function fetchScheduledMessages(): Promise<ScheduledMessageRow[]> {
  return _fetchScheduledMessages();
}

const _createScheduledMessage = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      body: z.string().min(1),
      mediaBase64: z.string().nullable().optional(),
      mediaMimetype: z.string().nullable().optional(),
      mediaFilename: z.string().nullable().optional(),
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
          mediaBase64: data.mediaBase64 ?? null,
          mediaMimetype: data.mediaMimetype ?? null,
          mediaFilename: data.mediaFilename ?? null,
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
    });
  });

export async function createScheduledMessage(data: {
  body: string;
  mediaBase64?: string | null;
  mediaMimetype?: string | null;
  mediaFilename?: string | null;
  scheduledAt: string;
  recipients: { remoteJid: string; name: string }[];
}): Promise<void> {
  await _createScheduledMessage({ data });
}

export interface ScheduledMessageDetail {
  id: string;
  body: string;
  media_base64: string | null;
  media_mimetype: string | null;
  media_filename: string | null;
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

    const recipients = await db
      .select()
      .from(scheduledMessageRecipients)
      .where(eq(scheduledMessageRecipients.messageId, data.id));

    return {
      id: message.id,
      body: message.body,
      media_base64: message.mediaBase64,
      media_mimetype: message.mediaMimetype,
      media_filename: message.mediaFilename,
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
      mediaBase64: z.string().nullable().optional(),
      mediaMimetype: z.string().nullable().optional(),
      mediaFilename: z.string().nullable().optional(),
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
          mediaBase64: data.mediaBase64 ?? null,
          mediaMimetype: data.mediaMimetype ?? null,
          mediaFilename: data.mediaFilename ?? null,
          scheduledAt: data.scheduledAt,
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
    });
  });

export async function updateScheduledMessage(data: {
  id: string;
  body: string;
  mediaBase64?: string | null;
  mediaMimetype?: string | null;
  mediaFilename?: string | null;
  scheduledAt: string;
  recipients: { remoteJid: string; name: string }[];
}): Promise<void> {
  await _updateScheduledMessage({ data });
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
  .inputValidator(z.object({ query: z.string() }))
  .handler(async ({ data }): Promise<EvolutionRecipient[]> => {
    const { url, apiKey, instance } = await getEvolutionConfig();
    const headers = { apikey: apiKey, "Content-Type": "application/json" };
    const q = data.query.trim().toLowerCase();

    const results: EvolutionRecipient[] = [];

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

export async function searchEvolutionRecipients(query: string): Promise<EvolutionRecipient[]> {
  return _searchEvolutionRecipients({ data: { query } });
}

const _sendActiveCampaignsList = createServerFn({ method: "POST" })
  .inputValidator(z.object({ clientName: z.string(), campaignNames: z.array(z.string()) }))
  .handler(async ({ data }) => {
    const { url, apiKey, instance } = await getEvolutionConfig();
    const rows = await db
      .select({ value: appConfig.value })
      .from(appConfig)
      .where(eq(appConfig.key, "whatsapp_group_operacional_id"));
    const groupId = rows[0]?.value;
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

export async function sendActiveCampaignsList(clientName: string, campaignNames: string[]): Promise<void> {
  await _sendActiveCampaignsList({ data: { clientName, campaignNames } });
}
