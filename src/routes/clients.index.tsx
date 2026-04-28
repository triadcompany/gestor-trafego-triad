import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { StatusDot } from "@/components/StatusDot";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Power } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { fetchAllClients, upsertClient, toggleClientActive, type ClientRow } from "@/lib/queries";
import { brl } from "@/lib/mock-data";

export const Route = createFileRoute("/clients/")({
  head: () => ({
    meta: [{ title: "Clientes — Gestor de Tráfego" }],
  }),
  component: ClientsList,
});

const segmentDefaults = {
  popular: { cpl_min: 6, cpl_max: 12 },
  premium: { cpl_min: 12, cpl_max: 25 },
};

function ClientsList() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ClientRow | null>(null);

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ["clients-all"],
    queryFn: fetchAllClients,
  });

  const saveMutation = useMutation({
    mutationFn: upsertClient,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients-all"] });
      queryClient.invalidateQueries({ queryKey: ["clients-dashboard"] });
      setOpen(false);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      toggleClientActive(id, active),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients-all"] });
      queryClient.invalidateQueries({ queryKey: ["clients-dashboard"] });
    },
  });

  const openNew = () => {
    setEditing(null);
    setOpen(true);
  };

  const openEdit = (c: ClientRow) => {
    setEditing(c);
    setOpen(true);
  };

  return (
    <AppShell>
      <div className="px-4 md:px-8 py-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Clientes</h1>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2" onClick={openNew}>
                <Plus className="h-4 w-4" />
                Novo Cliente
              </Button>
            </DialogTrigger>
            <ClientFormDialog
              key={editing?.id ?? "new"}
              client={editing}
              onSave={(data) => saveMutation.mutate(data)}
              saving={saveMutation.isPending}
            />
          </Dialog>
        </div>

        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead className="hidden md:table-cell">Conta Meta</TableHead>
                <TableHead>Segmento</TableHead>
                <TableHead>Meta CPL</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={6}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                : clients.map((c) => (
                    <TableRow
                      key={c.id}
                      className={`cursor-pointer hover:bg-muted/50 ${c.active ? "" : "opacity-50"}`}
                      onClick={() => navigate({ to: "/clients/$id", params: { id: c.id } })}
                    >
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground text-sm">
                        {c.meta_ad_account_id}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {c.segment}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular-nums text-sm">
                        {brl(c.cpl_min)} – {brl(c.cpl_max)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <StatusDot status={c.active ? "on-target" : "no-data"} />
                          <span className="text-sm text-muted-foreground">
                            {c.active ? "Ativo" : "Inativo"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button size="icon" variant="ghost" onClick={() => openEdit(c)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Editar cliente</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => toggleMutation.mutate({ id: c.id, active: !c.active })}
                                disabled={toggleMutation.isPending}
                              >
                                <Power className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{c.active ? "Desativar" : "Ativar"} cliente</TooltipContent>
                          </Tooltip>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    </AppShell>
  );
}

function ClientFormDialog({
  client,
  onSave,
  saving,
}: {
  client: ClientRow | null;
  onSave: (data: Parameters<typeof upsertClient>[0]) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(client?.name ?? "");
  const [adAccountId, setAdAccountId] = useState(client?.meta_ad_account_id ?? "");
  const [pageId, setPageId] = useState(client?.meta_page_id ?? "");
  const [whatsappNumber, setWhatsappNumber] = useState(client?.meta_whatsapp_number ?? "");
  const [segment, setSegment] = useState<"popular" | "premium">(client?.segment ?? "popular");
  const [cplMin, setCplMin] = useState(client?.cpl_min ?? 6);
  const [cplMax, setCplMax] = useState(client?.cpl_max ?? 12);
  const [paymentMethod, setPaymentMethod] = useState<"pix" | "cartao">(client?.payment_method ?? "pix");

  const handleSegmentChange = (val: "popular" | "premium") => {
    setSegment(val);
    setCplMin(segmentDefaults[val].cpl_min);
    setCplMax(segmentDefaults[val].cpl_max);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...(client?.id ? { id: client.id } : {}),
      name,
      meta_ad_account_id: adAccountId,
      ...(pageId ? { meta_page_id: pageId } : {}),
      ...(whatsappNumber ? { meta_whatsapp_number: whatsappNumber } : {}),
      segment,
      cpl_min: cplMin,
      cpl_max: cplMax,
      payment_method: paymentMethod,
    });
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{client ? "Editar cliente" : "Novo cliente"}</DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4 py-2">
        <div className="space-y-1">
          <Label>Nome</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Auto Center Silva"
            required
          />
        </div>
        <div className="space-y-1">
          <Label>ID da conta de anúncio (act_...)</Label>
          <Input
            value={adAccountId}
            onChange={(e) => setAdAccountId(e.target.value)}
            placeholder="act_1234567890"
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>ID da Página do Facebook</Label>
            <Input
              value={pageId}
              onChange={(e) => setPageId(e.target.value)}
              placeholder="123456789012345"
            />
          </div>
          <div className="space-y-1">
            <Label>WhatsApp Business (+55...)</Label>
            <Input
              value={whatsappNumber}
              onChange={(e) => setWhatsappNumber(e.target.value)}
              placeholder="+5511999999999"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label>Segmento</Label>
          <Select value={segment} onValueChange={handleSegmentChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="popular">Popular (R$6 – R$12)</SelectItem>
              <SelectItem value="premium">Premium (R$12 – R$25)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Cobrança Meta</Label>
          <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as "pix" | "cartao")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pix">Pré-pago (PIX / crédito)</SelectItem>
              <SelectItem value="cartao">Pós-pago (Cartão)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>CPL mínimo (R$)</Label>
            <Input
              type="number"
              value={cplMin}
              onChange={(e) => setCplMin(Number(e.target.value))}
              min={0}
              step={0.5}
            />
          </div>
          <div className="space-y-1">
            <Label>CPL máximo (R$)</Label>
            <Input
              type="number"
              value={cplMax}
              onChange={(e) => setCplMax(Number(e.target.value))}
              min={0}
              step={0.5}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="submit" disabled={saving}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
