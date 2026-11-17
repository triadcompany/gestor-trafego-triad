// Regras de palavra-chave pros eventos de conversão (lead qualificado / compra).
// Módulo PURO, sem imports: roda no servidor e nos testes (node:test) sem
// depender de nada do app. Ver docs/superpowers/specs/2026-11-17-eventos-meta-via-n8n-design.md

export type EventType = "qualified_lead" | "purchase";
export type RuleSource = "team" | "lead" | "any";

export interface KeywordRule {
  id: string;
  eventType: EventType;
  keyword: string;
  keywordNormalized: string;
  source: RuleSource;
  defaultValue: number | null;
  active: boolean;
}

/** Minúsculas, sem acento, espaços colapsados — usado dos dois lados da comparação. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Primeira regra ativa do tipo cujo texto normalizado contém a palavra e cujo
 * "quem diz" confere com quem escreveu (fromMe = equipe).
 */
export function matchRule(rules: KeywordRule[], eventType: EventType, text: string, fromMe: boolean): KeywordRule | null {
  const t = normalizeText(text);
  if (!t) return null;
  for (const r of rules) {
    if (!r.active || r.eventType !== eventType || !r.keywordNormalized) continue;
    if (r.source === "team" && !fromMe) continue;
    if (r.source === "lead" && fromMe) continue;
    if (t.includes(r.keywordNormalized)) return r;
  }
  return null;
}

/**
 * Primeiro "R$ <valor>" no formato brasileiro (1.500,00 | 1500 | R$1 | 12,5).
 * Ancorado no "R$" de propósito: não confunde telefone, parcela ou data com valor.
 */
export function extractBrlAmount(text: string): number | null {
  const m = text.match(/R\$\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?/i);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, "") + (m[2] ? "." + m[2] : ""));
  return Number.isFinite(n) ? n : null;
}

export type MetaEventKind = "qualified" | "lead" | "purchase";

export const META_EVENT_NAME: Record<MetaEventKind, string> = {
  qualified: "QualifiedLead",
  lead: "LeadSubmitted",
  purchase: "Purchase",
};

/** event_id determinístico: a Meta deduplica o mesmo evento enviado duas vezes. */
export function buildEventId(leadId: string, kind: MetaEventKind): string {
  return `${leadId}:${kind}`;
}

/**
 * A Meta só aceita event_time até 7 dias atrás (e não no futuro). Fora disso
 * usa o momento atual. Devolve segundos.
 */
export function clampEventTime(occurredAtMs: number, nowMs: number = Date.now()): number {
  const maxAgeMs = 7 * 24 * 3600 * 1000 - 3600 * 1000; // 1h de folga
  const invalid = !Number.isFinite(occurredAtMs) || occurredAtMs > nowMs || nowMs - occurredAtMs > maxAgeMs;
  return Math.floor((invalid ? nowMs : occurredAtMs) / 1000);
}
