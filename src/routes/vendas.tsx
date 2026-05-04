import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TrendingUp, Plus, Check, X, Trash2, ChevronsUpDown } from "lucide-react";
import {
  fetchAllClients,
  fetchSales,
  fetchSalesByClient,
  createSale,
  deleteSale,
  fetchSalesGoals,
  upsertSalesGoal,
  type ClientRow,
  type SaleRow,
  type SalesGoalRow,
} from "@/lib/queries";
import type { DashboardPeriod } from "@/lib/queries";

export const Route = createFileRoute("/vendas")({
  head: () => ({ meta: [{ title: "Vendas — Gestor de Tráfego" }] }),
  component: VendasPage,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10);
}

function periodDateRange(period: DashboardPeriod, customRange?: { since: string; until: string }) {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86400000));
  switch (period) {
    case "today":      return { start: today(), end: today() };
    case "yesterday":  return { start: daysAgo(1), end: daysAgo(1) };
    case "last_7d":    return { start: daysAgo(6), end: today() };
    case "last_30d":   return { start: daysAgo(29), end: today() };
    case "this_month": return { start: iso(new Date(now.getFullYear(), now.getMonth(), 1)), end: today() };
    case "last_month": {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last  = new Date(now.getFullYear(), now.getMonth(), 0);
      return { start: iso(first), end: iso(last) };
    }
    case "maximum":  return { start: "2000-01-01", end: today() };
    case "custom":   return customRange ? { start: customRange.since, end: customRange.until } : { start: today(), end: today() };
  }
}

function activeMonth(start: string): string {
  return start.slice(0, 7); // YYYY-MM
}

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const PERIODS: { value: DashboardPeriod; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "last_7d", label: "Últimos 7 dias" },
  { value: "this_month", label: "Este mês" },
  { value: "last_month", label: "Mês passado" },
  { value: "last_30d", label: "Últimos 30 dias" },
  { value: "maximum", label: "Máximo" },
  { value: "custom", label: "Personalizado" },
];

// ── Main page ─────────────────────────────────────────────────────────────────

