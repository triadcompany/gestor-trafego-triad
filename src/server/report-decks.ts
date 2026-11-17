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
  // posição (px, a partir do centro) e tamanho (altura em px) no slide
  x: z.number().optional(),
  y: z.number().optional(),
  height: z.number().optional(),
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
  x?: number;
  y?: number;
  height?: number;
}

// Página livre criada pelo gestor (título + texto).
export interface ReportDeckCustomPage {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
}

// Caixa de texto solta num slide (posição em px a partir do canto superior esquerdo).
export interface ReportDeckTextBox {
  id: string;
  slide: string;
  text: string;
  x: number;
  y: number;
  w: number;
  size: number;
  bold: boolean;
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
  // ids dos slides ocultos (olho) e páginas livres — guardados junto da coluna
  // jsonb de criativos, numa entrada {kind:"layout"}, sem coluna nova.
  hidden_slides: string[];
  custom_pages: ReportDeckCustomPage[];
  text_boxes: ReportDeckTextBox[];
  // lista do slide "Plano de Ação do Tráfego" (guardada no layout, sem coluna nova)
  plano_trafego_items: string[];
  // últimos textos gerados automaticamente (se a lista ainda for igual a eles, o gestor não mexeu e pode ser recalculada)
  auto_lists: { diagnostico: string[]; plano: string[] };
  // deslocamento (px) dos textos fixos de cada slide arrastados pelo gestor
  offsets: Record<string, { x: number; y: number }>;
  funil_items: ReportDeckFunilItem[];
  plano_acao_items: string[];
  consideracoes_items: string[];
}

// Texto inicial dos slides de Diagnóstico e Plano de Ação do Tráfego. Os trechos
// entre [colchetes] o gestor preenche; o primeiro item do diagnóstico a tela
// preenche sozinha com o custo por conversa real do período.
export const DEFAULT_DIAGNOSTICO_FIRST = "Custo por conversa de R$ [valor], [dentro da/acima da] meta (R$ [mín] a [máx]).";
export const DEFAULT_DIAGNOSTICO = [
  DEFAULT_DIAGNOSTICO_FIRST,
  "Plataforma e posicionamento que mais trouxeram conversas: [preencher].",
  "Posicionamento ou público com custo acima da média: [preencher].",
];
export const DEFAULT_PLANO_TRAFEGO = [
  "Concentrar a verba nos posicionamentos e públicos com menor custo por conversa.",
  "Retirar o que gastou sem trazer conversas.",
  "Testar 2 criativos novos com o preço do carro na tela.",
  "Revisar os resultados em 15 dias.",
];

// Plano de ação que já vem preenchido (o gestor edita, remove ou acrescenta).
export const DEFAULT_PLANO_ACAO = [
  "Converter cerca de 3% dos leads",
  "Apontar a quantidade de vendas",
  "Revisar o funil de vendas",
  "Responder os leads em até 5 minutos",
  "Recontactar ao menos 3 vezes os contatos por dia por 5 dias.",
  "Ligar para o lead quando ele chegar no funil",
  "Abordagem de forma personalizada para cada resposta de veículo de interesse",
];

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
    diagnostico_items: [...DEFAULT_DIAGNOSTICO],
    creatives: [],
    hidden_slides: [],
    custom_pages: [],
    text_boxes: [],
    plano_trafego_items: [...DEFAULT_PLANO_TRAFEGO],
    auto_lists: { diagnostico: [], plano: [] },
    offsets: {},
    funil_items: [
      { label: "Contatos", value: "" },
      { label: "Qualificados", value: "" },
      { label: "Negociações", value: "" },
      { label: "Visitas", value: "" },
      { label: "Vendas", value: "" },
    ],
    plano_acao_items: [...DEFAULT_PLANO_ACAO],
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
      diagnostico_items: row.diagnosticoItems.length > 0 ? row.diagnosticoItems : [...DEFAULT_DIAGNOSTICO],
      ...splitCreatives(row.creatives),
      funil_items: row.funilItems as ReportDeckFunilItem[],
      plano_acao_items: row.planoAcaoItems.length > 0 ? row.planoAcaoItems : [...DEFAULT_PLANO_ACAO],
      consideracoes_items: row.consideracoesItems,
    };
  });

