import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeft, Search, Target, DollarSign, Check } from "lucide-react";
import { toast } from "sonner";
import { fetchClientDetail } from "@/lib/queries";
import { fetchLeadAttributions, fetchLeadAttributionSummary, markLeadQualified, convertLeadToSale, type LeadAttributionRow } from "@/server/lead-attribution";
import { brl } from "@/lib/mock-data";

export const Route = createFileRoute("/clients/$id/leads")({
  component: LeadsPage,
});

const STATUS_LABEL: Record<string, string> = {
  pending: "Aguardando",
  qualified: "Qualificado",
  conversion_sent: "Qualificado",
  conversion_failed: "Qualificado (falha ao enviar)",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  pending: "secondary",
  qualified: "default",
  conversion_sent: "default",
  conversion_failed: "destructive",
};

function LeadsPage() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [saleFor, setSaleFor] = useState<LeadAttributionRow | null>(null);

  const { data: client } = useQuery({ queryKey: ["client-detail", id], queryFn: () => fetchClientDetail(id) });
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["lead-attribution-summary", id],
    queryFn: () => fetchLeadAttributionSummary(id),
  });
  const { data: leads = [], isLoading: leadsLoading } = useQuery({
    queryKey: ["lead-attributions", id],
    queryFn: () => fetchLeadAttributions(id),
  });

  const qualifyMutation = useMutation({
    mutationFn: markLeadQualified,
    onSuccess: () => {
      toast.success("Lead marcado como qualificado.");
      queryClient.invalidateQueries({ queryKey: ["lead-attributions", id] });
      queryClient.invalidateQueries({ queryKey: ["lead-attribution-summary", id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao marcar qualificado"),
  });

  const invalidateAfterSale = () => {
    queryClient.invalidateQueries({ queryKey: ["lead-attributions", id] });
    queryClient.invalidateQueries({ queryKey: ["lead-attribution-summary", id] });
    queryClient.invalidateQueries({ queryKey: ["sales"] });
  };

  const filtered = leads.filter((l) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (l.contact_name ?? "").toLowerCase().includes(q) || l.remote_jid.includes(q);
  });

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
        <div>
          <Link to="/clients/$id" params={{ id }} search={{ openCampaignId: undefined }} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-2">
            <ArrowLeft className="h-3.5 w-3.5" /> Voltar pro cliente
          </Link>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Target className="h-5 w-5 text-muted-foreground" />
            Leads do Meta Ads {client ? `— ${client.name}` : ""}
          </h1>
        </div>

        {summaryLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <StatCard label="Conversas iniciadas" value={String(summary?.total_leads ?? 0)} />
            <StatCard label="Qualificados" value={String(summary?.qualified_leads ?? 0)} />
            <StatCard label="Taxa de qualificação" value={summary?.qualification_rate !== null && summary?.qualification_rate !== undefined ? `${summary.qualification_rate}%` : "—"} />
            <StatCard label="Vendas" value={String(summary?.sales_count ?? 0)} />
            <StatCard label="Valor vendido" value={brl(summary?.sales_value_total ?? 0)} />
          </div>
        )}

        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome ou telefone..." className="pl-8 h-9" />
          </div>
        </div>

        <Card className="overflow-x-auto">
          {leadsLoading ? (
            <div className="p-4 space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground text-center">
              {leads.length === 0 ? "Nenhum lead atribuído ainda. Conversas novas do WhatsApp vindas de um anúncio Click-to-WhatsApp aparecem aqui." : `Nenhum lead encontrado para "${search}".`}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Contato</TableHead>
                  <TableHead>Campanha / Conjunto / Anúncio</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Venda</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((lead) => (
                  <TableRow key={lead.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(lead.first_message_at).toLocaleDateString("pt-BR")}
                    </TableCell>
                    <TableCell className="text-sm">{lead.contact_name || lead.remote_jid.split("@")[0]}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[240px]">
                      <p className="truncate">{lead.campaign_name ?? "—"}</p>
                      <p className="truncate">{lead.adset_name ?? ""}</p>
                      <p className="truncate">{lead.ad_name ?? ""}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[lead.status]} className="text-[10px]">{STATUS_LABEL[lead.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {lead.sale_id ? (
                        <span className="text-status-on-target font-medium">{lead.sale_value !== null ? brl(lead.sale_value) : "Vendido"}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {lead.status === "pending" && (
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1 mr-1.5" onClick={() => qualifyMutation.mutate(lead.id)} disabled={qualifyMutation.isPending}>
                          <Check className="h-3 w-3" /> Qualificar
                        </Button>
                      )}
                      {!lead.sale_id && (
                        <Button size="sm" className="h-7 text-xs gap-1" onClick={() => setSaleFor(lead)}>
                          <DollarSign className="h-3 w-3" /> Converter
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>

      <ConvertToSaleDialog lead={saleFor} onClose={() => setSaleFor(null)} onSuccess={invalidateAfterSale} />
    </AppShell>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-3">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-lg font-semibold tabular-nums truncate">{value}</p>
    </Card>
  );
}

function ConvertToSaleDialog({ lead, onClose, onSuccess }: { lead: LeadAttributionRow | null; onClose: () => void; onSuccess: () => void }) {
  const [value, setValue] = useState("");
  const [obs, setObs] = useState("");

  const mutation = useMutation({
    mutationFn: () => convertLeadToSale(lead!.id, value.trim() ? Number(value) : null, obs),
    onSuccess: () => {
      toast.success("Venda registrada.");
      setValue("");
      setObs("");
      onSuccess();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao registrar venda"),
  });

  return (
    <Dialog open={!!lead} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar venda</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            Lead: <span className="text-foreground font-medium">{lead?.contact_name || lead?.remote_jid.split("@")[0]}</span>
          </p>
          <div className="space-y-1.5">
            <Label>Valor (R$)</Label>
            <Input type="number" min={0} step={0.01} value={value} onChange={(e) => setValue(e.target.value)} placeholder="0,00" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>Observação (opcional)</Label>
            <Input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex: fechou o pacote premium" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Salvando..." : "Registrar venda"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
