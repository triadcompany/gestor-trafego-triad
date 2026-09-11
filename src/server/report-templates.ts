import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { reportTemplates } from "@/db/schema";
import { requireOrgContext } from "@/server/session";

// Modelos de relatório de métricas: texto com placeholders {{variavel}},
// compartilhados na organização (qualquer gestor pode criar/editar).

export interface ReportTemplateRow {
  id: string;
  name: string;
  body: string;
  updated_at: string;
}

const _fetchReportTemplates = createServerFn({ method: "GET" }).handler(async (): Promise<ReportTemplateRow[]> => {
  const { organizationId } = await requireOrgContext();
  const rows = await db
    .select({ id: reportTemplates.id, name: reportTemplates.name, body: reportTemplates.body, updatedAt: reportTemplates.updatedAt })
    .from(reportTemplates)
    .where(eq(reportTemplates.organizationId, organizationId))
    .orderBy(reportTemplates.name);
  return rows.map((r) => ({ id: r.id, name: r.name, body: r.body, updated_at: r.updatedAt }));
});

export async function fetchReportTemplates(): Promise<ReportTemplateRow[]> {
  return _fetchReportTemplates();
}

const upsertSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(4000),
});

const _upsertReportTemplate = createServerFn({ method: "POST" })
  .inputValidator(upsertSchema)
  .handler(async ({ data }): Promise<{ id: string }> => {
    const { organizationId } = await requireOrgContext();

    if (data.id) {
      const existing = await db.query.reportTemplates.findFirst({
        where: eq(reportTemplates.id, data.id),
        columns: { organizationId: true },
      });
      if (!existing || existing.organizationId !== organizationId) throw new Error("Modelo não encontrado.");
      await db
        .update(reportTemplates)
        .set({ name: data.name, body: data.body, updatedAt: new Date().toISOString() })
        .where(eq(reportTemplates.id, data.id));
      return { id: data.id };
    }

    const [row] = await db
      .insert(reportTemplates)
      .values({ organizationId, name: data.name, body: data.body })
      .returning({ id: reportTemplates.id });
    return { id: row.id };
  });

export async function upsertReportTemplate(data: z.infer<typeof upsertSchema>): Promise<{ id: string }> {
  return _upsertReportTemplate({ data });
}

const _deleteReportTemplate = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const { organizationId } = await requireOrgContext();
    const existing = await db.query.reportTemplates.findFirst({
      where: eq(reportTemplates.id, data.id),
      columns: { organizationId: true },
    });
    if (!existing || existing.organizationId !== organizationId) throw new Error("Modelo não encontrado.");
    // Automações que usam esse modelo caem pro texto padrão (reportTemplateId
    // vira NULL via ON DELETE SET NULL) — não bloqueia a exclusão.
    await db.delete(reportTemplates).where(eq(reportTemplates.id, data.id));
  });

export async function deleteReportTemplate(id: string): Promise<void> {
  await _deleteReportTemplate({ data: { id } });
}