export async function fetchReportDeck(clientId: string): Promise<ReportDeckRow> {
  return _fetchReportDeck({ data: { clientId } });
}

type LayoutEntry = {
  kind: "layout";
  hidden: string[];
  pages: ReportDeckCustomPage[];
  boxes?: ReportDeckTextBox[];
  offsets?: Record<string, { x: number; y: number }>;
  planoTrafego?: string[];
  autoLists?: { diagnostico: string[]; plano: string[] };
};

function splitCreatives(raw: unknown): Pick<ReportDeckRow, "creatives" | "hidden_slides" | "custom_pages" | "text_boxes" | "offsets" | "plano_trafego_items" | "auto_lists"> {
  const list = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
  const layout = list.find((e) => e.kind === "layout") as LayoutEntry | undefined;
  return {
    creatives: list.filter((e) => e.kind !== "layout") as unknown as ReportDeckCreative[],
    hidden_slides: layout?.hidden ?? [],
    custom_pages: layout?.pages ?? [],
    text_boxes: layout?.boxes ?? [],
    offsets: layout?.offsets ?? {},
    plano_trafego_items: layout?.planoTrafego && layout.planoTrafego.length > 0 ? layout.planoTrafego : [...DEFAULT_PLANO_TRAFEGO],
    auto_lists: layout?.autoLists ?? { diagnostico: [], plano: [] },
  };
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
  hiddenSlides: z.array(z.string()).optional(),
  customPages: z
    .array(z.object({ id: z.string(), eyebrow: z.string(), title: z.string(), body: z.string() }))
    .optional(),
  textBoxes: z
    .array(
      z.object({
        id: z.string(),
        slide: z.string(),
        text: z.string(),
        x: z.number(),
        y: z.number(),
        w: z.number(),
        size: z.number(),
        bold: z.boolean(),
      })
    )
    .optional(),
  offsets: z.record(z.string(), z.object({ x: z.number(), y: z.number() })).optional(),
  planoTrafegoItems: z.array(z.string()).optional(),
  autoLists: z.object({ diagnostico: z.array(z.string()), plano: z.array(z.string()) }).optional(),
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
      ...(data.creatives !== undefined
        ? {
            creatives: [
              ...data.creatives,
              { kind: "layout", hidden: data.hiddenSlides ?? [], pages: data.customPages ?? [], boxes: data.textBoxes ?? [], offsets: data.offsets ?? {}, planoTrafego: data.planoTrafegoItems ?? [], autoLists: data.autoLists ?? { diagnostico: [], plano: [] } },
            ],
          }
        : {}),
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

// Envia o PDF do relatório pro grupo operacional. Sai sempre pela instância do
// GESTOR (nunca a do cliente), igual às outras automações internas.
const _sendReportPdfToOperationalGroup = createServerFn({ method: "POST" })
  .inputValidator(z.object({ clientId: z.string(), pdfBase64: z.string().min(100), fileName: z.string(), caption: z.string() }))
  .handler(async ({ data }): Promise<void> => {
    const organizationId = await assertAccess(data.clientId);
    const { resolveGestorWhatsappInstance, resolveOperationalGroupId } = await import("@/lib/whatsapp-messages");
    const resolved = await resolveGestorWhatsappInstance();
    const { url, apiKey, instance } = resolved;
    const groupId = await resolveOperationalGroupId(resolved, organizationId);
    if (!groupId) {
      throw new Error("Grupo operacional não configurado pra essa instância. Configure em Configurações → Instâncias WhatsApp.");
    }
    const res = await fetch(`${url}/message/sendMedia/${instance}`, {
      method: "POST",
      headers: { apikey: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        number: groupId,
        mediatype: "document",
        mimetype: "application/pdf",
        fileName: data.fileName,
        caption: data.caption,
        media: data.pdfBase64,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Erro ao enviar o PDF: ${res.status} - ${body.slice(0, 200)}`);
    }
  });

export async function sendReportPdfToOperationalGroup(input: {
  clientId: string;
  pdfBase64: string;
  fileName: string;
  caption: string;
}): Promise<void> {
  await _sendReportPdfToOperationalGroup({ data: input });
}
