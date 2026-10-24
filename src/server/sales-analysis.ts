// Gera um relatório de análise comercial (texto + exemplos) a partir das
// conversas de WhatsApp de um cliente num período — números calculados por
// código, leitura/recomendações pela IA (reaproveita a mesma chave OpenAI do
// Agente de IA). Experimental: só pra organização Triad Company.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import OpenAI from "openai";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { requireOrgContext } from "@/server/session";
import { canAccessClient } from "@/lib/client-access";
import { isTriadCompanyOrg } from "@/lib/feature-flags";
import { getOpenAIKey, getSalesAnalysisPrompt, mapWithConcurrency } from "@/lib/meta";
import { fetchLeadAttributions, type LeadAttributionRow } from "@/server/lead-attribution";
import { fetchConversationTranscript } from "@/server/whatsapp-conversations";
import type { DashboardPeriod } from "@/lib/queries";

const MAX_LEADS = 40;
const MAX_MESSAGES_PER_LEAD = 60;
const CONCURRENCY = 4;

const QUALIFIED_STATUSES = new Set<LeadAttributionRow["status"]>(["qualified", "conversion_sent", "conversion_failed"]);

export interface SalesAnalysisExample {
  leadName: string;
  issue: string;
  excerpt: string;
  suggestion: string;
}

export interface SalesAnalysisResult {
  clientName: string;
  generatedAt: string;
  stats: {
    totalLeads: number;
    qualifiedLeads: number;
    qualificationRate: number; // 0-1
    convertedLeads: number;
    conversionRate: number; // 0-1
    avgFirstReplyMinutes: number | null;
    leadsAnalyzed: number;
    leadsSkipped: number;
  };
  summary: string;
  recommendations: string[];
  examples: SalesAnalysisExample[];
}

const periodSchema = z.enum(["last_7d", "last_30d", "this_month", "last_month", "maximum"]);

