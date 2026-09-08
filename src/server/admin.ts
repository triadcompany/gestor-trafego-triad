import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { organizations, profiles, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { requirePlatformAdmin } from "./session";

export interface OrganizationRow {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  memberCount: number;
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
