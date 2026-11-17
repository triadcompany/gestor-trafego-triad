// Módulo SERVER-ONLY — usa node:crypto, então nunca pode ser importado por
// código que também roda no cliente (por isso não fica em src/lib/meta.ts,
// que é importado por componentes de página).
import { createHash } from "node:crypto";
import { postMetaJson } from "@/lib/meta";
import { buildEventId, clampEventTime, META_EVENT_NAME, type MetaEventKind } from "@/lib/keyword-match";

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// Nome do WhatsApp (pushName) costuma vir com emoji, número ou nome de empresa.
// Só vira fn/ln se sobrar texto de letras depois de limpar — e nunca hasheamos
// string vazia (o hash de "" é igual pra todo mundo e só atrapalha o match).
function splitNameForMatch(contactName: string | null | undefined): { fn?: string; ln?: string } {
  if (!contactName) return {};
  const cleaned = contactName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return {};
  const parts = cleaned.split(" ");
  return parts.length >= 2 ? { fn: parts[0], ln: parts[parts.length - 1] } : { fn: parts[0] };
}

export interface BuildMetaEventInput {
  kind: MetaEventKind;
  leadId: string;
  ctwaClid: string;
  phoneRemoteJid?: string;
  email?: string | null;
  contactName?: string | null;
  value?: number | null; // só no purchase
  occurredAtMs?: number; // horário real do gatilho; padrão = agora
  pageId?: string; // quando ausente, quem envia (n8n) injeta a página descoberta pelo anúncio
}

/**
 * Monta o objeto do evento pra Conversions API (Business Messaging). Usado
 * tanto pelo envio via n8n quanto pelo envio direto. Telefone, e-mail e nome
 * saem hasheados (SHA256, normalizados); campo ausente é omitido.
 */
export function buildMetaEvent(i: BuildMetaEventInput): Record<string, unknown> {
  const userData: Record<string, string> = { ctwa_clid: i.ctwaClid };
  if (i.pageId) userData.page_id = i.pageId;
  const digits = i.phoneRemoteJid?.replace(/\D/g, "");
  if (digits) userData.ph = sha256Hex(digits);
  const email = i.email?.trim().toLowerCase();
  if (email) userData.em = sha256Hex(email);
  const { fn, ln } = splitNameForMatch(i.contactName);
  if (fn) userData.fn = sha256Hex(fn);
  if (ln) userData.ln = sha256Hex(ln);

  return {
    event_name: META_EVENT_NAME[i.kind],
    event_id: buildEventId(i.leadId, i.kind),
    event_time: clampEventTime(i.occurredAtMs ?? Date.now()),
    action_source: "business_messaging",
    messaging_channel: "whatsapp",
    user_data: userData,
    ...(i.kind === "purchase" && i.value != null ? { custom_data: { currency: "BRL", value: i.value } } : {}),
  };
}

/** Envio direto (sem n8n): POST {dataset}/events com o evento já montado. */
export async function postMetaEventDirect(params: { datasetId: string; event: Record<string, unknown>; token: string }): Promise<void> {
  await postMetaJson(`${params.datasetId}/events?access_token=${encodeURIComponent(params.token)}`, { data: [params.event] });
}