const _generateSalesAnalysis = createServerFn({ method: "POST" })
  .inputValidator(z.object({ clientId: z.string(), period: periodSchema }))
  .handler(async ({ data }): Promise<SalesAnalysisResult> => {
    const { organizationId, role, userId } = await requireOrgContext();
    if (!isTriadCompanyOrg(organizationId)) throw new Error("Funcionalidade ainda não disponível pra essa organização.");

    const client = await db.query.clients.findFirst({
      where: eq(clients.id, data.clientId),
      columns: { organizationId: true, ownerUserId: true, name: true },
    });
    if (!client || !canAccessClient({ organizationId, role, userId }, client)) throw new Error("Cliente não encontrado.");

    const openaiKey = await getOpenAIKey();
    if (!openaiKey) throw new Error("Chave OpenAI não configurada. Acesse Configurações → Agente de IA.");
    const analysisPrompt = await getSalesAnalysisPrompt();

    const allLeads = await fetchLeadAttributions(data.clientId, data.period as DashboardPeriod);
    const leads = allLeads.slice(0, MAX_LEADS);
    if (leads.length === 0) {
      throw new Error("Nenhum lead encontrado nesse período pra esse cliente.");
    }

    const results = await mapWithConcurrency(leads, CONCURRENCY, async (lead) => {
      const { transcript, firstReplySeconds } = await fetchConversationTranscript(data.clientId, lead.remote_jid, MAX_MESSAGES_PER_LEAD);
      return { lead, transcript, firstReplySeconds };
    });

    const ok = results
      .filter((r): r is PromiseFulfilledResult<{ lead: LeadAttributionRow; transcript: string; firstReplySeconds: number | null }> => r.status === "fulfilled")
      .map((r) => r.value)
      .filter((r) => r.transcript.trim().length > 0);

    if (ok.length === 0) {
      throw new Error("Não consegui ler nenhuma conversa desse cliente nesse período.");
    }

    const qualifiedLeads = leads.filter((l) => QUALIFIED_STATUSES.has(l.status)).length;
    const convertedLeads = leads.filter((l) => !!l.sale_id).length;
    const replyTimes = ok.map((r) => r.firstReplySeconds).filter((s): s is number => s !== null);
    const avgFirstReplyMinutes = replyTimes.length > 0 ? replyTimes.reduce((a, b) => a + b, 0) / replyTimes.length / 60 : null;

    const stats = {
      totalLeads: leads.length,
      qualifiedLeads,
      qualificationRate: leads.length > 0 ? qualifiedLeads / leads.length : 0,
      convertedLeads,
      conversionRate: leads.length > 0 ? convertedLeads / leads.length : 0,
      avgFirstReplyMinutes,
      leadsAnalyzed: ok.length,
      leadsSkipped: leads.length - ok.length,
    };

    const transcriptsBlock = ok
      .map(({ lead, transcript }, i) => {
        const name = lead.contact_name || lead.remote_jid;
        const status = QUALIFIED_STATUSES.has(lead.status) ? "qualificado" : "aguardando";
        const sale = lead.sale_id ? ` — VENDEU${lead.sale_value ? ` (R$ ${lead.sale_value})` : ""}` : "";
        return `### Conversa ${i + 1} — ${name} (status: ${status}${sale}, origem: ${lead.ad_name || lead.campaign_name || "—"})\n${transcript}`;
      })
      .join("\n\n");

    const openai = new OpenAI({ apiKey: openaiKey });
    const userMessage = [
      `Cliente: ${client.name}`,
      `Período analisado: ${data.period}`,
      `Total de leads no período: ${stats.totalLeads} | Qualificados: ${stats.qualifiedLeads} (taxa de qualificação ${(stats.qualificationRate * 100).toFixed(1)}%) | Converteram (venda registrada): ${stats.convertedLeads} | Taxa de conversão: ${(stats.conversionRate * 100).toFixed(1)}%`,
      stats.avgFirstReplyMinutes !== null ? `Tempo médio até a primeira resposta do vendedor: ${stats.avgFirstReplyMinutes.toFixed(1)} minutos` : "",
      "",
      "Conversas (texto; mídia aparece como rótulo entre colchetes):",
      transcriptsBlock,
      "",
      "As instruções do prompt do sistema acima mandam no CONTEÚDO: o que avaliar, quão a fundo ir, tom, critérios, " +
        "quantidade de recomendações e de exemplos. Siga elas à risca — não resuma nem encurte pra caber em poucas " +
        "frases se o prompt pedir uma análise extensa. O JSON abaixo é só o FORMATO técnico de saída, não um limite " +
        "de tamanho:",
      `{"summary": "análise geral — pode ter vários parágrafos se o prompt pedir profundidade", "recommendations": ["recomendação acionável 1", "..."], "examples": [{"leadName": "nome do lead", "issue": "o que deu errado nessa conversa", "excerpt": "trecho literal da conversa que ilustra o problema", "suggestion": "o que o vendedor podia ter feito diferente"}]}`,
      "Sem instrução específica no prompt do sistema sobre quantidade, use de 3 a 6 exemplos, priorizando os casos " +
        "mais reveladores (leads que esfriaram, demoraram resposta, ou tiveram objeção mal tratada).",
      "Responda só com o JSON, sem markdown ao redor.",
    ]
      .filter(Boolean)
      .join("\n");

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      max_tokens: 8000,
      messages: [
        { role: "system", content: analysisPrompt },
        { role: "user", content: userMessage },
      ],
    });

    const raw = response.choices[0]?.message?.content;
    if (!raw) throw new Error("Sem resposta da IA.");

    let parsed: { summary?: string; recommendations?: string[]; examples?: SalesAnalysisExample[] };
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { summary: raw, recommendations: [], examples: [] };
    }

    return {
      clientName: client.name,
      generatedAt: new Date().toISOString(),
      stats,
      summary: parsed.summary || "Não foi possível gerar o resumo.",
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
      examples: Array.isArray(parsed.examples) ? parsed.examples : [],
    };
  });

export async function generateSalesAnalysis(clientId: string, period: z.infer<typeof periodSchema>): Promise<SalesAnalysisResult> {
  return _generateSalesAnalysis({ data: { clientId, period } });
}
