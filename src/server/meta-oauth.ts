import { createServerFn } from "@tanstack/react-start";
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { metaTokens } from "@/db/schema";
import { requireOrgContext } from "@/server/session";

// Login com Facebook pro gestor conectar a própria conta Meta sem precisar
// colar token na mão — complementa (não substitui) o fluxo manual em
// Configurações, que continua existindo pra quem preferir ou pra contas que
// a Meta ainda não liberou via OAuth (app em Standard Access / App Review).
//
// Cada gestor fica dono de UM token (meta_tokens.assigned_user_id = seu
// próprio id) — reconectar atualiza esse mesmo registro, nunca cria duplicata.

const GRAPH_VERSION = "v21.0";
const STATE_COOKIE = "meta_oauth_state";
const SCOPES = ["ads_management", "ads_read", "business_management", "pages_show_list", "pages_read_engagement"];

const STATE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 600, // 10 min — tempo de sobra pra completar o login na Meta
};

function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:8080").replace(/\/+$/, "");
}

function redirectUri(): string {
  return `${appUrl()}/auth/callback`;
}

const _startMetaOAuth = createServerFn({ method: "GET" }).handler(async (): Promise<{ url: string }> => {
  await requireOrgContext(); // só gestor logado inicia — sem checagem de role, é auto-serviço
  const appId = process.env.VITE_META_APP_ID;
  if (!appId) throw new Error("VITE_META_APP_ID não configurado no servidor.");

  const state = randomBytes(24).toString("hex");
  setCookie(STATE_COOKIE, state, STATE_COOKIE_OPTIONS);

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri(),
    state,
    scope: SCOPES.join(","),
    response_type: "code",
  });
  return { url: `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params}` };
});

export async function startMetaOAuth(): Promise<{ url: string }> {
  return _startMetaOAuth();
}

const completeSchema = z.object({ code: z.string().min(1), state: z.string().min(1) });

const _completeMetaOAuth = createServerFn({ method: "POST" })
  .inputValidator(completeSchema)
  .handler(async ({ data }): Promise<{ name: string }> => {
    const { organizationId, userId } = await requireOrgContext();

    const cookieState = getCookie(STATE_COOKIE);
    deleteCookie(STATE_COOKIE, { path: "/" });
    if (!cookieState || cookieState !== data.state) {
      throw new Error("Sessão de login com a Meta expirou ou é inválida — tente conectar de novo.");
    }

    const appId = process.env.VITE_META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) throw new Error("App da Meta não configurado no servidor.");

    const shortRes = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?${new URLSearchParams({
        client_id: appId,
        redirect_uri: redirectUri(),
        client_secret: appSecret,
        code: data.code,
      })}`
    );
    const shortJson = (await shortRes.json()) as { access_token?: string; error?: { message: string } };
    if (shortJson.error || !shortJson.access_token) {
      throw new Error(shortJson.error?.message ?? "Falha ao trocar o código pelo token de acesso.");
    }

    const longRes = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?${new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortJson.access_token,
      })}`
    );
    const longJson = (await longRes.json()) as { access_token?: string; expires_in?: number; error?: { message: string } };
    if (longJson.error || !longJson.access_token) {
      throw new Error(longJson.error?.message ?? "Falha ao gerar o token de longa duração.");
    }

    const meRes = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/me?fields=name&access_token=${encodeURIComponent(longJson.access_token)}`
    );
    const meJson = (await meRes.json()) as { name?: string };
    const name = meJson.name ?? "Conta Meta";

    const expiresAt = longJson.expires_in ? new Date(Date.now() + longJson.expires_in * 1000).toISOString() : null;
    const label = `${name} (Facebook)`;

    const existing = await db.query.metaTokens.findFirst({
      where: and(eq(metaTokens.organizationId, organizationId), eq(metaTokens.assignedUserId, userId)),
    });
    if (existing) {
      await db
        .update(metaTokens)
        .set({ label, accessToken: longJson.access_token, expiresAt, active: true })
        .where(eq(metaTokens.id, existing.id));
    } else {
      await db.insert(metaTokens).values({
        organizationId,
        label,
        accessToken: longJson.access_token,
        expiresAt,
        assignedUserId: userId,
        active: true,
      });
    }

    return { name };
  });

export async function completeMetaOAuth(code: string, state: string): Promise<{ name: string }> {
  return _completeMetaOAuth({ data: { code, state } });
}
