// Lê o histórico de uma conversa de WhatsApp (texto + mídia) direto da
// instância Evolution do CLIENTE — tela de só-leitura em /conversas. Mídia
// não vem junto da listagem (pesado demais pra buscar tudo de uma vez), por
// isso fetchConversationMedia busca sob demanda, mensagem por mensagem.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { requireOrgContext } from "@/server/session";
import { canAccessClient } from "@/lib/client-access";
import { resolveClientWhatsappInstance } from "@/lib/whatsapp-messages";
import { isTriadCompanyOrg } from "@/lib/feature-flags";

export type ConversationMessageType = "text" | "image" | "video" | "audio" | "document" | "sticker" | "unsupported";

export interface ConversationMessage {
  id: string;
  remoteJid: string;
  fromMe: boolean;
  timestamp: number; // epoch seconds
  type: ConversationMessageType;
  text: string | null; // corpo do texto, ou legenda de uma mídia
  mimetype: string | null;
  fileName: string | null;
  isPtt: boolean; // áudio gravado na hora (balão de voz) vs. arquivo de áudio
}

interface RawEvoMessage {
  key?: { id?: string; fromMe?: boolean; remoteJid?: string };
  messageTimestamp?: number;
  message?: Record<string, unknown>;
}

function normalizeMessage(r: RawEvoMessage): ConversationMessage | null {
  const id = r.key?.id;
  const remoteJid = r.key?.remoteJid;
  if (!id || !remoteJid || typeof r.messageTimestamp !== "number") return null;
  const m = (r.message ?? {}) as Record<string, any>;
  const base = { id, remoteJid, fromMe: !!r.key?.fromMe, timestamp: r.messageTimestamp };

  if (typeof m.conversation === "string" && m.conversation.length > 0) {
    return { ...base, type: "text", text: m.conversation, mimetype: null, fileName: null, isPtt: false };
  }
  if (typeof m.extendedTextMessage?.text === "string") {
    return { ...base, type: "text", text: m.extendedTextMessage.text, mimetype: null, fileName: null, isPtt: false };
  }
  if (m.imageMessage) {
    return { ...base, type: "image", text: m.imageMessage.caption ?? null, mimetype: m.imageMessage.mimetype ?? null, fileName: null, isPtt: false };
  }
  if (m.videoMessage) {
    return { ...base, type: "video", text: m.videoMessage.caption ?? null, mimetype: m.videoMessage.mimetype ?? null, fileName: null, isPtt: false };
  }
  if (m.audioMessage) {
    return { ...base, type: "audio", text: null, mimetype: m.audioMessage.mimetype ?? null, fileName: null, isPtt: !!m.audioMessage.ptt };
  }
  const doc = m.documentMessage ?? m.documentWithCaptionMessage?.message?.documentMessage;
  if (doc) {
    return { ...base, type: "document", text: doc.caption ?? null, mimetype: doc.mimetype ?? null, fileName: doc.fileName ?? null, isPtt: false };
  }
  if (m.stickerMessage) {
    return { ...base, type: "sticker", text: null, mimetype: m.stickerMessage.mimetype ?? null, fileName: null, isPtt: false };
  }
  // Reações, mensagens de protocolo (apagada, etc.) e outros tipos não exibidos.
  return { ...base, type: "unsupported", text: null, mimetype: null, fileName: null, isPtt: false };
}

const PAGE_SIZE = 50;

async function assertAccessibleClient(clientId: string) {
  const { organizationId, role, userId } = await requireOrgContext();
  // Conversas é experimental — liberado só pra organização da Triad Company
  // antes de abrir pras demais organizações do SaaS.
  if (!isTriadCompanyOrg(organizationId)) throw new Error("Funcionalidade ainda não disponível pra essa organização.");
  const client = await db.query.clients.findFirst({
    where: eq(clients.id, clientId),
    columns: { organizationId: true, ownerUserId: true },
  });
  if (!client || !canAccessClient({ organizationId, role, userId }, client)) throw new Error("Cliente não encontrado.");
}

