import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { LeadsDashboard } from "@/components/LeadsDashboard";
import { Target } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchAllClients } from "@/lib/queries";
import { PublicTrackingLinkControl } from "@/components/PublicTrackingLinkControl";

export const Route = createFileRoute("/rastreamento")({
  head: () => ({
    meta: [{ title: "Rastreamento — Gestor de Tráfego" }],
  }),
  component: RastreamentoPage,
});

function RastreamentoPage() {
  const [clientId, setClientId] = useState<string>("");
  const { data: clients = [], isLoading } = useQuery({ queryKey: ["all-clients"], queryFn: fetchAllClients });
  const selectedClient = clients.find((c) => c.id === clientId);

  useEffect(() => {
    if (!clientId && clients.length > 0) setClientId(clients[0].id);
  }, [clients, clientId]);

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Target className="h-5 w-5 text-muted-foreground" />
            Rastreamento de leads
          </h1>
          <div className="flex items-center gap-2 flex-wrap">
            {selectedClient && (
              <PublicTrackingLinkControl
                clientId={selectedClient.id}
                publicTrackingToken={selectedClient.public_tracking_token}
                invalidateQueryKey={["all-clients"]}
                compact
              />
            )}
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Selecionar cliente" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando clientes...</p>
        ) : clients.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum cliente cadastrado.</p>
        ) : clientId ? (
          <LeadsDashboard clientId={clientId} />
        ) : null}
      </div>
    </AppShell>
  );
}
