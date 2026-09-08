import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { organizations, profiles, users } from "@/db/schema";
import { SESSION_COOKIE, hashPassword, signSessionToken, verifyPassword, verifySessionToken } from "@/lib/auth";

// Utilitário server-only puro (não é RPC) — usado dentro de outras server functions
// para descobrir o usuário logado sem duplicar a leitura/verificação do cookie.
// createServerOnlyFn evita que o import-protection do TanStack Start bloqueie este
// arquivo quando ele é importado por código que também roda no client (getCurrentUser/login/logout).
export const getSessionUserId = createServerOnlyFn(async (): Promise<string | null> => {
  const token = getCookie(SESSION_COOKIE);
  if (!token) return null;
  return verifySessionToken(token)?.userId ?? null;
});

// Cookie separado (só setado via ação explícita de platform admin) que representa
// "estou dando suporte dentro da organização X". Enquanto presente, requireOrgContext
// passa a resolver organizationId/role pra essa organização (como admin dela),
// mesmo o usuário real não pertencendo a ela.
export const ACTING_ORG_COOKIE = "acting_org";

export type OrgRole = "member" | "admin";

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: OrgRole;
  organizationId: string | null;
  organizationName: string | null;
  isPlatformAdmin: boolean;
  actingOrganizationId: string | null;
  actingOrganizationName: string | null;
}

export interface OrgContext {
  userId: string;
  organizationId: string;
  role: OrgRole;
  isPlatformAdmin: boolean;
}

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 30, // 30 dias
};

async function loadSessionUser(userId: string): Promise<SessionUser | null> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: profiles.fullName,
      role: profiles.role,
      organizationId: profiles.organizationId,
      organizationName: organizations.name,
      isPlatformAdmin: users.isPlatformAdmin,
      active: users.active,
    })
    .from(users)
    .innerJoin(profiles, eq(profiles.id, users.id))
    .leftJoin(organizations, eq(organizations.id, profiles.organizationId))
    .where(eq(users.id, userId))
    .limit(1);
  const row = rows[0];
  if (!row || !row.active) return null;

  let actingOrganizationId: string | null = null;
  let actingOrganizationName: string | null = null;
  if (row.isPlatformAdmin) {
    const actingId = getCookie(ACTING_ORG_COOKIE) ?? null;
    if (actingId) {
      const actingRows = await db
        .select({ id: organizations.id, name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, actingId))
        .limit(1);
      if (actingRows[0]) {
        actingOrganizationId = actingRows[0].id;
        actingOrganizationName = actingRows[0].name;
      }
    }
  }

  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    role: row.role === "admin" ? "admin" : "member",
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    isPlatformAdmin: row.isPlatformAdmin,
    actingOrganizationId,
    actingOrganizationName,
  };
}

// Resolve organização + papel efetivos pra escopar uma ação — usada dentro de toda
// server function que lê/escreve dado de organização. Nunca aceita organizationId
// vindo do cliente: sempre deriva do usuário logado (+ modo suporte, se aplicável).
export const requireOrgContext = createServerOnlyFn(async (minRole: OrgRole = "member"): Promise<OrgContext> => {
  const userId = await getSessionUserId();
  if (!userId) throw new Error("Não autenticado.");

  const user = await loadSessionUser(userId);
  if (!user) throw new Error("Usuário não encontrado.");

  const organizationId = user.actingOrganizationId ?? user.organizationId;
  if (!organizationId) throw new Error("Usuário sem organização associada.");
  const role: OrgRole = user.actingOrganizationId ? "admin" : user.role;

  if (minRole === "admin" && role !== "admin") {
    throw new Error("Ação restrita a administradores da organização.");
  }

  return { userId, organizationId, role, isPlatformAdmin: user.isPlatformAdmin };
});

// Usada nas rotas/telas exclusivas do platform admin (/admin/organizations).
export const requirePlatformAdmin = createServerOnlyFn(async (): Promise<{ userId: string }> => {
  const userId = await getSessionUserId();
  if (!userId) throw new Error("Não autenticado.");
  const rows = await db.select({ isPlatformAdmin: users.isPlatformAdmin }).from(users).where(eq(users.id, userId)).limit(1);
  if (!rows[0]?.isPlatformAdmin) throw new Error("Acesso restrito ao platform admin.");
  return { userId };
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const login = createServerFn({ method: "POST" })
  .inputValidator(loginSchema)
  .handler(async ({ data }): Promise<SessionUser> => {
    const email = data.email.trim().toLowerCase();
    const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = rows[0];
    if (!user) throw new Error("Email ou senha incorretos.");
    if (!user.active) throw new Error("Este acesso foi desativado. Fale com o administrador da sua organização.");

    const valid = await verifyPassword(data.password, user.passwordHash);
    if (!valid) throw new Error("Email ou senha incorretos.");

    const sessionUser = await loadSessionUser(user.id);
    if (!sessionUser) throw new Error("Email ou senha incorretos.");

    setCookie(SESSION_COOKIE, signSessionToken(user.id), COOKIE_OPTIONS);
    return sessionUser;
  });

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  deleteCookie(SESSION_COOKIE, { path: "/" });
  deleteCookie(ACTING_ORG_COOKIE, { path: "/" });
});

export const getCurrentUser = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionUser | null> => {
    const userId = await getSessionUserId();
    if (!userId) return null;
    return loadSessionUser(userId);
  }
);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export const changePassword = createServerFn({ method: "POST" })
  .inputValidator(changePasswordSchema)
  .handler(async ({ data }) => {
    const userId = await getSessionUserId();
    if (!userId) throw new Error("Não autenticado.");
    const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const user = rows[0];
    if (!user) throw new Error("Usuário não encontrado.");
    const valid = await verifyPassword(data.currentPassword, user.passwordHash);
    if (!valid) throw new Error("Senha atual incorreta.");
    const passwordHash = await hashPassword(data.newPassword);
    await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
  });

// Suporte: platform admin "entra" numa organização (age como admin dela até sair).
const enterOrgSchema = z.object({ organizationId: z.string().uuid() });

export const enterOrganization = createServerFn({ method: "POST" })
  .inputValidator(enterOrgSchema)
  .handler(async ({ data }) => {
    const userId = await getSessionUserId();
    if (!userId) throw new Error("Não autenticado.");
    const rows = await db.select({ isPlatformAdmin: users.isPlatformAdmin }).from(users).where(eq(users.id, userId)).limit(1);
    if (!rows[0]?.isPlatformAdmin) throw new Error("Acesso restrito ao platform admin.");
    setCookie(ACTING_ORG_COOKIE, data.organizationId, COOKIE_OPTIONS);
  });

export const exitOrganization = createServerFn({ method: "POST" }).handler(async () => {
  deleteCookie(ACTING_ORG_COOKIE, { path: "/" });
});

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1),
});

// Usada só via script administrativo (create-user.ts) — não há tela de cadastro no app.
// Não seta organizationId: uso restrito a criar o platform admin inicial (sem org).
export const createUser = createServerFn({ method: "POST" })
  .inputValidator(createUserSchema)
  .handler(async ({ data }) => {
    const email = data.email.trim().toLowerCase();
    const passwordHash = await hashPassword(data.password);
    const [user] = await db.insert(users).values({ email, passwordHash }).returning();
    await db.insert(profiles).values({ id: user.id, fullName: data.fullName });
    return { id: user.id, email: user.email };
  });
