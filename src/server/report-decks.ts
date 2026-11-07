import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clientReportDecks, clients } from "@/db/schema";
import { requireOrgContext } from "@/server/session";
import { canAccessClient } from "@/lib/client-access";

// Conteúdo manual do "relatório visual" (deck de 7 páginas) — 1 registro por
// cliente, reaproveitado e editado todo mês (ver comentário no schema). Os
// números automáticos da Meta (investido, impressões, leads, CPL) NÃO ficam
// aqui — são buscados ao vivo na tela, igual ao resto do sistema.

const funilItemSchema = z.object({ label: z.string(), value: z.string() });
const creativeSchema = z.object({
  base64: z.string(),
  mimetype: z.string(),
  filename: z.string(),
  caption: z.string().optional(),
});

export interface ReportDeckFunilItem {
  label: string;
  value: string;
}
export interface ReportDeckCreative {
  base64: string;
  mimetype: string;
  filename: string;
  caption?: string;
}

export interface ReportDeckRow {
  client_id: string;
  cover_logo_base64: string | null;
  cover_logo_mimetype: string | null;
  meta_custo_venda: string | null;
  meta_faturamento: string | null;
  meta_vendas: string | null;
  meta_roi: string | null;
  meta_seguidores: string | null;
  meta_valor_investido: string | null;
  meta_impressoes: string | null;
  meta_leads_count: string | null;
  meta_custo_por_lead: string | null;
  diagnostico_items: string[];
  creatives: ReportDeckCreative[];
  funil_items: ReportDeckFunilItem[];
  plano_acao_items: string[];
  consideracoes_items: string[];
}

function emptyDeck(clientId: string): ReportDeckRow {
  return {
    client_id: clientId,
    cover_logo_base64: null,
    cover_logo_mimetype: null,
    meta_custo_venda: null,
    meta_faturamento: null,
    meta_vendas: null,
    meta_roi: null,
    meta_seguidores: null,
    meta_valor_investido: null,
    meta_impressoes: null,
    meta_leads_count: null,
    meta_custo_por_lead: null,
    diagnostico_items: [],
    creatives: [],
    funil_items: [
      { label: "Contatos", value: "" },
      { label: "Qualificados", value: "" },
      { label: "Negociações", value: "" },
      { label: "Visitas", value: "" },
      { label: "Vendas", value: "" },
    ],
    plano_acao_items: [],
    consideracoes_items: [],
  };
}

async function assertAccess(clientId: string) {
  const { organizationId, role, userId } = await requireOrgContext();
  const client = await db.query.clients.findFirst({
    where: eq(clients.id, clientId),
    columns: { organizationId: true, ownerUserId: true },
  });
  if (!client || !canAccessClient({ organizationId, role, userId }, client)) throw new Error("Cliente não encontrado.");
  return organizationId;
}

const _fetchReportDeck = createServerFn({ method: "GET" })
  .inputValidator(z.object({ clientId: z.string() }))
  .handler(async ({ data }): Promise<ReportDeckRow> => {
    await assertAccess(data.clientId);
    const row = await db.query.clientReportDecks.findFirst({ where: eq(clientReportDecks.clientId, data.clientId) });
    if (!row) return emptyDeck(data.clientId);
    return {
      client_id: row.clientId,
      cover_logo_base64: row.coverLogoBase64,
      cover_logo_mimetype: row.coverLogoMimetype,
      meta_custo_venda: row.metaCustoVenda,
      meta_faturamento: row.metaFaturamento,
      meta_vendas: row.metaVendas,
      meta_roi: row.metaRoi,
      meta_seguidores: row.metaSeguidores,
      meta_valor_investido: row.metaValorInvestido,
      meta_impressoes: row.metaImpressoes,
      meta_leads_count: row.metaLeadsCount,
      meta_custo_por_lead: row.metaCustoPorLead,
      diagnostico_items: row.diagnosticoItems,
      creatives: row.creatives as ReportDeckCreative[],
      funil_items: row.funilItems as ReportDeckFunilItem[],
      plano_acao_items: row.planoAcaoItems,
      consideracoes_items: row.consideracoesItems,
    };
  });

