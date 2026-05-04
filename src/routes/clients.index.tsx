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
import { Plus, Pencil, Power, Search, X, Check } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { fetchAllClients, upsertClient, toggleClientActive, fetchTags, createTag, setClientTags, type ClientRow, type TagRow } from "@/lib/queries";
import { TagBadge, TAG_COLORS } from "@/components/TagBadge";
import { brl } from "@/lib/mock-data";
import { useRef, useEffect } from "react";

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
                      onClick={() => navigate({ to: "/clients/$id", params: { id: c.id } })}
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
  onSave: (data: Parameters<typeof upsertClient>[0], tagIds: string[]) => void;
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
  const [pixActive, setPixActive] = useState(client?.pix_active ?? false);
  const [monthlyBudget, setMonthlyBudget] = useState<string>(client?.monthly_budget != null ? String(client.monthly_budget) : "");
  const [pixCycle, setPixCycle] = useState<"semanal" | "quinzenal" | "mensal">(client?.pix_cycle ?? "mensal");
  const [pixRefDay, setPixRefDay] = useState<string>(client?.pix_reference_day != null ? String(client.pix_reference_day) : "1");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>((client?.tags ?? []).map((t) => t.id));

  const queryClient = useQueryClient();
  const { data: allTags = [] } = useQuery({ queryKey: ["tags"], queryFn: fetchTags });
  const createTagMutation = useMutation({
    mutationFn: ({ name, color }: { name: string; color: string }) => createTag(name, color),
    onSuccess: (tag) => {
      queryClient.invalidateQueries({ queryKey: ["tags"] });
      setSelectedTagIds((prev) => [...prev, tag.id]);
    },
  });

  const handleSegmentChange = (val: "popular" | "premium") => {
    setSegment(val);
    setCplMin(segmentDefaults[val].cpl_min);
    setCplMax(segmentDefaults[val].cpl_max);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(
      {
        ...(client?.id ? { id: client.id } : {}),
        name,
        meta_ad_account_id: adAccountId,
        ...(pageId ? { meta_page_id: pageId } : {}),
        ...(whatsappNumber ? { meta_whatsapp_number: whatsappNumber } : {}),
        segment,
        cpl_min: cplMin,
        cpl_max: cplMax,
        payment_method: paymentMethod,
        pix_active: pixActive,
        monthly_budget: monthlyBudget !== "" ? Number(monthlyBudget) : null,
        pix_cycle: pixActive ? pixCycle : null,
        pix_reference_day: pixActive ? Number(pixRefDay) : null,
      },
      selectedTagIds,
    );
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
        <div className="space-y-1">
          <Label>Orçamento mensal (R$)</Label>
          <Input
            type="number"
            min={0}
            step={50}
            value={monthlyBudget}
            onChange={(e) => setMonthlyBudget(e.target.value)}
            placeholder="Ex: 2000"
          />
        </div>

        {/* Tags */}
        <div className="space-y-2">
          <Label>Tags</Label>
          <TagSelector
            allTags={allTags}
            selectedIds={selectedTagIds}
            onChange={setSelectedTagIds}
            onCreateTag={(name, color) => createTagMutation.mutate({ name, color })}
            creating={createTagMutation.isPending}
          />
        </div>

        {/* PIX */}
        <div className="space-y-3 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Cobrança PIX (honorários)</Label>
            <button
              type="button"
              onClick={() => setPixActive((v) => !v)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${pixActive ? "bg-primary" : "bg-muted"}`}
            >
              <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg transition-transform ${pixActive ? "translate-x-4" : "translate-x-0"}`} />
            </button>
          </div>

          {pixActive && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Ciclo</Label>
                  <Select value={pixCycle} onValueChange={(v) => { setPixCycle(v as typeof pixCycle); setPixRefDay("1"); }}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mensal">Mensal</SelectItem>
                      <SelectItem value="quinzenal">Quinzenal</SelectItem>
                      <SelectItem value="semanal">Semanal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    {pixCycle === "semanal" ? "Dia da semana" : pixCycle === "quinzenal" ? "Dia ref. (e +15)" : "Dia do mês"}
                  </Label>
                  {pixCycle === "semanal" ? (
                    <Select value={pixRefDay} onValueChange={setPixRefDay}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["Segunda","Terça","Quarta","Quinta","Sexta","Sábado","Domingo"].map((d, i) => (
                          <SelectItem key={i + 1} value={String(i + 1)}>{d}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Select value={pixRefDay} onValueChange={setPixRefDay}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: pixCycle === "quinzenal" ? 16 : 28 }, (_, i) => i + 1).map((d) => (
                          <SelectItem key={d} value={String(d)}>
                            {pixCycle === "quinzenal" ? `${d} e ${d + 15}` : `Dia ${d}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
              {monthlyBudget && (
                <p className="text-xs text-muted-foreground">
                  Parcela:{" "}
                  <strong className="text-foreground">
                    {(Number(monthlyBudget) / (pixCycle === "semanal" ? 4 : pixCycle === "quinzenal" ? 2 : 1)).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                  </strong>
                </p>
              )}
            </>
          )}
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

function TagSelector({
  allTags,
  selectedIds,
  onChange,
  onCreateTag,
  creating,
}: {
  allTags: TagRow[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  onCreateTag: (name: string, color: string) => void;
  creating: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("blue");
  const [showCreate, setShowCreate] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggle = (id: string) =>
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);

  const handleCreate = () => {
    if (!newName.trim()) return;
    onCreateTag(newName.trim(), newColor);
    setNewName("");
    setNewColor("blue");
    setShowCreate(false);
  };

  const selected = allTags.filter((t) => selectedIds.includes(t.id));

  return (
    <div className="relative" ref={ref}>
      <div
        className="min-h-9 flex flex-wrap gap-1 items-center px-3 py-1.5 rounded-md border border-input bg-background cursor-pointer"
        onClick={() => setOpen((v) => !v)}
      >
        {selected.length === 0 && (
          <span className="text-sm text-muted-foreground">Selecionar tags...</span>
        )}
        {selected.map((t) => (
          <span key={t.id} className="flex items-center gap-1">
            <TagBadge tag={t} />
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={(e) => { e.stopPropagation(); toggle(t.id); }}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-md p-1">
          {allTags.map((t) => (
            <button
              key={t.id}
              type="button"
              className="flex items-center gap-2 w-full px-2 py-1.5 rounded hover:bg-muted text-sm"
              onClick={() => toggle(t.id)}
            >
              <Check className={`h-3.5 w-3.5 shrink-0 ${selectedIds.includes(t.id) ? "opacity-100" : "opacity-0"}`} />
              <TagBadge tag={t} />
            </button>
          ))}

          {showCreate ? (
            <div className="mt-1 border-t border-border pt-2 px-1 space-y-2">
              <Input
                autoFocus
                placeholder="Nome da tag"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="h-7 text-xs"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreate(); } }}
              />
              <div className="flex gap-1 flex-wrap">
                {TAG_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    title={c.label}
                    className={`w-5 h-5 rounded-full ${c.bg} ${c.ring} ring-1 ring-inset ${newColor === c.value ? "ring-2 ring-offset-1" : ""}`}
                    onClick={() => setNewColor(c.value)}
                  />
                ))}
              </div>
              <div className="flex gap-1">
                <Button size="sm" type="button" className="h-7 text-xs" onClick={handleCreate} disabled={creating || !newName.trim()}>
                  {creating ? "..." : "Criar"}
                </Button>
                <Button size="sm" type="button" variant="ghost" className="h-7 text-xs" onClick={() => setShowCreate(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded hover:bg-muted text-xs text-muted-foreground mt-1 border-t border-border"
              onClick={() => setShowCreate(true)}
            >
              <Plus className="h-3.5 w-3.5" /> Nova tag
            </button>
          )}
        </div>
      )}
    </div>
  );
}
