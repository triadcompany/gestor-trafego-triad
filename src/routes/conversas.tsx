import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { ConversationThread } from "@/components/ConversationThread";
import { formatPhoneFromJid } from "@/components/LeadsDashboard";
import { MessagesSquare, Search } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { fetchAllClients } from "@/lib/queries";
import { fetchLeadAttributions, type LeadAttributionRow } from "@/server/lead-attribution";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/conversas")({
  head: () => ({
    meta: [{ title: "Conversas — Gestor de Tráfego" }],
  }),
  component: ConversasPage,
});

const STATUS_LABEL: Record<LeadAttributionRow["status"], string> = {
  pending: "Aguardando",
  qualified: "Qualificado",
  conversion_sent: "Qualificado",
  conversion_failed: "Qualificado",
};
const QUALIFIED_STATUSES = new Set<LeadAttributionRow["status"]>(["qualified", "conversion_sent", "conversion_failed"]);

function ConversasPage() {
  const [clientId, setClientId] = useState("");
  const [search, setSearch] = useState("");
  const [selectedJid, setSelectedJid] = useState<string | null>(null);

  const { data: clients = [], isLoading: loadingClients } = useQuery({ queryKey: ["all-clients"], queryFn: fetchAllClients });

  useEffect(() => {
    if (!clientId && clients.length > 0) setClientId(clients[0].id);
  }, [clients, clientId]);

  const { data: leads = [], isLoading: loadingLeads } = useQuery({
    queryKey: ["lead-attributions-conversas", clientId],
    queryFn: () => fetchLeadAttributions(clientId),
    enabled: !!clientId,
  });

  // Volta pra sem seleção sempre que troca de cliente — evita mostrar a
  // conversa do cliente anterior enquanto a lista nova ainda carrega.
  useEffect(() => {
    setSelectedJid(null);
    setSearch("");
  }, [clientId]);

  useEffect(() => {
    if (!selectedJid && leads.length > 0) setSelectedJid(leads[0].remote_jid);
  }, [leads, selectedJid]);

  const filteredLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter(
      (l) => (l.contact_name ?? "").toLowerCase().includes(q) || formatPhoneFromJid(l.remote_jid).toLowerCase().includes(q)
    );
  }, [leads, search]);

  const selectedLead = leads.find((l) => l.remote_jid === selectedJid);

  return (
    <AppShell>
      <div className="mx-auto flex h-[calc(100vh-2rem)] max-w-6xl flex-col px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <MessagesSquare className="h-5 w-5 text-muted-foreground" />
            Conversas
          </h1>
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

        {loadingClients ? (
          <p className="text-sm text-muted-foreground">Carregando clientes...</p>
        ) : clients.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum cliente cadastrado.</p>
        ) : (
          <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex w-72 shrink-0 flex-col border-r border-border">
              <div className="border-b border-border p-3">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar lead..."
                    className="h-8 pl-8 text-sm"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {loadingLeads ? (
                  <p className="p-4 text-center text-xs text-muted-foreground">Carregando...</p>
                ) : filteredLeads.length === 0 ? (
                  <p className="p-4 text-center text-xs text-muted-foreground">
                    {leads.length === 0 ? "Nenhum lead rastreado ainda." : "Nenhum lead encontrado."}
                  </p>
                ) : (
                  filteredLeads.map((lead) => {
                    const qualified = QUALIFIED_STATUSES.has(lead.status);
                    return (
                      <button
                        key={lead.id}
                        onClick={() => setSelectedJid(lead.remote_jid)}
                        className={cn(
                          "flex w-full flex-col gap-0.5 border-b border-border px-3 py-2.5 text-left transition-colors",
                          lead.remote_jid === selectedJid ? "bg-muted" : "hover:bg-muted/50"
                        )}
                      >
                        <span className="truncate text-sm font-medium">{lead.contact_name || formatPhoneFromJid(lead.remote_jid)}</span>
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", qualified ? "bg-status-on-target" : "bg-muted-foreground/40")} />
                          {STATUS_LABEL[lead.status]}
                          {lead.ad_name && <span className="truncate">· {lead.ad_name}</span>}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {selectedLead ? (
              <ConversationThread
                clientId={clientId}
                remoteJid={selectedLead.remote_jid}
                contactName={selectedLead.contact_name || formatPhoneFromJid(selectedLead.remote_jid)}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                {leads.length === 0 && !loadingLeads ? "Esse cliente ainda não tem leads rastreados." : "Selecione um lead pra ver a conversa."}
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