export async function fetchReportDeck(clientId: string): Promise<ReportDeckRow> {
  return _fetchReportDeck({ data: { clientId } });
}

const upsertSchema = z.object({
  clientId: z.string(),
  coverLogoBase64: z.string().nullable().optional(),
  coverLogoMimetype: z.string().nullable().optional(),
  metaCustoVenda: z.string().nullable().optional(),
  metaFaturamento: z.string().nullable().optional(),
  metaVendas: z.string().nullable().optional(),
  metaRoi: z.string().nullable().optional(),
  metaSeguidores: z.string().nullable().optional(),
  metaValorInvestido: z.string().nullable().optional(),
  metaImpressoes: z.string().nullable().optional(),
  metaLeadsCount: z.string().nullable().optional(),
  metaCustoPorLead: z.string().nullable().optional(),
  diagnosticoItems: z.array(z.string()).optional(),
  creatives: z.array(creativeSchema).optional(),
  funilItems: z.array(funilItemSchema).optional(),
  planoAcaoItems: z.array(z.string()).optional(),
  consideracoesItems: z.array(z.string()).optional(),
});
export type UpsertReportDeckInput = z.input<typeof upsertSchema>;

const _upsertReportDeck = createServerFn({ method: "POST" })
  .inputValidator(upsertSchema)
  .handler(async ({ data }): Promise<void> => {
    const organizationId = await assertAccess(data.clientId);
    const existing = await db.query.clientReportDecks.findFirst({ where: eq(clientReportDecks.clientId, data.clientId) });

    const values = {
      ...(data.coverLogoBase64 !== undefined ? { coverLogoBase64: data.coverLogoBase64 } : {}),
      ...(data.coverLogoMimetype !== undefined ? { coverLogoMimetype: data.coverLogoMimetype } : {}),
      ...(data.metaCustoVenda !== undefined ? { metaCustoVenda: data.metaCustoVenda } : {}),
      ...(data.metaFaturamento !== undefined ? { metaFaturamento: data.metaFaturamento } : {}),
      ...(data.metaVendas !== undefined ? { metaVendas: data.metaVendas } : {}),
      ...(data.metaRoi !== undefined ? { metaRoi: data.metaRoi } : {}),
      ...(data.metaSeguidores !== undefined ? { metaSeguidores: data.metaSeguidores } : {}),
      ...(data.metaValorInvestido !== undefined ? { metaValorInvestido: data.metaValorInvestido } : {}),
      ...(data.metaImpressoes !== undefined ? { metaImpressoes: data.metaImpressoes } : {}),
      ...(data.metaLeadsCount !== undefined ? { metaLeadsCount: data.metaLeadsCount } : {}),
      ...(data.metaCustoPorLead !== undefined ? { metaCustoPorLead: data.metaCustoPorLead } : {}),
      ...(data.diagnosticoItems !== undefined ? { diagnosticoItems: data.diagnosticoItems } : {}),
      ...(data.creatives !== undefined ? { creatives: data.creatives } : {}),
      ...(data.funilItems !== undefined ? { funilItems: data.funilItems } : {}),
      ...(data.planoAcaoItems !== undefined ? { planoAcaoItems: data.planoAcaoItems } : {}),
      ...(data.consideracoesItems !== undefined ? { consideracoesItems: data.consideracoesItems } : {}),
      updatedAt: new Date().toISOString(),
    };

    if (existing) {
      await db.update(clientReportDecks).set(values).where(eq(clientReportDecks.id, existing.id));
    } else {
      await db.insert(clientReportDecks).values({ clientId: data.clientId, organizationId, ...values });
    }
  });

export async function upsertReportDeck(input: UpsertReportDeckInput): Promise<void> {
  await _upsertReportDeck({ data: input });
}
