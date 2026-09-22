import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { instagramConnections, instagramFunnelLeads, instagramFunnelRules } from "@/db/schema";
import { requireOrgContext } from "@/server/session";

// Ferramenta interna, só pra conta da Triad Company (não é multi-tenant) —
// toda função aqui exige platform admin, escopada pela organização do
// próprio gestor logado. Ver spec
// docs/superpowers/specs/2026-09-21-funil-instagram-design.md.

async function requirePlatformAdminOrg(): Promise<{ organizationId: string }> {
  const { organizationId, isPlatformAdmin } = await requireOrgContext();
  if (!isPlatformAdmin) throw new Error("Acesso restrito ao platform admin.");
  return { organizationId };
}

// Contas conectadas via "Instagram Login" (sem Página do Facebook, nosso
// caso) usam o host graph.instagram.com, não graph.facebook.com — e esses
// endpoints são efetivamente sem versão (sem prefixo /vXX.X/ no caminho).
const BASE_URL = "https://graph.instagram.com";

// ── Conexão ──────────────────────────────────────────────────────────────

export interface InstagramConnectionRow {
  id: string;
  instagram_business_account_id: string;
  expires_at: string | null;
  active: boolean;
  created_at: string;
}

const _fetchInstagramConnection = createServerFn({ method: "GET" }).handler(async (): Promise<InstagramConnectionRow | null> => {
  const { organizationId } = await requirePlatformAdminOrg();
  const row = await db.query.instagramConnections.findFirst({
    where: eq(instagramConnections.organizationId, organizationId),
  });
  if (!row) return null;
  return {
    id: row.id,
    instagram_business_account_id: row.instagramBusinessAccountId,
    expires_at: row.expiresAt,
    active: row.active,
    created_at: row.createdAt,
  };
});

export async function fetchInstagramConnection(): Promise<InstagramConnectionRow | null> {
  return _fetchInstagramConnection();
}

const upsertConnectionSchema = z.object({
  instagram_business_account_id: z.string().min(1),
  access_token: z.string().min(1),
  expires_at: z.string().nullable().optional(),
});

const _upsertInstagramConnection = createServerFn({ method: "POST" })
  .inputValidator(upsertConnectionSchema)
  .handler(async ({ data }) => {
    const { organizationId } = await requirePlatformAdminOrg();
    const existing = await db.query.instagramConnections.findFirst({
      where: eq(instagramConnections.organizationId, organizationId),
    });
    const values = {
      instagramBusinessAccountId: data.instagram_business_account_id.trim(),
      accessToken: data.access_token.trim(),
      expiresAt: data.expires_at ?? null,
      active: true,
    };
    if (existing) {
      await db.update(instagramConnections).set(values).where(eq(instagramConnections.id, existing.id));
    } else {
      await db.insert(instagramConnections).values({ organizationId, ...values });
    }
  });

export async function upsertInstagramConnection(payload: {
  instagram_business_account_id: string;
  access_token: string;
  expires_at?: string | null;
}): Promise<void> {
  await _upsertInstagramConnection({ data: payload });
}

// ── Posts recentes (pra escolher na hora de criar uma regra) ─────────────

export interface InstagramPostRow {
  id: string;
  caption: string | null;
  thumbnail_url: string | null;
  permalink: string | null;
}

