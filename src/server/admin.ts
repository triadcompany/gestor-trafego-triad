import { createServerFn } from "@tanstack/react-start";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { organizations, profiles, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { requirePlatformAdmin } from "./session";

// Organização dona do sistema — nunca pode ser excluída por essa tela, mesmo
// por um platform admin, pra não ter risco de apagar a própria empresa.
const PROTECTED_ORG_ID = "c8f7908d-df29-49a4-993b-10b2dbca8a67";

export interface OrganizationRow {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  memberCount: number;
  monthlyValue: number;
}

const _fetchOrganizations = createServerFn({ method: "GET" }).handler(async (): Promise<OrganizationRow[]> => {
  await requirePlatformAdmin();
  const orgs = await db.select().from(organizations).orderBy(organizations.createdAt);
  const members = await db.select({ organizationId: profiles.organizationId }).from(profiles);
  const counts = new Map<string, number>();
  for (const m of members) {
    if (!m.organizationId) continue;
    counts.set(m.organizationId, (counts.get(m.organizationId) ?? 0) + 1);
  }
  return orgs.map((o) => ({
    id: o.id,
    name: o.name,
    active: o.active,
    createdAt: o.createdAt,
    memberCount: counts.get(o.id) ?? 0,
    monthlyValue: o.monthlyValue,
  }));
});

export async function fetchOrganizations(): Promise<OrganizationRow[]> {
  return _fetchOrganizations();
}

const createOrganizationSchema = z.object({
  name: z.string().min(1),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8),
  adminFullName: z.string().min(1),
});

const _createOrganization = createServerFn({ method: "POST" })
  .inputValidator(createOrganizationSchema)
  .handler(async ({ data }) => {
    await requirePlatformAdmin();
    const email = data.adminEmail.trim().toLowerCase();
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing[0]) throw new Error("Já existe uma conta com esse email.");

    const [org] = await db.insert(organizations).values({ name: data.name }).returning();
    const passwordHash = await hashPassword(data.adminPassword);
    const [user] = await db.insert(users).values({ email, passwordHash }).returning();
    await db.insert(profiles).values({ id: user.id, fullName: data.adminFullName, role: "admin", organizationId: org.id });
    return { id: org.id };
  });

export async function createOrganization(data: z.infer<typeof createOrganizationSchema>): Promise<{ id: string }> {
  return _createOrganization({ data });
}

const _setOrganizationActive = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string(), active: z.boolean() }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin();
    await db.update(organizations).set({ active: data.active }).where(eq(organizations.id, data.id));
  });

export async function setOrganizationActive(id: string, active: boolean): Promise<void> {
  await _setOrganizationActive({ data: { id, active } });
}

const _setOrganizationMonthlyValue = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string(), monthlyValue: z.number().min(0) }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin();
    await db.update(organizations).set({ monthlyValue: data.monthlyValue }).where(eq(organizations.id, data.id));
  });

export async function setOrganizationMonthlyValue(id: string, monthlyValue: number): Promise<void> {
  await _setOrganizationMonthlyValue({ data: { id, monthlyValue } });
}

// Apaga a organização e tudo que pertence a ela (clientes, campanhas
// salvas, vendas, automações, instâncias de WhatsApp — via cascade nas FKs).
// `profiles.organization_id` não tem cascade (fica nulo de propósito só pro
// platform admin puro), então os usuários da organização têm que ser
// apagados primeiro — isso já cascata pra apagar o profile de cada um.
const _deleteOrganization = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin();
    if (data.id === PROTECTED_ORG_ID) throw new Error("Essa organização não pode ser excluída.");
    await db.transaction(async (tx) => {
      const orgUsers = await tx
        .select({ id: users.id })
        .from(users)
        .innerJoin(profiles, eq(profiles.id, users.id))
        .where(eq(profiles.organizationId, data.id));
      if (orgUsers.length > 0) {
        await tx.delete(users).where(inArray(users.id, orgUsers.map((u) => u.id)));
      }
      await tx.delete(organizations).where(eq(organizations.id, data.id));
    });
  });

export async function deleteOrganization(id: string): Promise<void> {
  await _deleteOrganization({ data: { id } });
}