function VendasPage() {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<DashboardPeriod>("this_month");
  const [customSince, setCustomSince] = useState("");
  const [customUntil, setCustomUntil] = useState("");
  const [drawerClient, setDrawerClient] = useState<ClientRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerStartWithForm, setDrawerStartWithForm] = useState(false);
  const [addPopoverOpen, setAddPopoverOpen] = useState(false);

  const { start, end } = periodDateRange(period, period === "custom" ? { since: customSince, until: customUntil } : undefined);
  const month = activeMonth(start);

  const { data: clients = [], isLoading: loadingClients } = useQuery({
    queryKey: ["clients-all"],
    queryFn: fetchAllClients,
  });

  const { data: allSales = [], isLoading: loadingSales } = useQuery({
    queryKey: ["sales", start, end],
    queryFn: () => fetchSales(start, end),
    enabled: !!start && !!end,
  });

  const { data: goals = [] } = useQuery({
    queryKey: ["sales-goals", month],
    queryFn: () => fetchSalesGoals(month),
  });

  const goalMutation = useMutation({
    mutationFn: ({ clientId, goal }: { clientId: string; goal: number }) =>
      upsertSalesGoal(clientId, month, goal),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sales-goals"] }),
  });

  const goalsMap = new Map<string, number>(goals.map((g) => [g.client_id, g.goal]));

  const salesByClient = new Map<string, SaleRow[]>();
  for (const s of allSales) {
    const arr = salesByClient.get(s.client_id) ?? [];
    arr.push(s);
    salesByClient.set(s.client_id, arr);
  }

  const activeClients = clients.filter((c) => c.active);

  type ClientStats = {
    client: ClientRow;
    count: number;
    faturado: number | null;
    goal: number | null;
    pct: number | null;
  };

  const stats: ClientStats[] = activeClients.map((client) => {
    const sales = salesByClient.get(client.id) ?? [];
    const count = sales.length;
    const withValue = sales.filter((s) => s.value !== null);
    const faturado = withValue.length > 0 ? withValue.reduce((a, s) => a + (s.value ?? 0), 0) : null;
    const goal = goalsMap.get(client.id) ?? null;
    const pct = goal !== null && goal > 0 ? count / goal : null;
    return { client, count, faturado, goal, pct };
  });

  // Ordenação: com meta primeiro (por pct asc = mais crítico primeiro), sem meta no final
  stats.sort((a, b) => {
    if (a.goal !== null && b.goal === null) return -1;
    if (a.goal === null && b.goal !== null) return 1;
    if (a.pct !== null && b.pct !== null) return a.pct - b.pct;
    return 0;
  });

  // Totais
  const totalSales = allSales.length;
  const totalGoal = goals.reduce((s, g) => s + g.goal, 0);
  const totalPct = totalGoal > 0 ? totalSales / totalGoal : null;
  const salesWithValue = allSales.filter((s) => s.value !== null);
  const totalFaturado = salesWithValue.length > 0 ? salesWithValue.reduce((a, s) => a + (s.value ?? 0), 0) : null;
  const onTargetCount = stats.filter((s) => s.pct !== null && s.pct >= 0.8).length;

  const openDrawer = (client: ClientRow, withForm: boolean) => {
    setDrawerClient(client);
    setDrawerStartWithForm(withForm);
    setDrawerOpen(true);
  };

  const isLoading = loadingClients || loadingSales;

  return (
    <AppShell>
      <div className="px-4 md:px-6 py-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-xl font-semibold tracking-tight">Vendas</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={period} onValueChange={(v) => setPeriod(v as DashboardPeriod)}>
              <SelectTrigger className="w-44 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIODS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {period === "custom" && (
              <>
                <Input type="date" value={customSince} onChange={(e) => setCustomSince(e.target.value)} className="h-8 text-xs w-36" />
                <span className="text-muted-foreground text-sm">–</span>
                <Input type="date" value={customUntil} onChange={(e) => setCustomUntil(e.target.value)} className="h-8 text-xs w-36" />
              </>
            )}
            {/* Botão global + Registrar venda */}
            <Popover open={addPopoverOpen} onOpenChange={setAddPopoverOpen}>
              <PopoverTrigger asChild>
                <Button size="sm" className="h-8 gap-1.5 text-xs">
                  <Plus className="h-3.5 w-3.5" /> Registrar venda
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-0" align="end">
                <Command>
                  <CommandInput placeholder="Buscar cliente..." className="h-8 text-xs" />
                  <CommandEmpty className="text-xs py-4 text-center text-muted-foreground">Nenhum cliente encontrado</CommandEmpty>
                  <CommandGroup className="max-h-60 overflow-auto">
                    {activeClients.map((c) => (
                      <CommandItem
                        key={c.id}
                        value={c.name}
                        onSelect={() => { setAddPopoverOpen(false); openDrawer(c, true); }}
                        className="text-xs cursor-pointer"
                      >
                        {c.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          {/* Total de vendas */}
          <div className="relative overflow-hidden rounded-xl border border-green-500/30 bg-gradient-to-br from-green-950 to-green-900/60 p-4">
            <div className="absolute right-[-12px] top-[-12px] h-20 w-20 rounded-full bg-green-500/10" />
            <p className="text-[10px] font-semibold uppercase tracking-widest text-green-300">Total de vendas</p>
            <p className="mt-1 text-4xl font-extrabold text-white">{isLoading ? "—" : totalSales}</p>
            {totalGoal > 0 && (
              <div className="mt-3 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-green-400 transition-all"
                    style={{ width: `${Math.min((totalPct ?? 0) * 100, 100)}%` }}
                  />
                </div>
                <span className="text-[11px] font-bold text-green-400">{Math.round((totalPct ?? 0) * 100)}%</span>
              </div>
            )}
            <p className="mt-1 text-[11px] text-green-700">Meta geral: {totalGoal || "—"}</p>
          </div>

          {/* Faturado */}
          <div className="relative overflow-hidden rounded-xl border border-indigo-500/30 bg-gradient-to-br from-indigo-950 to-indigo-900/60 p-4">
            <div className="absolute right-[-12px] top-[-12px] h-20 w-20 rounded-full bg-indigo-500/10" />
            <p className="text-[10px] font-semibold uppercase tracking-widest text-indigo-300">Faturado estimado</p>
            <p className="mt-1 text-4xl font-extrabold text-white">
              {isLoading ? "—" : totalFaturado !== null ? brl(totalFaturado) : "—"}
            </p>
            <p className="mt-3 text-[11px] text-indigo-700">
              {salesWithValue.length} de {totalSales} vendas com valor
            </p>
          </div>

          {/* Clientes no alvo */}
          <div className="relative overflow-hidden rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-950 to-amber-900/60 p-4">
            <div className="absolute right-[-12px] top-[-12px] h-20 w-20 rounded-full bg-amber-500/10" />
            <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-300">Clientes no alvo</p>
            <p className="mt-1 text-4xl font-extrabold text-white">
              {isLoading ? "—" : onTargetCount}
              <span className="text-lg font-normal text-white/30"> / {activeClients.length}</span>
            </p>
            <p className="mt-3 text-[11px] text-amber-700">≥ 80% da meta mensal</p>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-border bg-[#111] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <span className="text-sm font-semibold">Por cliente</span>
            <div className="flex items-center gap-2 text-[10px]">
              <span className="flex items-center gap-1 rounded-full border border-green-500 bg-green-950 px-2 py-0.5 text-green-400">● No alvo</span>
              <span className="flex items-center gap-1 rounded-full border border-yellow-500 bg-yellow-950 px-2 py-0.5 text-yellow-400">● Atenção</span>
              <span className="flex items-center gap-1 rounded-full border border-red-500 bg-red-950 px-2 py-0.5 text-red-400">● Crítico</span>
            </div>
          </div>

          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-black/20 text-[11px] text-muted-foreground uppercase tracking-wider">
                <th className="px-5 py-2.5 text-left font-medium">Cliente</th>
                <th className="px-3 py-2.5 text-center font-medium">Vendas</th>
                <th className="px-3 py-2.5 text-center font-medium">Meta</th>
                <th className="px-3 py-2.5 text-left font-medium w-40">Progresso</th>
                <th className="px-3 py-2.5 text-right font-medium hidden md:table-cell">Faturado</th>
                <th className="px-5 py-2.5 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td colSpan={6} className="px-5 py-3">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    </tr>
                  ))
                : stats.map(({ client, count, faturado, goal, pct }) => (
                    <ClientRow
                      key={client.id}
                      client={client}
                      count={count}
                      faturado={faturado}
                      goal={goal}
                      pct={pct}
                      month={month}
                      onSaveGoal={(g) => goalMutation.mutate({ clientId: client.id, goal: g })}
                      onAddSale={() => openDrawer(client, true)}
                      onViewHistory={() => openDrawer(client, false)}
                    />
                  ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
          {drawerClient && (
            <ClientDrawer
              client={drawerClient}
              since={start}
              until={end}
              month={month}
              goal={goalsMap.get(drawerClient.id) ?? null}
              startWithForm={drawerStartWithForm}
              onClose={() => setDrawerOpen(false)}
            />
          )}
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}

// ── ClientRow ─────────────────────────────────────────────────────────────────

function ClientRow({
  client, count, faturado, goal, pct, month,
  onSaveGoal, onAddSale, onViewHistory,
}: {
  client: ClientRow;
  count: number;
  faturado: number | null;
  goal: number | null;
  pct: number | null;
  month: string;
  onSaveGoal: (g: number) => void;
  onAddSale: () => void;
  onViewHistory: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftGoal, setDraftGoal] = useState(String(goal ?? ""));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const statusColor =
    pct === null ? "text-muted-foreground"
    : pct >= 1 ? "text-green-400"
    : pct >= 0.5 ? "text-yellow-400"
    : "text-red-400";

  const barColor =
    pct === null ? ""
    : pct >= 1 ? "bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.5)]"
    : pct >= 0.5 ? "bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.4)]"
    : "bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.4)]";

  const handleSave = () => {
    const n = parseInt(draftGoal, 10);
    if (!isNaN(n) && n > 0) onSaveGoal(n);
    setEditing(false);
  };

  return (
    <tr className="border-b border-border/50 hover:bg-white/[0.02] transition-colors">
      <td className="px-5 py-3">
        <div className="font-semibold leading-tight">{client.name}</div>
        <div className="text-[10px] text-muted-foreground capitalize">{client.segment}</div>
      </td>
      <td className="px-3 py-3 text-center">
        <span className={`text-xl font-extrabold ${statusColor}`}>{count}</span>
      </td>
      <td className="px-3 py-3 text-center">
        {editing ? (
          <div className="inline-flex items-center gap-1">
            <input
              ref={inputRef}
              type="number"
              min={1}
              value={draftGoal}
              onChange={(e) => setDraftGoal(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setEditing(false); }}
              className="w-12 rounded-md border border-indigo-500 bg-background px-1.5 py-0.5 text-center text-sm focus:outline-none"
            />
            <button onClick={handleSave} className="text-green-400 hover:text-green-300"><Check className="h-3.5 w-3.5" /></button>
            <button onClick={() => setEditing(false)} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
          </div>
        ) : goal !== null ? (
          <button
            onClick={() => { setDraftGoal(String(goal)); setEditing(true); }}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            title="Clique para editar a meta"
          >
            {goal}
          </button>
        ) : (
          <button
            onClick={() => { setDraftGoal(""); setEditing(true); }}
            className="rounded-md border border-dashed border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:border-indigo-500 hover:text-indigo-400 transition-colors"
          >
            + definir
          </button>
        )}
      </td>
      <td className="px-3 py-3 w-40">
        {goal !== null && pct !== null ? (
          <div className="flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
              <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(pct * 100, 100)}%` }} />
            </div>
            <span className={`min-w-[34px] text-[11px] font-bold ${statusColor}`}>{Math.round(pct * 100)}%</span>
          </div>
        ) : (
          <span className="text-[11px] text-muted-foreground">sem meta</span>
        )}
      </td>
      <td className="px-3 py-3 text-right text-sm text-muted-foreground hidden md:table-cell">
        {faturado !== null ? brl(faturado) : "—"}
      </td>
      <td className="px-5 py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={onAddSale}
            className="rounded-md bg-indigo-950 px-2.5 py-1 text-[11px] font-medium text-indigo-400 hover:bg-indigo-900 transition-colors"
          >
            + venda
          </button>
          <button
            onClick={onViewHistory}
            className="rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            histórico
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── ClientDrawer ──────────────────────────────────────────────────────────────

function ClientDrawer({
  client, since, until, month, goal, startWithForm, onClose,
}: {
  client: ClientRow;
  since: string;
  until: string;
  month: string;
  goal: number | null;
  startWithForm: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(startWithForm);
  const [date, setDate] = useState(today());
  const [value, setValue] = useState("");
  const [obs, setObs] = useState("");

  const { data: sales = [], isLoading } = useQuery({
    queryKey: ["sales-by-client", client.id, since, until],
    queryFn: () => fetchSalesByClient(client.id, since, until),
  });

  const createMutation = useMutation({
    mutationFn: () => createSale({
      client_id: client.id,
      date,
      value: value !== "" ? parseFloat(value.replace(",", ".")) : null,
      obs: obs.trim() || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["sales-by-client", client.id] });
      setDate(today());
      setValue("");
      setObs("");
      setShowForm(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSale(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["sales-by-client", client.id] });
    },
  });

  const count = sales.length;
  const withValue = sales.filter((s) => s.value !== null);
  const faturado = withValue.length > 0 ? withValue.reduce((a, s) => a + (s.value ?? 0), 0) : null;
  const pct = goal !== null && goal > 0 ? count / goal : null;

  const statusColor = pct === null ? "text-muted-foreground" : pct >= 1 ? "text-green-400" : pct >= 0.5 ? "text-yellow-400" : "text-red-400";

  return (
    <>
      <SheetHeader className="px-5 py-4 border-b border-border shrink-0">
        <SheetTitle className="text-base">{client.name}</SheetTitle>
        <p className="text-xs text-muted-foreground">
          {since === until ? since : `${since} → ${until}`}
        </p>
      </SheetHeader>

      {/* Mini resumo */}
      <div className="grid grid-cols-2 gap-3 px-5 py-4 border-b border-border shrink-0">
        <div className="rounded-lg border border-green-500/30 bg-green-950/40 p-3 text-center">
          <div className={`text-2xl font-extrabold ${statusColor}`}>{count}</div>
          <div className="text-[10px] text-green-300">
            vendas {goal !== null ? `/ meta ${goal}` : ""}
          </div>
        </div>
        <div className="rounded-lg border border-indigo-500/30 bg-indigo-950/40 p-3 text-center">
          <div className="text-2xl font-extrabold text-indigo-300">{faturado !== null ? brl(faturado) : "—"}</div>
          <div className="text-[10px] text-indigo-300">faturado estimado</div>
        </div>
      </div>

      {/* Formulário */}
      <div className="px-5 py-3 border-b border-border shrink-0">
        {showForm ? (
          <div className="rounded-lg border border-border bg-[#141414] p-3 space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Nova venda</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Data *</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Valor (opcional)</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="R$ 0,00"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Observação (opcional)</Label>
              <textarea
                className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring min-h-[64px]"
                placeholder="Ex: cliente veio pelo Instagram..."
                value={obs}
                onChange={(e) => setObs(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1 h-8 text-xs bg-gradient-to-r from-blue-700 to-purple-700 hover:from-blue-600 hover:to-purple-600 border-0"
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || !date}
              >
                {createMutation.isPending ? "Salvando..." : "Salvar venda"}
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setShowForm(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" className="w-full h-8 text-xs gap-1.5" onClick={() => setShowForm(true)}>
            <Plus className="h-3.5 w-3.5" /> Nova venda
          </Button>
        )}
      </div>

      {/* Histórico */}
      <div className="flex-1 overflow-y-auto px-5 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">Registros</p>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : sales.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Nenhuma venda no período.</p>
        ) : (
          <div className="space-y-2">
            {sales.map((sale) => (
              <div key={sale.id} className="rounded-lg border border-border bg-[#111] px-3 py-2.5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{sale.date}</p>
                  <p className="text-xs text-muted-foreground/60 mt-0.5 truncate">
                    {sale.obs || "Sem observação"}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-sm font-bold ${sale.value ? "text-green-400" : "text-muted-foreground"}`}>
                    {sale.value !== null ? brl(sale.value) : "—"}
                  </span>
                  <button
                    onClick={() => deleteMutation.mutate(sale.id)}
                    disabled={deleteMutation.isPending}
                    className="text-muted-foreground/40 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
