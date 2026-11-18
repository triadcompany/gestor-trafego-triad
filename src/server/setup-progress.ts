// Progresso dos "primeiros passos" do Dashboard: o que o gestor já configurou.
// Respeita o acesso por cliente (membro só enxerga os clientes dele; admin, todos).
import { createServerFn } from "@tanstack/react-start";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { clientEventKeywords, clients, metaTokens } from "@/db/schema";
import { clientAccessCondition } from "@/lib/client-access";
import { requireOrgContext } from "@/server/session";

export interface SetupProgress {
  /** Há pelo menos um acesso da Meta ativo na organização. */
  hasFacebook: boolean;
  clientCount: number;
  /** Clientes com um WhatsApp vinculado. */
  whatsappClientCount: number;
  /** Clientes com pixel informado ou alguma palavra-chave ativa. */
  conversionsClientCount: number;
  firstClientId: string | null;
  /** Primeiro cliente ainda sem conversões configuradas (cai no primeiro cliente se todos tiverem). */
  nextConversionsClientId: string | null;
}

const _fetchSetupProgress = createServerFn({ method: "GET" }).handler(async (): Promise<SetupProgress> => {
  const ctx = await requireOrgContext();

  const tokens = await db
    .select({ id: metaTokens.id })
    .from(metaTokens)
    .where(and(eq(metaTokens.organizationId, ctx.organizationId), eq(metaTokens.active, true)))
    .limit(1);

  const rows = await db
    .select({ id: clients.id, whatsappInstanceId: clients.whatsappInstanceId, metaCapiDatasetId: clients.metaCapiDatasetId })
    .from(clients)
    .where(and(eq(clients.organizationId, ctx.organizationId), eq(clients.active, true), clientAccessCondition(ctx)));

  let withKeywords = new Set<string>();
  if (rows.length > 0) {
    const kw = await db
      .selectDistinct({ clientId: clientEventKeywords.clientId })
      .from(clientEventKeywords)
      .where(and(inArray(clientEventKeywords.clientId, rows.map((r) => r.id)), eq(clientEventKeywords.active, true)));
    withKeywords = new Set(kw.map((k) => k.clientId));
  }

  const hasConversions = (r: (typeof rows)[number]) => !!r.metaCapiDatasetId || withKeywords.has(r.id);
  const firstWithout = rows.find((r) => !hasConversions(r));

  return {
    hasFacebook: tokens.length > 0,
    clientCount: rows.length,
    whatsappClientCount: rows.filter((r) => !!r.whatsappInstanceId).length,
    conversionsClientCount: rows.filter(hasConversions).length,
    firstClientId: rows[0]?.id ?? null,
    nextConversionsClientId: firstWithout?.id ?? rows[0]?.id ?? null,
  };
});

export async function fetchSetupProgress(): Promise<SetupProgress> {
  return _fetchSetupProgress();
}
