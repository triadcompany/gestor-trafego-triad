import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { profiles, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { requireOrgContext, type OrgRole } from "./session";

export interface OrgMemberRow {
  id: string;
  email: string;
  fullName: string;
  role: OrgRole;
  active: boolean;
}

const _fetchOrgMembers = createServerFn({ method: "GET" }).handler(async (): Promise<OrgMemberRow[]> => {
  const { organizationId } = await requireOrgContext();
  const rows = await db
    .select({ id: users.id, email: users.email, fullName: profiles.fullName, role: profiles.role, active: users.active })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.id))
    .where(eq(profiles.organizationId, organizationId))
    .orderBy(profiles.fullName);
  return rows.map((r) => ({ ...r, role: r.role === "admin" ? "admin" : "member" }));
});

export async function fetchOrgMembers(): Promise<OrgMemberRow[]> {
  return _fetchOrgMembers();
}

const createOrgMemberSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1),
  role: z.enum(["admin", "member"]).default("member"),
});

const _createOrgMember = createServerFn({ method: "POST" })
  .inputValidator(createOrgMemberSchema)
  .handler(async ({ data }) => {
    const { organizationId } = await requireOrgContext("admin");
    const email = data.email.trim().toLowerCase();
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing[0]) throw new Error("Já existe uma conta com esse email.");
    const passwordHash = await hashPassword(data.password);
    const [user] = await db.insert(users).values({ email, passwordHash }).returning();
    await db.insert(profiles).values({ id: user.id, fullName: data.fullName, role: data.role, organizationId });
    return { id: user.id };
  });

export async function createOrgMember(data: z.infer<typeof createOrgMemberSchema>): Promise<{ id: string }> {
  return _createOrgMember({ data });
}

const _updateOrgMemberRole = createServerFn({ method: "POST" })
  .inputValidator(z.object({ userId: z.string(), role: z.enum(["admin", "member"]) }))
  .handler(async ({ data }) => {
    const { organizationId } = await requireOrgContext("admin");
    const member = await db.query.profiles.findFirst({ where: eq(profiles.id, data.userId) });
    if (!member || member.organizationId !== organizationId) throw new Error("Usuário não encontrado.");
    await db.update(profiles).set({ role: data.role }).where(eq(profiles.id, data.userId));
  });

export async function updateOrgMemberRole(userId: string, role: OrgRole): Promise<void> {
  await _updateOrgMemberRole({ data: { userId, role } });
}

const _setOrgMemberActive = createServerFn({ method: "POST" })
  .inputValidator(z.object({ userId: z.string(), active: z.boolean() }))
  .handler(async ({ data }) => {
    const { organizationId, userId: callerId } = await requireOrgContext("admin");
    if (data.userId === callerId) throw new Error("Você não pode desativar sua própria conta.");
    const member = await db.query.profiles.findFirst({ where: eq(profiles.id, data.userId) });
    if (!member || member.organizationId !== organizationId) throw new Error("Usuário não encontrado.");
    await db.update(users).set({ active: data.active }).where(eq(users.id, data.userId));
  });

export async function setOrgMemberActive(userId: string, active: boolean): Promise<void> {
  await _setOrgMemberActive({ data: { userId, active } });
}
