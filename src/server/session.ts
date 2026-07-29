import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { profiles, users } from "@/db/schema";
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

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
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
    })
    .from(users)
    .innerJoin(profiles, eq(profiles.id, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

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

    const valid = await verifyPassword(data.password, user.passwordHash);
    if (!valid) throw new Error("Email ou senha incorretos.");

    const sessionUser = await loadSessionUser(user.id);
    if (!sessionUser) throw new Error("Email ou senha incorretos.");

    setCookie(SESSION_COOKIE, signSessionToken(user.id), COOKIE_OPTIONS);
    return sessionUser;
  });

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  deleteCookie(SESSION_COOKIE, { path: "/" });
});

export const getCurrentUser = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionUser | null> => {
    const userId = await getSessionUserId();
    if (!userId) return null;
    return loadSessionUser(userId);
  }
);

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1),
});

// Usada só via script administrativo (create-user.ts) — não há tela de cadastro no app.
export const createUser = createServerFn({ method: "POST" })
  .inputValidator(createUserSchema)
  .handler(async ({ data }) => {
    const email = data.email.trim().toLowerCase();
    const passwordHash = await hashPassword(data.password);
    const [user] = await db.insert(users).values({ email, passwordHash }).returning();
    await db.insert(profiles).values({ id: user.id, fullName: data.fullName });
    return { id: user.id, email: user.email };
  });
