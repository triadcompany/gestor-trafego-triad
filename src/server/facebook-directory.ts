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

// A Business Manager (WABA) só lista números formalmente cadastrados ali, e
// precisa da permissão whatsapp_business_management — mas na prática a
// maioria dos números "vinculados à página" nem passa por isso: são números
// de vendedores já usados direto nos conjuntos de anúncio dessa página
// (promoted_object.whatsapp_phone_number), sem permissão nenhuma extra. Por
// isso junta as duas fontes + o telefone de contato da própria Página.
async function fetchWhatsappNumbers(accountId: string, pageId: string, token: string): Promise<WhatsappNumberOption[]> {
  const seen = new Set<string>();
  const numbers: WhatsappNumberOption[] = [];
  const add = (raw: string | undefined, label: string) => {
    const digits = (raw ?? "").replace(/[^\d]/g, "");
    if (!digits || seen.has(digits)) return;
    seen.add(digits);
    numbers.push({ id: digits, number: digits, label });
  };

  try {
    const businessId = await resolveBusinessId(accountId, token);
    if (businessId) {
      const [owned, client] = (await Promise.all([
        fetch(`${BASE_URL}/${businessId}/owned_whatsapp_business_accounts?fields=id,name&access_token=${encodeURIComponent(token)}`).then((r) => r.json()),
        fetch(`${BASE_URL}/${businessId}/client_whatsapp_business_accounts?fields=id,name&access_token=${encodeURIComponent(token)}`).then((r) => r.json()),
      ])) as [{ data?: Array<{ id: string }> }, { data?: Array<{ id: string }> }];
      const wabas = dedupeById([...(owned.data ?? []), ...(client.data ?? [])]);
      const numbersPerWaba = await Promise.all(
        wabas.map((w) =>
          fetch(`${BASE_URL}/${w.id}/phone_numbers?fields=id,display_phone_number,verified_name&access_token=${encodeURIComponent(token)}`)
            .then((r) => r.json())
            .then((j: { data?: Array<{ display_phone_number?: string; verified_name?: string }> }) => j.data ?? [])
            .catch(() => [])
        )
      );
      for (const n of numbersPerWaba.flat()) {
        add(n.display_phone_number, `${n.verified_name || "WhatsApp"} · ${n.display_phone_number ?? ""}`);
      }
    }
  } catch {
    // sem whatsapp_business_management ou sem BM — segue só com as outras fontes
  }

  try {
    let url: string | null = `${BASE_URL}/${accountId}/adsets?fields=promoted_object&limit=200&access_token=${encodeURIComponent(token)}`;
    while (url) {
      const json: {
        data?: Array<{ promoted_object?: { page_id?: string; whatsapp_phone_number?: string } }>;
        paging?: { next?: string };
      } = await fetch(url).then((r) => r.json());
      for (const a of json.data ?? []) {
        if (a.promoted_object?.page_id === pageId && a.promoted_object.whatsapp_phone_number) {
          add(a.promoted_object.whatsapp_phone_number, `Usado em anúncios · +${a.promoted_object.whatsapp_phone_number}`);
        }
      }
      url = json.paging?.next ?? null;
    }
  } catch {
    // segue sem isso
  }

  try {
    const res = await fetch(`${BASE_URL}/${pageId}?fields=phone&access_token=${encodeURIComponent(token)}`);
    const json = (await res.json()) as { phone?: string };
    if (json.phone) add(json.phone, `Telefone da Página · ${json.phone}`);
  } catch {
    // segue sem isso
  }

  return numbers;
}

const _fetchWhatsappNumbersForPage = createServerFn({ method: "GET" })
  .inputValidator(z.object({ accountId: z.string(), pageId: z.string() }))
  .handler(async ({ data }): Promise<WhatsappNumberOption[]> => {
    await requireOrgContext();
    const token = await getMetaToken();
    if (!token) throw new Error("Token Meta não configurado.");
    return fetchWhatsappNumbers(data.accountId, data.pageId, token);
  });

export async function fetchWhatsappNumbersForPage(accountId: string, pageId: string): Promise<WhatsappNumberOption[]> {
  return _fetchWhatsappNumbersForPage({ data: { accountId, pageId } });
}

const _resolveCampaignAccountId = createServerFn({ method: "GET" })
  .inputValidator(z.object({ campaignId: z.string() }))
  .handler(async ({ data }): Promise<string | null> => {
    await requireOrgContext();
    const token = await getMetaToken();
    if (!token) throw new Error("Token Meta não configurado.");
    const res = await fetch(`${BASE_URL}/${data.campaignId}?fields=account_id&access_token=${encodeURIComponent(token)}`);
    const json = (await res.json()) as { account_id?: string };
    return json.account_id ? `act_${json.account_id}` : null;
  });

export async function resolveCampaignAccountId(campaignId: string): Promise<string | null> {
  return _resolveCampaignAccountId({ data: { campaignId } });
}
