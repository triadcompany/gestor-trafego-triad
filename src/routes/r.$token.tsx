import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Target } from "lucide-react";
import { LeadsDashboard } from "@/components/LeadsDashboard";
import { fetchPublicClientInfo } from "@/server/lead-attribution";

// Link público de rastreamento (sem login) — o próprio cliente (dono do
// negócio) usa pra ver os leads e marcar qualificado/venda. Nunca renderiza
// dentro do AppShell (sem menu, sem acesso ao resto do sistema); o token é
// toda a autenticação — ver resolvePublicClientId em lead-attribution.ts.
export const Route = createFileRoute("/r/$token")({
  head: () => ({
    meta: [{ title: "Rastreamento — Gestor de Tráfego" }],
  }),
  component: PublicTrackingPage,
});

function PublicTrackingPage() {
  const { token } = Route.useParams();
  const { data: info, isLoading, isError } = useQuery({
    queryKey: ["public-client-info", token],
    queryFn: () => fetchPublicClientInfo(token),
    retry: false,
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-2.5">
          <div className="h-8 w-8 shrink-0 rounded-md bg-gradient-to-br from-primary to-primary-2 shadow-brand flex items-center justify-center text-primary-foreground font-bold">
            <Target className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight truncate">{info?.client_name ?? "Rastreamento de leads"}</p>
            <p className="text-xs text-muted-foreground leading-tight">Rastreamento de leads</p>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : isError || !info ? (
          <div className="max-w-md mx-auto text-center py-16">
            <p className="text-base font-medium">Link inválido ou expirado</p>
            <p className="text-sm text-muted-foreground mt-1.5">
              Peça pra sua agência gerar um novo link de rastreamento.
            </p>
          </div>
        ) : (
          <LeadsDashboard token={token} />
        )}
      </div>
    </div>
  );
}
