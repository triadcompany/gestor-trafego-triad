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
import { Plus, Pencil, Power, Search, Trash2 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { fetchAllClients, upsertClient, toggleClientActive, deleteClient, setClientTags, type ClientRow } from "@/lib/queries";
import { TagBadge } from "@/components/TagBadge";
import { brl } from "@/lib/mock-data";
import { ClientFormDialog } from "@/components/ClientFormDialog";

export const Route = createFileRoute("/clients/")({
  head: () => ({
    meta: [{ title: "Clientes — Gestor de Tráfego" }],
  }),
  component: ClientsList,
});

function ClientsList() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ClientRow | null>(null);
  const [search, setSearch] = useState("");

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ["clients-all"],
    queryFn: fetchAllClients,
  });

  const saveMutation = useMutation({
    mutationFn: async ({ clientData, tagIds }: { clientData: Parameters<typeof upsertClient>[0]; tagIds: string[] }) => {
      const { id } = await upsertClient(clientData);
      await setClientTags(id, tagIds);
    },
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

  const deleteMutation = useMutation({
    mutationFn: deleteClient,
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
              onSave={(clientData, tagIds) => saveMutation.mutate({ clientData, tagIds })}
              saving={saveMutation.isPending}
            />
          </Dialog>
        </div>

        <div className="flex gap-4 mb-4 text-sm text-muted-foreground">
          <span>
            <strong className="text-foreground tabular-nums">{clients.length}</strong> cadastrados
          </span>
          <span>
            <strong className="text-foreground tabular-nums">{clients.filter((c) => c.active).length}</strong> ativos
          </span>
        </div>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar cliente..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead className="hidden lg:table-cell">Conta Meta</TableHead>
                <TableHead className="hidden md:table-cell">Tags</TableHead>
                <TableHead>Segmento</TableHead>
                <TableHead className="hidden sm:table-cell">Pagamento</TableHead>
                <TableHead className="hidden sm:table-cell">Meta CPL</TableHead>
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
                : clients
                  .filter((c) =>
                    c.name.toLowerCase().includes(search.toLowerCase())
                  )
                  .map((c) => (
                    <TableRow
                      key={c.id}
                      className={`cursor-pointer hover:bg-muted/50 ${c.active ? "" : "opacity-50"}`}
                      onClick={() => navigate({ to: "/clients/$id", params: { id: c.id }, search: { openCampaignId: undefined } })}
                    >
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="hidden lg:table-cell text-muted-foreground text-sm">
                        {c.meta_ad_account_id}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {(c.tags ?? []).map((t) => <TagBadge key={t.id} tag={t} />)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {c.segment}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Badge
                          variant="outline"
                          className={c.payment_method === "pix"
                            ? "border-green-600/40 text-green-600 bg-green-600/10"
                            : "border-blue-500/40 text-blue-500 bg-blue-500/10"}
                        >
                          {c.payment_method === "pix" ? "PIX" : "Cartão"}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell tabular-nums text-sm">
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
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                onClick={() => {
                                  if (window.confirm(`Excluir "${c.name}"? Isso apaga o cliente e todo o histórico relacionado (métricas, tarefas, anotações, vendas). Não pode ser desfeito.`)) {
                                    deleteMutation.mutate(c.id);
                                  }
                                }}
                                disabled={deleteMutation.isPending}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Excluir cliente</TooltipContent>
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

