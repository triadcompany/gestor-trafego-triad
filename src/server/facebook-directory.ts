// Busca de Páginas e números de WhatsApp na Business Manager de um cliente —
// usado tanto em "Importar do Facebook" (src/server/import-accounts.ts)
// quanto no seletor de número em Editar Campanha
// (src/routes/campaigns.edit.$id.tsx). Sempre escopado pela BM DONA do
// objeto (conta de anúncio OU página — o mesmo campo "business" existe nos
// dois, confirmado ao vivo), nunca lista tudo que o login enxerga.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOrgContext } from "@/server/session";
import { getMetaToken } from "@/lib/meta";

const BASE_URL = "https://graph.facebook.com/v21.0";

async function resolveBusinessId(objectId: string, token: string): Promise<string | null> {
  const res = await fetch(`${BASE_URL}/${objectId}?fields=business&access_token=${encodeURIComponent(token)}`);
  const json = (await res.json()) as { business?: { id: string } };
  return json.business?.id ?? null;
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
}

export interface FacebookPageOption {
  id: string;
  name: string;
}

const _searchFacebookPages = createServerFn({ method: "GET" })
  .inputValidator(z.object({ accountId: z.string(), query: z.string() }))
  .handler(async ({ data }): Promise<FacebookPageOption[]> => {
    await requireOrgContext();
    const token = await getMetaToken();
    if (!token) throw new Error("Token Meta não configurado.");
    const businessId = await resolveBusinessId(data.accountId, token);
    if (!businessId) return [];

    const [owned, client] = (await Promise.all([
      fetch(`${BASE_URL}/${businessId}/owned_pages?fields=id,name&limit=100&access_token=${encodeURIComponent(token)}`).then((r) => r.json()),
      fetch(`${BASE_URL}/${businessId}/client_pages?fields=id,name&limit=100&access_token=${encodeURIComponent(token)}`).then((r) => r.json()),
    ])) as [{ data?: FacebookPageOption[] }, { data?: FacebookPageOption[] }];

    const pages = dedupeById([...(owned.data ?? []), ...(client.data ?? [])]);
    const q = data.query.trim().toLowerCase();
    const filtered = q ? pages.filter((p) => p.name.toLowerCase().includes(q)) : pages;
    return filtered.slice(0, 20);
  });

export async function searchFacebookPages(accountId: string, query: string): Promise<FacebookPageOption[]> {
  return _searchFacebookPages({ data: { accountId, query } });
}

export interface WhatsappNumberOption {
  id: string;
  number: string; // dígitos, pronto pra salvar em clients.meta_whatsapp_number / promoted_object
  label: string; // "Nome verificado · +55 ..." pra mostrar no seletor
}

async function fetchWhatsappNumbersForBusiness(businessId: string, token: string): Promise<WhatsappNumberOption[]> {
  const [owned, client] = (await Promise.all([
    fetch(`${BASE_URL}/${businessId}/owned_whatsapp_business_accounts?fields=id,name&access_token=${encodeURIComponent(token)}`).then((r) => r.json()),
    fetch(`${BASE_URL}/${businessId}/client_whatsapp_business_accounts?fields=id,name&access_token=${encodeURIComponent(token)}`).then((r) => r.json()),
  ])) as [{ data?: Array<{ id: string }> }, { data?: Array<{ id: string }> }];

  const wabas = dedupeById([...(owned.data ?? []), ...(client.data ?? [])]);
  const numbersPerWaba = await Promise.all(
    wabas.map((w) =>
      fetch(`${BASE_URL}/${w.id}/phone_numbers?fields=id,display_phone_number,verified_name&access_token=${encodeURIComponent(token)}`)
        .then((r) => r.json())
        .then((j: { data?: Array<{ id: string; display_phone_number?: string; verified_name?: string }> }) => j.data ?? [])
        .catch(() => [])
    )
  );

  return numbersPerWaba.flat().map((n) => ({
    id: n.id,
    number: (n.display_phone_number ?? "").replace(/[^\d]/g, ""),
    label: `${n.verified_name || "WhatsApp"} · ${n.display_phone_number ?? ""}`,
  }));
}

const _fetchWhatsappNumbersForAccount = createServerFn({ method: "GET" })
  .inputValidator(z.object({ accountId: z.string() }))
  .handler(async ({ data }): Promise<WhatsappNumberOption[]> => {
    await requireOrgContext();
    const token = await getMetaToken();
    if (!token) throw new Error("Token Meta não configurado.");
    const businessId = await resolveBusinessId(data.accountId, token);
    if (!businessId) return [];
    return fetchWhatsappNumbersForBusiness(businessId, token);
  });

export async function fetchWhatsappNumbersForAccount(accountId: string): Promise<WhatsappNumberOption[]> {
  return _fetchWhatsappNumbersForAccount({ data: { accountId } });
}

const _fetchWhatsappNumbersForPage = createServerFn({ method: "GET" })
  .inputValidator(z.object({ pageId: z.string() }))
  .handler(async ({ data }): Promise<WhatsappNumberOption[]> => {
    await requireOrgContext();
    const token = await getMetaToken();
    if (!token) throw new Error("Token Meta não configurado.");
    const businessId = await resolveBusinessId(data.pageId, token);
    if (!businessId) return [];
    return fetchWhatsappNumbersForBusiness(businessId, token);
  });

export async function fetchWhatsappNumbersForPage(pageId: string): Promise<WhatsappNumberOption[]> {
  return _fetchWhatsappNumbersForPage({ data: { pageId } });
}
