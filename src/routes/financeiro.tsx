import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SaldosContent } from "@/components/SaldosContent";
import { PixContent } from "@/components/PixContent";

type Aba = "saldos" | "pix";

// Saldos Meta e Cobranças PIX moram aqui, em abas. Os endereços antigos
// (/saldos e /pix) continuam existindo e redirecionam pra cá.
export const Route = createFileRoute("/financeiro")({
  head: () => ({ meta: [{ title: "Financeiro — Gestor de Tráfego" }] }),
  ssr: false,
  validateSearch: (s: Record<string, unknown>): { aba?: Aba } => ({
    aba: s.aba === "pix" ? "pix" : s.aba === "saldos" ? "saldos" : undefined,
  }),
  component: FinanceiroPage,
});

function FinanceiroPage() {
  const { aba } = Route.useSearch();
  const navigate = useNavigate();
  const current: Aba = aba ?? "saldos";

  return (
    <AppShell>
      <div className="px-4 md:px-8 py-6 max-w-4xl mx-auto">
        <div className="mb-5">
          <h1 className="text-2xl font-semibold tracking-tight">Financeiro</h1>
          <p className="text-sm text-muted-foreground mt-1">O saldo das contas de anúncio na Meta e as cobranças PIX dos clientes.</p>
        </div>

        <Tabs value={current} onValueChange={(v) => navigate({ to: "/financeiro", search: { aba: v === "pix" ? "pix" : "saldos" }, replace: true })}>
          <TabsList className="mb-5">
            <TabsTrigger value="saldos">Saldos Meta</TabsTrigger>
            <TabsTrigger value="pix">Cobranças PIX</TabsTrigger>
          </TabsList>
          <TabsContent value="saldos" className="mt-0">
            <SaldosContent />
          </TabsContent>
          <TabsContent value="pix" className="mt-0">
            <PixContent />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
