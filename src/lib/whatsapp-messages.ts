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
export interface ResolvedWhatsappInstance {
  instanceId: string;
  url: string;
  apiKey: string;
  instance: string;
}

const _resolveWhatsappInstance = createServerFn({ method: "GET" })
  .inputValidator(z.object({ clientId: z.string().optional() }))
  .handler(async ({ data }): Promise<ResolvedWhatsappInstance> => {
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

// ── Instâncias WhatsApp ────────────────────────────────────────────
// Todas as organizações usam o MESMO servidor Evolution (env EVOLUTION_API_URL /
// EVOLUTION_API_KEY, com fallback pros valores atuais). Cada usuário gera a
// própria instância dentro dele; o app cria na Evolution, mostra o QR e guarda a
// linha em whatsapp_instances com a chave própria daquela instância.

const EVOLUTION_URL = () => (process.env.EVOLUTION_API_URL || "https://triadcompany-evolution-api.upw28y.easypanel.host").replace(/\/+$/, "");
const EVOLUTION_ADMIN_KEY = () => process.env.EVOLUTION_API_KEY || "429683C4C977415CAAFCCE10F7D57E11";

async function evoFetch(path: string, init: RequestInit & { apikey?: string } = {}) {
  const { apikey, ...rest } = init;
  const res = await fetch(`${EVOLUTION_URL()}${path}`, {
    ...rest,
    headers: { apikey: apikey || EVOLUTION_ADMIN_KEY(), "Content-Type": "application/json", ...(rest.headers || {}) },
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    const msg = (json && typeof json === "object" && "message" in json && (json as { message: unknown }).message) || text || res.statusText;
    throw new Error(`Evolution ${res.status}: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
  }
  return json;
}

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

function sanitizeInstanceName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// Cria a instância na Evolution e grava a linha. Retorna o QR code (base64) já
// pronto pra escanear.
const _createWhatsappInstance = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      label: z.string().min(1),
      instanceName: z.string().min(1),
      assignedUserId: z.string().nullable().optional(),
    })
  )
  .handler(async ({ data }): Promise<{ id: string; qrBase64: string | null }> => {
    const { organizationId } = await requireOrgContext();
    const base = sanitizeInstanceName(data.instanceName);
    if (!base) throw new Error("Nome da instância inválido — use letras e números.");
    // Sufixo curto da org pra evitar colisão no servidor compartilhado.
    const instanceName = `${base}-${organizationId.slice(0, 4)}`;

    const created = (await evoFetch("/instance/create", {
      method: "POST",
      body: JSON.stringify({ instanceName, integration: "WHATSAPP-BAILEYS", qrcode: true }),
    })) as {
      hash?: string | { apikey?: string };
      qrcode?: { base64?: string; code?: string };
    };

    const instanceKey =
      typeof created.hash === "string"
        ? created.hash
        : created.hash?.apikey || EVOLUTION_ADMIN_KEY();

    const [row] = await db
      .insert(whatsappInstances)
      .values({
        organizationId,
        label: data.label.trim(),
        evolutionUrl: EVOLUTION_URL(),
        evolutionKey: instanceKey,
        instanceName,
        assignedUserId: data.assignedUserId ?? null,
      })
      .returning({ id: whatsappInstances.id });

    return { id: row.id, qrBase64: created.qrcode?.base64 ?? null };
  });

export async function createWhatsappInstance(data: {
  label: string;
  instanceName: string;
  assignedUserId?: string | null;
}): Promise<{ id: string; qrBase64: string | null }> {
  return _createWhatsappInstance({ data });
}

async function loadInstanceInOrg(id: string, organizationId: string) {
  const row = await db.query.whatsappInstances.findFirst({ where: eq(whatsappInstances.id, id) });
  if (!row || row.organizationId !== organizationId) throw new Error("Instância não encontrada.");
  return row;
}

// (Re)pega o QR code de uma instância que ainda não conectou.
const _fetchWhatsappInstanceQr = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }): Promise<{ qrBase64: string | null }> => {
    const { organizationId } = await requireOrgContext();
    const inst = await loadInstanceInOrg(data.id, organizationId);
    const r = (await evoFetch(`/instance/connect/${encodeURIComponent(inst.instanceName)}`, {
      method: "GET",
      apikey: inst.evolutionKey,
    })) as { base64?: string; code?: string };
    return { qrBase64: r.base64 ?? null };
  });

export async function fetchWhatsappInstanceQr(id: string): Promise<{ qrBase64: string | null }> {
  return _fetchWhatsappInstanceQr({ data: { id } });
}

// Status de conexão: 'open' (conectado) | 'connecting' | 'close'.
const _fetchWhatsappInstanceState = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }): Promise<{ state: "open" | "connecting" | "close" | "unknown" }> => {
    const { organizationId } = await requireOrgContext();
    const inst = await loadInstanceInOrg(data.id, organizationId);
    try {
      const r = (await evoFetch(`/instance/connectionState/${encodeURIComponent(inst.instanceName)}`, {
        method: "GET",
        apikey: inst.evolutionKey,
      })) as { instance?: { state?: string } };
      const s = r.instance?.state;
      return { state: s === "open" || s === "connecting" || s === "close" ? s : "unknown" };
    } catch {
      return { state: "unknown" };
    }
  });

export async function fetchWhatsappInstanceState(id: string): Promise<{ state: "open" | "connecting" | "close" | "unknown" }> {
  return _fetchWhatsappInstanceState({ data: { id } });
}

// Edita só o rótulo e o gestor atribuído (o nome técnico e a chave não mudam).
const _renameWhatsappInstance = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string(), label: z.string().min(1), assignedUserId: z.string().nullable().optional() }))
  .handler(async ({ data }) => {
    const { organizationId } = await requireOrgContext();
    await loadInstanceInOrg(data.id, organizationId);
    await db
      .update(whatsappInstances)
      .set({ label: data.label.trim(), assignedUserId: data.assignedUserId ?? null })
      .where(eq(whatsappInstances.id, data.id));
  });

export async function renameWhatsappInstance(id: string, label: string, assignedUserId?: string | null): Promise<void> {
  await _renameWhatsappInstance({ data: { id, label, assignedUserId } });
}

const _deleteWhatsappInstance = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const { organizationId } = await requireOrgContext();
    const inst = await loadInstanceInOrg(data.id, organizationId);
    // Best-effort: desconecta e apaga na Evolution antes de remover a linha.
    await evoFetch(`/instance/logout/${encodeURIComponent(inst.instanceName)}`, { method: "DELETE", apikey: inst.evolutionKey }).catch(() => {});
    await evoFetch(`/instance/delete/${encodeURIComponent(inst.instanceName)}`, { method: "DELETE", apikey: inst.evolutionKey }).catch(() => {});
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
