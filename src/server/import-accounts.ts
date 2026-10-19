// Importa clientes a partir das contas de anúncio que o token Meta do gestor
// já gerencia — poupa o cadastro manual (conta, Página, WhatsApp) pra quem
// já tem tudo configurado do lado da Meta. Ver tela em
// src/routes/clients.importar.tsx.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { requireOrgContext } from "@/server/session";
import { getMetaToken, mapWithConcurrency } from "@/lib/meta";

const BASE_URL = "https://graph.facebook.com/v21.0";

export interface ImportCandidate {
  accountId: string; // "act_123..."
  suggestedName: string;
  pageId: string | null;
  pageName: string | null;
  pageDetected: boolean;
  whatsappNumber: string | null;
  whatsappDetected: boolean;
}

async function fetchManagedAdAccounts(token: string): Promise<Array<{ id: string; name: string }>> {
  const all: Array<{ id: string; name: string }> = [];
  let url: string | null = `${BASE_URL}/me/adaccounts?fields=id,name&limit=200&access_token=${encodeURIComponent(token)}`;
  while (url) {
    const res = await fetch(url);
    const json = (await res.json()) as {
      data?: Array<{ id: string; name: string }>;
      paging?: { next?: string };
      error?: { message: string };
    };
    if (json.error) throw new Error(json.error.message);
    all.push(...(json.data ?? []));
    url = json.paging?.next ?? null;
  }
  return all;
}

// Página: /promote_pages já traz exatamente as Páginas que a conta usa pra
// anunciar. WhatsApp: primeiro tenta achar um número explícito num conjunto
// de anúncio já existente (promoted_object.whatsapp_phone_number) — a maioria
// das contas não tem isso preenchido porque usa o número padrão conectado na
// própria Página, então cai pro telefone da Página como segundo palpite.
async function detectAccountDefaults(
  adAccountId: string,
  token: string
): Promise<{ pageId: string | null; pageName: string | null; whatsappNumber: string | null }> {
  let pageId: string | null = null;
  let pageName: string | null = null;
  try {
    const res = await fetch(`${BASE_URL}/${adAccountId}/promote_pages?fields=id,name&limit=1&access_token=${encodeURIComponent(token)}`);
    const json = (await res.json()) as { data?: Array<{ id: string; name: string }> };
    const first = json.data?.[0];
    if (first) {
      pageId = first.id;
      pageName = first.name;
    }
  } catch {
    // conta sem página detectável — gestor preenche na mão
  }

  let whatsappNumber: string | null = null;
  try {
    const res = await fetch(`${BASE_URL}/${adAccountId}/adsets?fields=promoted_object&limit=10&access_token=${encodeURIComponent(token)}`);
    const json = (await res.json()) as { data?: Array<{ promoted_object?: { whatsapp_phone_number?: string } }> };
    for (const a of json.data ?? []) {
      if (a.promoted_object?.whatsapp_phone_number) {
        whatsappNumber = a.promoted_object.whatsapp_phone_number;
        break;
      }
    }
  } catch {
    // segue sem número de conjunto
  }

  if (!whatsappNumber && pageId) {
    try {
      const res = await fetch(`${BASE_URL}/${pageId}?fields=phone&access_token=${encodeURIComponent(token)}`);
      const json = (await res.json()) as { phone?: string };
      if (json.phone) whatsappNumber = json.phone.replace(/[^\d]/g, "");
    } catch {
      // segue sem telefone da página
    }
  }

  return { pageId, pageName, whatsappNumber };
}

export interface ImportCandidatesResult {
  candidates: ImportCandidate[];
  alreadyCount: number;
  totalManaged: number;
}

const _fetchImportCandidates = createServerFn({ method: "GET" }).handler(async (): Promise<ImportCandidatesResult> => {
  const { organizationId } = await requireOrgContext();
  const token = await getMetaToken();
  if (!token) throw new Error("Token Meta não configurado. Conecte sua conta em Configurações.");

  const [accounts, existing] = await Promise.all([
    fetchManagedAdAccounts(token),
    db.select({ metaAdAccountId: clients.metaAdAccountId }).from(clients).where(eq(clients.organizationId, organizationId)),
  ]);
  const existingIds = new Set(existing.map((c) => c.metaAdAccountId));
  const newAccounts = accounts.filter((a) => !existingIds.has(a.id));
  const alreadyCount = accounts.length - newAccounts.length;

  const settled = await mapWithConcurrency(newAccounts, 5, async (acc) => {
    const detected = await detectAccountDefaults(acc.id, token);
    const row: ImportCandidate = {
      accountId: acc.id,
      suggestedName: detected.pageName || acc.name,
      pageId: detected.pageId,
      pageName: detected.pageName,
      pageDetected: !!detected.pageId,
      whatsappNumber: detected.whatsappNumber,
      whatsappDetected: !!detected.whatsappNumber,
    };
    return row;
  });

  const candidates = settled.filter((r): r is PromiseFulfilledResult<ImportCandidate> => r.status === "fulfilled").map((r) => r.value);
  return { candidates, alreadyCount, totalManaged: accounts.length };
});

export async function fetchImportCandidates(): Promise<ImportCandidatesResult> {
  return _fetchImportCandidates();
}

const importItemSchema = z.object({
  accountId: z.string(),
  name: z.string().min(1),
  pageId: z.string().nullable(),
  whatsappNumber: z.string().nullable(),
});

export interface ImportResult {
  accountId: string;
  ok: boolean;
  error?: string;
}

const _importAccountsAsClients = createServerFn({ method: "POST" })
  .inputValidator(z.object({ items: z.array(importItemSchema).min(1) }))
  .handler(async ({ data }): Promise<ImportResult[]> => {
    const { organizationId, userId } = await requireOrgContext();
    const results: ImportResult[] = [];
    for (const item of data.items) {
      try {
        await db.insert(clients).values({
          organizationId,
          name: item.name.trim(),
          metaAdAccountId: item.accountId,
          metaPageId: item.pageId,
          metaWhatsappNumber: item.whatsappNumber,
          ownerUserId: userId,
        });
        results.push({ accountId: item.accountId, ok: true });
      } catch (e) {
        // unique(meta_ad_account_id) pode disparar numa corrida (duas abas
        // importando a mesma conta ao mesmo tempo) — segue com os outros
        // itens em vez de derrubar a importação inteira.
        results.push({ accountId: item.accountId, ok: false, error: e instanceof Error ? e.message : "Erro ao criar cliente." });
      }
    }
    return results;
  });

export async function importAccountsAsClients(
  items: Array<{ accountId: string; name: string; pageId: string | null; whatsappNumber: string | null }>
): Promise<ImportResult[]> {
  return _importAccountsAsClients({ data: { items } });
}
