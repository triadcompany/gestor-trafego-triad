import { eq, type SQL } from "drizzle-orm";
import { clients } from "@/db/schema";
import type { OrgContext } from "@/server/session";

// Funções PURAS (sem banco) — seguras de importar de qualquer lugar.
// Regra: membro só vê clientes de que é dono; admin (e platform admin agindo
// dentro da org) vê todos.

// Condição extra pra WHERE de queries que envolvem `clients`.
// undefined = sem restrição (admin). Retorno é combinável com `and(...)`.
export function clientAccessCondition(ctx: Pick<OrgContext, "role" | "userId">): SQL | undefined {
  return ctx.role === "admin" ? undefined : eq(clients.ownerUserId, ctx.userId);
}

// Checagem booleana a partir de uma linha já lida do banco.
export function canAccessClient(
  ctx: Pick<OrgContext, "role" | "userId" | "organizationId">,
  client: { organizationId: string; ownerUserId: string | null } | null | undefined
): boolean {
  if (!client || client.organizationId !== ctx.organizationId) return false;
  if (ctx.role === "admin") return true;
  return client.ownerUserId === ctx.userId;
}
