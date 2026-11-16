// Identidade visual do cliente (logo + cores). Usada nas artes geradas pelo
// Agente Triad e nos relatórios. Guardada em app_config por cliente
// ("client_brand:<id>"), sem tabela nova: { logo: "data:image/png;base64,...", colors: ["#rrggbb", ...] }.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { and, eq, like } from "drizzle-orm";
import { db } from "@/db/client";
import { appConfig, clients } from "@/db/schema";
import { requireOrgContext } from "@/server/session";
import { canAccessClient } from "@/lib/client-access";

export interface ClientBrand {
  logo: string | null;
  colors: string[];
}

const KEY_PREFIX = "client_brand:";
const MAX_LOGO_CHARS = 900_000; // ~650 KB em base64

function parseBrand(raw: string | null | undefined): ClientBrand {
  if (!raw) return { logo: null, colors: [] };
  try {
    const j = JSON.parse(raw) as Partial<ClientBrand>;
    return { logo: typeof j.logo === "string" ? j.logo : null, colors: Array.isArray(j.colors) ? j.colors.filter((c) => typeof c === "string") : [] };
  } catch {
    return { logo: null, colors: [] };
  }
}

async function assertClient(clientId: string) {
  const ctx = await requireOrgContext();
  const client = await db.query.clients.findFirst({
    where: eq(clients.id, clientId),
    columns: { organizationId: true, ownerUserId: true },
  });
  if (!client || !canAccessClient(ctx, client)) throw new Error("Cliente não encontrado.");
  return ctx.organizationId;
}

const _fetchClientBrand = createServerFn({ method: "GET" })
  .inputValidator(z.object({ clientId: z.string() }))
  .handler(async ({ data }): Promise<ClientBrand> => {
    const organizationId = await assertClient(data.clientId);
    const rows = await db
      .select({ value: appConfig.value })
      .from(appConfig)
      .where(and(eq(appConfig.organizationId, organizationId), eq(appConfig.key, KEY_PREFIX + data.clientId)))
      .limit(1);
    return parseBrand(rows[0]?.value);
  });

export async function fetchClientBrand(clientId: string): Promise<ClientBrand> {
  return _fetchClientBrand({ data: { clientId } });
}

// Todas as marcas da organização de uma vez (o Agente Triad usa pra levar as logos ao painel local).
const _fetchAllClientBrands = createServerFn({ method: "GET" }).handler(async (): Promise<Record<string, ClientBrand>> => {
  const { organizationId } = await requireOrgContext();
  const rows = await db
    .select({ key: appConfig.key, value: appConfig.value })
    .from(appConfig)
    .where(and(eq(appConfig.organizationId, organizationId), like(appConfig.key, `${KEY_PREFIX}%`)));
  const out: Record<string, ClientBrand> = {};
  for (const r of rows) {
    const brand = parseBrand(r.value);
    if (brand.logo) out[r.key.slice(KEY_PREFIX.length)] = brand;
  }
  return out;
});

export async function fetchAllClientBrands(): Promise<Record<string, ClientBrand>> {
  return _fetchAllClientBrands();
}

const _saveClientBrand = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      clientId: z.string(),
      logo: z.string().max(MAX_LOGO_CHARS).nullable(),
      colors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(5),
    })
  )
  .handler(async ({ data }): Promise<void> => {
    const organizationId = await assertClient(data.clientId);
    if (data.logo && !/^data:image\/(png|jpeg|webp);base64,/.test(data.logo)) throw new Error("A logo precisa ser PNG, JPG ou WebP.");
    const value = JSON.stringify({ logo: data.logo, colors: data.colors });
    await db
      .insert(appConfig)
      .values({ organizationId, key: KEY_PREFIX + data.clientId, value })
      .onConflictDoUpdate({ target: [appConfig.organizationId, appConfig.key], set: { value } });
  });

export async function saveClientBrand(clientId: string, logo: string | null, colors: string[]): Promise<void> {
  await _saveClientBrand({ data: { clientId, logo, colors } });
}