const _fetchConversationMessages = createServerFn({ method: "GET" })
  .inputValidator(z.object({ clientId: z.string(), remoteJid: z.string(), page: z.number().int().min(1).default(1) }))
  .handler(async ({ data }): Promise<{ messages: ConversationMessage[]; hasMore: boolean }> => {
    await assertAccessibleClient(data.clientId);
    const { url, apiKey, instance } = await resolveClientWhatsappInstance(data.clientId);
    const { records, hasMore } = await findMessagesByJid(url, apiKey, instance, data.remoteJid, data.page);

    const messages = records
      .map(normalizeMessage)
      .filter((m): m is ConversationMessage => m !== null)
      .sort((a, b) => a.timestamp - b.timestamp);

    return { messages, hasMore };
  });

// WhatsApp passou a endereçar muitos contatos por um "LID" opaco
// (key.remoteJid = "123...@lid") em vez do número de telefone — a Evolution
// guarda o JID de telefone de volta em key.remoteJidAlt. O remote_jid que a
// gente salva no rastreamento de leads é sempre o de telefone (o que aparece
// formatado na tela), então pra achar a conversa primeiro tenta casar por
// remoteJidAlt (cobre contato em modo LID); se não achar nada, tenta de novo
// por remoteJid puro (contato antigo, ainda endereçado só por telefone).
// Descoberto ao vivo: filtrar só por remoteJid devolvia 0 mensagens pra
// praticamente todo mundo nessa instância.
async function findMessagesByJid(
  url: string,
  apiKey: string,
  instance: string,
  remoteJid: string,
  page: number
): Promise<{ records: RawEvoMessage[]; hasMore: boolean }> {
  const run = async (field: "remoteJidAlt" | "remoteJid") => {
    const res = await fetch(`${url.replace(/\/+$/, "")}/chat/findMessages/${encodeURIComponent(instance)}`, {
      method: "POST",
      headers: { apikey: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ where: { key: { [field]: remoteJid } }, limit: PAGE_SIZE, page }),
    });
    if (!res.ok) throw new Error(`Erro ao buscar mensagens: ${res.status}`);
    const json = (await res.json()) as
      | { messages?: { records?: RawEvoMessage[]; total?: number; pages?: number; currentPage?: number } }
      | RawEvoMessage[];
    if (Array.isArray(json)) return { records: json, hasMore: json.length >= PAGE_SIZE };
    const meta = json.messages;
    const records = meta?.records ?? [];
    const hasMore =
      typeof meta?.pages === "number" && typeof meta?.currentPage === "number"
        ? meta.currentPage < meta.pages
        : records.length >= PAGE_SIZE;
    return { records, hasMore };
  };

  const byAlt = await run("remoteJidAlt");
  if (byAlt.records.length > 0) return byAlt;
  return run("remoteJid");
}

export async function fetchConversationMessages(
  clientId: string,
  remoteJid: string,
  page = 1
): Promise<{ messages: ConversationMessage[]; hasMore: boolean }> {
  return _fetchConversationMessages({ data: { clientId, remoteJid, page } });
}

const _fetchConversationMedia = createServerFn({ method: "POST" })
  .inputValidator(z.object({ clientId: z.string(), messageId: z.string(), remoteJid: z.string(), fromMe: z.boolean() }))
  .handler(async ({ data }): Promise<{ base64: string; mimetype: string | null }> => {
    await assertAccessibleClient(data.clientId);
    const { url, apiKey, instance } = await resolveClientWhatsappInstance(data.clientId);

    const res = await fetch(`${url.replace(/\/+$/, "")}/chat/getBase64FromMediaMessage/${encodeURIComponent(instance)}`, {
      method: "POST",
      headers: { apikey: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { key: { id: data.messageId, remoteJid: data.remoteJid, fromMe: data.fromMe } } }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Erro ao buscar mídia: ${res.status} - ${body}`);
    }
    const json = (await res.json()) as { base64?: string; mimetype?: string };
    if (!json.base64) throw new Error("Mídia não encontrada ou expirou no WhatsApp.");
    return { base64: json.base64, mimetype: json.mimetype ?? null };
  });

export async function fetchConversationMedia(
  clientId: string,
  messageId: string,
  remoteJid: string,
  fromMe: boolean
): Promise<{ base64: string; mimetype: string | null }> {
  return _fetchConversationMedia({ data: { clientId, messageId, remoteJid, fromMe } });
}
