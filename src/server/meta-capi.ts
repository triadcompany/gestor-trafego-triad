// Módulo SERVER-ONLY — usa node:crypto, então nunca pode ser importado por
// código que também roda no cliente (por isso não fica em src/lib/meta.ts,
// que é importado por componentes de página).
import { createHash } from "node:crypto";
import { postMetaJson } from "@/lib/meta";

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// Normalização exigida pela Meta antes de hashear: telefone só dígitos (com
// DDI), email em minúsculas e sem espaço nas pontas. Aumenta o Event Match
// Quality (EMQ) — quanto mais dado bate com uma conta real, melhor a Meta
// otimiza a entrega pelo evento.
function buildMetaUserData(ctwaClid: string, phoneRemoteJid?: string, email?: string, pageId?: string): Record<string, string> {
  const userData: Record<string, string> = { ctwa_clid: ctwaClid };
  // Exigido pela Meta pra eventos com action_source "business_messaging" —
  // sem isso a API recusa com "Page ID or WhatsApp Business Account ID Is
  // Missing" (code 100.2804116). Precisa ser o Page ID vinculado ao mesmo
  // conjunto de dados pro qual o evento está sendo enviado.
  if (pageId) userData.page_id = pageId;
  if (phoneRemoteJid) {
    const digits = phoneRemoteJid.replace(/\D/g, "");
    if (digits) userData.ph = sha256Hex(digits);
  }
  if (email?.trim()) {
    userData.em = sha256Hex(email.trim().toLowerCase());
  }
  return userData;
}

export async function sendQualifiedLeadEvent(params: {
  datasetId: string;
  ctwaClid: string;
  phoneRemoteJid?: string;
  email?: string;
  pageId?: string;
  token: string;
}): Promise<void> {
  await postMetaJson(`${params.datasetId}/events?access_token=${encodeURIComponent(params.token)}`, {
    data: [
      {
        event_name: "QualifiedLead",
        event_time: Math.floor(Date.now() / 1000),
        action_source: "business_messaging",
        messaging_channel: "whatsapp",
        user_data: buildMetaUserData(params.ctwaClid, params.phoneRemoteJid, params.email, params.pageId),
      },
    ],
  });
}

// Envio experimental com nome de evento arbitrário — usado pra testar se um
// nome "clássico"/universal (ex: "Lead", "LeadSubmitted") ganha suporte nativo
// de coluna no Gerenciador de Anúncios, ao contrário de "QualifiedLead" (que
// funciona pra rastreamento mas não vira coluna, por não estar na lista de
// eventos com otimização/relatório nativo documentada pra business_messaging).
export async function sendCustomMessagingEvent(params: {
  eventName: string;
  datasetId: string;
  ctwaClid: string;
  phoneRemoteJid?: string;
  email?: string;
  pageId?: string;
  token: string;
}): Promise<void> {
  await postMetaJson(`${params.datasetId}/events?access_token=${encodeURIComponent(params.token)}`, {
    data: [
      {
        event_name: params.eventName,
        event_time: Math.floor(Date.now() / 1000),
        action_source: "business_messaging",
        messaging_channel: "whatsapp",
        user_data: buildMetaUserData(params.ctwaClid, params.phoneRemoteJid, params.email, params.pageId),
      },
    ],
  });
}

/** Envia o evento de conversão "Purchase" pra Meta Conversions API, com valor da venda. */
export async function sendPurchaseEvent(params: {
  datasetId: string;
  ctwaClid: string;
  value: number | null;
  phoneRemoteJid?: string;
  email?: string;
  pageId?: string;
  token: string;
}): Promise<void> {
  await postMetaJson(`${params.datasetId}/events?access_token=${encodeURIComponent(params.token)}`, {
    data: [
      {
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000),
        action_source: "business_messaging",
        messaging_channel: "whatsapp",
        user_data: buildMetaUserData(params.ctwaClid, params.phoneRemoteJid, params.email, params.pageId),
        ...(params.value !== null ? { custom_data: { currency: "BRL", value: params.value } } : {}),
      },
    ],
  });
}