const _fetchRecentInstagramPosts = createServerFn({ method: "GET" }).handler(async (): Promise<InstagramPostRow[]> => {
  const { organizationId } = await requirePlatformAdminOrg();
  const connection = await db.query.instagramConnections.findFirst({
    where: and(eq(instagramConnections.organizationId, organizationId), eq(instagramConnections.active, true)),
  });
  if (!connection) throw new Error("Conecte o Instagram antes de criar uma regra.");

  const params = new URLSearchParams({
    fields: "id,caption,media_type,media_url,thumbnail_url,permalink",
    limit: "25",
    access_token: connection.accessToken,
  });
  const res = await fetch(`${BASE_URL}/${connection.instagramBusinessAccountId}/media?${params}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Erro ao buscar posts do Instagram (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    data?: Array<{ id: string; caption?: string; media_type?: string; media_url?: string; thumbnail_url?: string; permalink?: string }>;
  };
  return (json.data ?? []).map((p) => ({
    id: p.id,
    caption: p.caption ?? null,
    // Vídeo/reel só expõe imagem de capa em thumbnail_url; foto expõe media_url direto.
    thumbnail_url: (p.media_type === "VIDEO" || p.media_type === "REELS" ? p.thumbnail_url : p.media_url) ?? null,
    permalink: p.permalink ?? null,
  }));
});

export async function fetchRecentInstagramPosts(): Promise<InstagramPostRow[]> {
  return _fetchRecentInstagramPosts();
}

// ── Regras ───────────────────────────────────────────────────────────────

export interface FunnelRuleRow {
  id: string;
  post_id: string;
  post_thumbnail_url: string | null;
  post_permalink: string | null;
  keyword: string;
  message: string;
  public_reply: string | null;
  active: boolean;
  created_at: string;
}

const _fetchFunnelRules = createServerFn({ method: "GET" }).handler(async (): Promise<FunnelRuleRow[]> => {
  const { organizationId } = await requirePlatformAdminOrg();
  const rows = await db
    .select()
    .from(instagramFunnelRules)
    .where(eq(instagramFunnelRules.organizationId, organizationId))
    .orderBy(desc(instagramFunnelRules.createdAt));
  return rows.map((r) => ({
    id: r.id,
    post_id: r.postId,
    post_thumbnail_url: r.postThumbnailUrl,
    post_permalink: r.postPermalink,
    keyword: r.keyword,
    message: r.message,
    public_reply: r.publicReply,
    active: r.active,
    created_at: r.createdAt,
  }));
});

export async function fetchFunnelRules(): Promise<FunnelRuleRow[]> {
  return _fetchFunnelRules();
}

const createRuleSchema = z.object({
  post_id: z.string().min(1),
  post_thumbnail_url: z.string().nullable().optional(),
  post_permalink: z.string().nullable().optional(),
  keyword: z.string().min(1),
  message: z.string().min(1),
  public_reply: z.string().nullable().optional(),
});

const _createFunnelRule = createServerFn({ method: "POST" })
  .inputValidator(createRuleSchema)
  .handler(async ({ data }) => {
    const { organizationId } = await requirePlatformAdminOrg();
    await db.insert(instagramFunnelRules).values({
      organizationId,
      postId: data.post_id,
      postThumbnailUrl: data.post_thumbnail_url ?? null,
      postPermalink: data.post_permalink ?? null,
      keyword: data.keyword.trim(),
      message: data.message,
      publicReply: data.public_reply?.trim() || null,
    });
  });

export async function createFunnelRule(payload: {
  post_id: string;
  post_thumbnail_url?: string | null;
  post_permalink?: string | null;
  keyword: string;
  message: string;
  public_reply?: string | null;
}): Promise<void> {
  await _createFunnelRule({ data: payload });
}

const updateRuleSchema = z.object({
  id: z.string(),
  keyword: z.string().min(1),
  message: z.string().min(1),
  public_reply: z.string().nullable().optional(),
});

const _updateFunnelRule = createServerFn({ method: "POST" })
  .inputValidator(updateRuleSchema)
  .handler(async ({ data }) => {
    const { organizationId } = await requirePlatformAdminOrg();
    await db
      .update(instagramFunnelRules)
      .set({
        keyword: data.keyword.trim(),
        message: data.message,
        publicReply: data.public_reply?.trim() || null,
      })
      .where(and(eq(instagramFunnelRules.id, data.id), eq(instagramFunnelRules.organizationId, organizationId)));
  });

export async function updateFunnelRule(payload: {
  id: string;
  keyword: string;
  message: string;
  public_reply?: string | null;
}): Promise<void> {
  await _updateFunnelRule({ data: payload });
}

const _toggleFunnelRule = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string(), active: z.boolean() }))
  .handler(async ({ data }) => {
    const { organizationId } = await requirePlatformAdminOrg();
    await db
      .update(instagramFunnelRules)
      .set({ active: data.active })
      .where(and(eq(instagramFunnelRules.id, data.id), eq(instagramFunnelRules.organizationId, organizationId)));
  });

export async function toggleFunnelRule(id: string, active: boolean): Promise<void> {
  await _toggleFunnelRule({ data: { id, active } });
}

const _deleteFunnelRule = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const { organizationId } = await requirePlatformAdminOrg();
    await db
      .delete(instagramFunnelRules)
      .where(and(eq(instagramFunnelRules.id, data.id), eq(instagramFunnelRules.organizationId, organizationId)));
  });

export async function deleteFunnelRule(id: string): Promise<void> {
  await _deleteFunnelRule({ data: { id } });
}

// ── Leads capturados ───────────────────────────────────────────────────────

export interface FunnelLeadRow {
  id: string;
  rule_keyword: string;
  post_permalink: string | null;
  ig_username: string | null;
  ig_user_id: string;
  comment_text: string;
  status: "sent" | "failed";
  error_message: string | null;
  created_at: string;
}

const _fetchFunnelLeads = createServerFn({ method: "GET" }).handler(async (): Promise<FunnelLeadRow[]> => {
  const { organizationId } = await requirePlatformAdminOrg();
  const rows = await db
    .select({
      id: instagramFunnelLeads.id,
      ruleKeyword: instagramFunnelRules.keyword,
      postPermalink: instagramFunnelRules.postPermalink,
      igUsername: instagramFunnelLeads.igUsername,
      igUserId: instagramFunnelLeads.igUserId,
      commentText: instagramFunnelLeads.commentText,
      status: instagramFunnelLeads.status,
      errorMessage: instagramFunnelLeads.errorMessage,
      createdAt: instagramFunnelLeads.createdAt,
    })
    .from(instagramFunnelLeads)
    .innerJoin(instagramFunnelRules, eq(instagramFunnelRules.id, instagramFunnelLeads.ruleId))
    .where(eq(instagramFunnelRules.organizationId, organizationId))
    .orderBy(desc(instagramFunnelLeads.createdAt))
    .limit(200);
  return rows.map((r) => ({
    id: r.id,
    rule_keyword: r.ruleKeyword,
    post_permalink: r.postPermalink,
    ig_username: r.igUsername,
    ig_user_id: r.igUserId,
    comment_text: r.commentText,
    status: r.status as "sent" | "failed",
    error_message: r.errorMessage,
    created_at: r.createdAt,
  }));
});

export async function fetchFunnelLeads(): Promise<FunnelLeadRow[]> {
  return _fetchFunnelLeads();
}
