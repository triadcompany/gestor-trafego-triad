import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { fetchAutoReportConfig, setAutoReportClient, type AutoReportConfig, type AutoReportDestination } from "@/server/auto-reports";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FileText, Plus, Search, MoreHorizontal, Pencil, Trash2, ChevronsUpDown, Check as CheckIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { toast } from "sonner";
import { NoteCard } from "@/components/NoteCard";
import { NoteComposer } from "@/components/NoteComposer";
import { ReportTable } from "@/components/ReportTable";
import { ReportForm } from "@/components/ReportForm";
import {
  fetchNotes, createNote, updateNote, deleteNote,
  fetchReports, setMonthlyReportDone, createReport, markReportSent, markReportPending, updateReport, deleteReport,
  fetchAllClients,
  fetchTasks, createTask, updateTask, deleteTask,
  upsertClient,
  type TaskRow,
  type NoteWithClient,
  type ClientRow,
  type ReportWithClient,
} from "@/lib/queries";
import { fetchProfilesAdmin } from "@/server/profiles";
import { getCurrentUser } from "@/server/session";
import { isTriadCompanyOrg } from "@/lib/feature-flags";
import { DayOfMonthPicker } from "@/components/ClientFormDialog";
import type { TaskStatus } from "@/lib/database.types";
import { daysAgoInBrasilia, isoDateInBrasilia, monthRangeInBrasilia } from "@/lib/brasilia-date";

export const Route = createFileRoute("/tarefas")({
  head: () => ({
    meta: [{ title: "Tarefas — Gestor de Tráfego" }],
  }),
  ssr: false,
  component: TarefasPage,
});

type Tab = "tarefas" | "anotacoes" | "relatorios";

const STATUS_LABELS: Record<TaskStatus, string> = {
  pendente: "Pendente",
  em_andamento: "Em andamento",
  concluida: "Concluída",
};

const STATUS_ORDER: TaskStatus[] = ["pendente", "em_andamento", "concluida"];

function statusBadge(status: TaskStatus) {
  if (status === "pendente") return <Badge variant="outline" className="text-status-attention border-status-attention/40">Pendente</Badge>;
  if (status === "em_andamento") return <Badge variant="outline" className="text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-800">Em andamento</Badge>;
  return <Badge variant="outline" className="text-status-on-target border-status-on-target/40">Concluída</Badge>;
}

function isOverdue(due_date: string | null): boolean {
  if (!due_date) return false;
  return new Date(due_date + "T23:59:59") < new Date();
}

function TarefasPage() {
  const [tab, setTab] = useState<Tab>("tarefas");
  const [showComposer, setShowComposer] = useState(false);
  const [showReportForm, setShowReportForm] = useState(false);
  const [search, setSearch] = useState("");
  const [filterClientId, setFilterClientId] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterAssignee, setFilterAssignee] = useState<string>("all");
  const [taskDialog, setTaskDialog] = useState<{ open: boolean; editing: TaskRow | null }>({ open: false, editing: null });

  const qc = useQueryClient();

  const { data: clients = [] } = useQuery({ queryKey: ["all-clients"], queryFn: fetchAllClients });
  const { data: profiles = [] } = useQuery({ queryKey: ["profiles"], queryFn: () => fetchProfilesAdmin() });
  const { data: notes = [], isLoading: notesLoading } = useQuery<NoteWithClient[]>({ queryKey: ["notes"], queryFn: () => fetchNotes() });
  const { data: reports = [], isLoading: reportsLoading } = useQuery({ queryKey: ["reports"], queryFn: fetchReports });
  const { data: tasks = [], isLoading: tasksLoading } = useQuery({ queryKey: ["tasks"], queryFn: fetchTasks });

  // Notes mutations
  const createNoteMutation = useMutation({
    mutationFn: createNote,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["notes"] }); setShowComposer(false); toast.success("Anotação salva."); },
    onError: () => toast.error("Erro ao salvar anotação."),
  });
  const updateNoteMutation = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) => updateNote(id, content),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["notes"] }); toast.success("Anotação atualizada."); },
    onError: () => toast.error("Erro ao atualizar anotação."),
  });
  const deleteNoteMutation = useMutation({
    mutationFn: deleteNote,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["notes"] }); toast.success("Anotação removida."); },
    onError: () => toast.error("Erro ao remover anotação."),
  });

  // Reports mutations
  const createReportMutation = useMutation({
    mutationFn: createReport,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["reports"] }); setShowReportForm(false); toast.success("Relatório registrado."); },
    onError: () => toast.error("Erro ao registrar relatório."),
  });
  const markSentMutation = useMutation({
    mutationFn: markReportSent,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["reports"] }); toast.success("Relatório marcado como enviado."); },
    onError: () => toast.error("Erro ao atualizar relatório."),
  });
  const markPendingMutation = useMutation({
    mutationFn: markReportPending,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["reports"] }); toast.success("Relatório revertido para pendente."); },
    onError: () => toast.error("Erro ao atualizar relatório."),
  });
  const updateReportMutation = useMutation({
    mutationFn: ({ id, fields }: { id: string; fields: Parameters<typeof updateReport>[1] }) => updateReport(id, fields),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["reports"] }); toast.success("Relatório atualizado."); },
    onError: () => toast.error("Erro ao atualizar relatório."),
  });
  const deleteReportMutation = useMutation({
    mutationFn: deleteReport,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["reports"] }); toast.success("Relatório excluído."); },
    onError: () => toast.error("Erro ao excluir relatório."),
  });

  // Tasks mutations
  const createTaskMutation = useMutation({
    mutationFn: createTask,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); setTaskDialog({ open: false, editing: null }); toast.success("Tarefa criada."); },
    onError: () => toast.error("Erro ao criar tarefa."),
  });
  const updateTaskMutation = useMutation({
    mutationFn: ({ id, fields }: { id: string; fields: Parameters<typeof updateTask>[1] }) => updateTask(id, fields),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); setTaskDialog({ open: false, editing: null }); toast.success("Tarefa atualizada."); },
    onError: () => toast.error("Erro ao atualizar tarefa."),
  });
  const deleteTaskMutation = useMutation({
    mutationFn: deleteTask,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); toast.success("Tarefa excluída."); },
    onError: () => toast.error("Erro ao excluir tarefa."),
  });

  const filteredNotes = useMemo(() => notes.filter((n) => {
    const matchClient = filterClientId === "all" || n.client_id === filterClientId;
    const matchSearch = !search || n.content.toLowerCase().includes(search.toLowerCase()) || n.client_name.toLowerCase().includes(search.toLowerCase());
    return matchClient && matchSearch;
  }), [notes, filterClientId, search]);

  const filteredTasks = useMemo(() => {
    return tasks
      .filter((t) => {
        if (filterStatus !== "all" && t.status !== filterStatus) return false;
        if (filterAssignee !== "all" && t.assigned_to !== filterAssignee) return false;
        return true;
      })
      .sort((a, b) => {
        const si = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
        if (si !== 0) return si;
        if (!a.due_date && !b.due_date) return 0;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return a.due_date.localeCompare(b.due_date);
      });
  }, [tasks, filterStatus, filterAssignee]);

  const pendingCount = reports.filter((r) => r.status === "pendente").length;
  const openTaskCount = tasks.filter((t) => t.status !== "concluida").length;

  return (
    <AppShell>
      <div className="px-4 md:px-8 py-6 max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-0">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Tarefas</h1>
            <p className="text-sm text-muted-foreground mt-0.5 font-mono">tarefas, anotações e relatórios</p>
          </div>
          {tab === "tarefas" && (
            <Button size="sm" onClick={() => setTaskDialog({ open: true, editing: null })} className="gap-2 shrink-0">
              <Plus className="h-3.5 w-3.5" />
              Nova tarefa
            </Button>
          )}
          {tab === "anotacoes" && (
            <Button size="sm" onClick={() => setShowComposer((v) => !v)} className="gap-2 shrink-0">
              <Plus className="h-3.5 w-3.5" />
              Nova anotação
            </Button>
          )}
          {tab === "relatorios" && (
            <Button size="sm" onClick={() => setShowReportForm((v) => !v)} className="gap-2 shrink-0">
              <Plus className="h-3.5 w-3.5" />
              Registrar relatório
            </Button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-border mt-4 mb-6">
          <TabButton active={tab === "tarefas"} onClick={() => setTab("tarefas")} badge={openTaskCount > 0 ? openTaskCount : undefined}>
            Tarefas
          </TabButton>
          <TabButton active={tab === "anotacoes"} onClick={() => { setTab("anotacoes"); setShowReportForm(false); }}>
            Anotações
          </TabButton>
          <TabButton active={tab === "relatorios"} onClick={() => { setTab("relatorios"); setShowComposer(false); }} badge={pendingCount > 0 ? pendingCount : undefined}>
            Relatórios
          </TabButton>
        </div>

        {/* Aba Tarefas */}
        {tab === "tarefas" && (
          <div className="flex flex-col gap-4">
            {/* Filtros */}
            <div className="flex gap-2 items-center flex-wrap">
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="text-sm w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os status</SelectItem>
                  <SelectItem value="pendente">Pendente</SelectItem>
                  <SelectItem value="em_andamento">Em andamento</SelectItem>
                  <SelectItem value="concluida">Concluída</SelectItem>
                </SelectContent>
              </Select>
              {profiles.length > 0 && (
                <Select value={filterAssignee} onValueChange={setFilterAssignee}>
                  <SelectTrigger className="text-sm w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {profiles.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {tasksLoading ? (
              <div className="flex flex-col gap-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="rounded-xl border border-border bg-card h-16 animate-pulse" />
                ))}
              </div>
            ) : filteredTasks.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">
                {filterStatus !== "all" || filterAssignee !== "all"
                  ? "Nenhuma tarefa encontrada."
                  : "Nenhuma tarefa ainda. Clique em \"Nova tarefa\" para começar."}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {filteredTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onEdit={() => setTaskDialog({ open: true, editing: task })}
                    onDelete={() => deleteTaskMutation.mutate(task.id)}
                    onStatusChange={(status) => updateTaskMutation.mutate({ id: task.id, fields: { status } })}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Aba Anotações */}
        {tab === "anotacoes" && (
          <div className="flex flex-col gap-4">
            {showComposer && (
              <NoteComposer
                clients={clients}
                onSave={async (payload) => { await createNoteMutation.mutateAsync(payload); }}
                onCancel={() => setShowComposer(false)}
              />
            )}
            <div className="flex gap-2 items-center flex-wrap">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Buscar nas anotações..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 text-sm w-52"
                />
              </div>
              <Select value={filterClientId} onValueChange={setFilterClientId}>
                <SelectTrigger className="text-sm w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os clientes</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {notesLoading ? (
              <div className="flex flex-col gap-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="rounded-xl border border-border bg-card h-24 animate-pulse" />
                ))}
              </div>
            ) : filteredNotes.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">
                {search || filterClientId !== "all" ? "Nenhuma anotação encontrada." : "Nenhuma anotação ainda. Clique em \"Nova anotação\" para começar."}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {filteredNotes.map((note) => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    onUpdate={async (id, content) => { await updateNoteMutation.mutateAsync({ id, content }); }}
                    onDelete={(id) => deleteNoteMutation.mutate(id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Aba Relatórios */}
        {tab === "relatorios" && (
          <div className="flex flex-col gap-4">
            {showReportForm && (
              <ReportForm
                clients={clients}
                onSave={async (payload) => { await createReportMutation.mutateAsync(payload); }}
                onCancel={() => setShowReportForm(false)}
              />
            )}
            <ReportTable
              reports={reports}
              isLoading={reportsLoading}
              onMarkSent={(id) => markSentMutation.mutate(id)}
              onMarkPending={(id) => markPendingMutation.mutate(id)}
              onUpdate={(id, fields) => updateReportMutation.mutate({ id, fields })}
              onDelete={(id) => deleteReportMutation.mutate(id)}
            />
            <ReportDatesSection clients={clients} reports={reports} />
          </div>
        )}
      </div>

      {/* Dialog de criação/edição de tarefa */}
      <TaskDialog
        open={taskDialog.open}
        editing={taskDialog.editing}
        clients={clients}
        profiles={profiles}
        onClose={() => setTaskDialog({ open: false, editing: null })}
        onSave={(fields) => {
          if (taskDialog.editing) {
            updateTaskMutation.mutate({ id: taskDialog.editing.id, fields });
          } else {
            createTaskMutation.mutate(fields as Parameters<typeof createTask>[0]);
          }
        }}
        saving={createTaskMutation.isPending || updateTaskMutation.isPending}
      />
    </AppShell>
  );
}

// ── Datas de relatório ──────────────────────────────────────────────────────
// Visão à parte (não mexe na tabela de relatórios pendentes/enviados acima):
// todo cliente com "Dia do relatório mensal" configurado no cadastro,
// ordenado por dia — pra ver de relance quem vence quando no mês.

function ReportDatesSection({ clients, reports }: { clients: ClientRow[]; reports: ReportWithClient[] }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"todos" | "faltam" | "feitos">("todos");
  const month = useMemo(() => monthRangeInBrasilia(0), []);
  const today = isoDateInBrasilia();
  const todayDay = Number(today.slice(8, 10));
  const monthLabel = new Date(`${month.start}T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  // Cliente "feito" no mês = relatório mensal enviado (período ou envio dentro do mês).
  const doneClientIds = useMemo(() => {
    const set = new Set<string>();
    for (const r of reports) {
      if (r.period_type !== "mensal" || r.status !== "enviado") continue;
      const startsIn = r.period_start >= month.start && r.period_start <= month.end;
      const sent = r.sent_at ? r.sent_at.slice(0, 10) : "";
      if (startsIn || (sent >= month.start && sent <= month.end)) set.add(r.client_id);
    }
    return set;
  }, [reports, month]);

  const doneMutation = useMutation({
    mutationFn: ({ clientId, done }: { clientId: string; done: boolean }) =>
      setMonthlyReportDone({ client_id: clientId, month_start: month.start, month_end: month.end, done }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reports"] }),
    onError: () => toast.error("Erro ao atualizar o relatório do mês."),
  });
  const { data: currentUser } = useQuery({ queryKey: ["current-user"], queryFn: getCurrentUser, staleTime: 1000 * 60 });
  // Mostrar TODOS os clientes (não só os já configurados), pra dar pra
  // adicionar a data direto daqui, é experimental — só pra organização da
  // Triad Company por enquanto (ver memória "Triad Company é a org do
  // dono"). Nas demais organizações mantém o comportamento original: só
  // lista quem já tem dia configurado, sem edição inline.
  const isTriad = isTriadCompanyOrg(currentUser?.actingOrganizationId ?? currentUser?.organizationId);

  // Relatório automático (liga/desliga por cliente + destino). Só Triad por enquanto.
  const { data: autoConfig = {} as AutoReportConfig } = useQuery({
    queryKey: ["auto-report-config"],
    queryFn: fetchAutoReportConfig,
    enabled: isTriad,
  });
  const autoMutation = useMutation({
    mutationFn: ({ clientId, enabled, destination }: { clientId: string; enabled: boolean; destination: AutoReportDestination }) =>
      setAutoReportClient(clientId, enabled, destination),
    onSuccess: (cfg) => qc.setQueryData(["auto-report-config"], cfg),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar o relatório automático."),
  });


  const updateDayMutation = useMutation({
    mutationFn: ({ client, day }: { client: ClientRow; day: number | null }) =>
      upsertClient({
        id: client.id,
        name: client.name,
        meta_ad_account_id: client.meta_ad_account_id,
        meta_page_id: client.meta_page_id ?? undefined,
        meta_whatsapp_number: client.meta_whatsapp_number ?? undefined,
        segment: client.segment,
        cpl_min: client.cpl_min,
        cpl_max: client.cpl_max,
        payment_method: client.payment_method,
        pix_active: client.pix_active,
        monthly_budget: client.monthly_budget,
        pix_cycle: client.pix_cycle,
        pix_reference_day: client.pix_reference_day,
        whatsapp_group_id: client.whatsapp_group_id,
        whatsapp_group_name: client.whatsapp_group_name,
        meta_token_id: client.meta_token_id,
        whatsapp_instance_id: client.whatsapp_instance_id,
        owner_user_id: client.owner_user_id,
        qualified_lead_label: client.qualified_lead_label,
        meta_capi_dataset_id: client.meta_capi_dataset_id,
        monthly_report_day: day,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["all-clients"] });
      toast.success("Dia do relatório atualizado.");
    },
    onError: () => toast.error("Erro ao salvar o dia do relatório."),
  });

  const rows = (isTriad
    ? [...clients].sort((a, b) => (a.monthly_report_day ?? 99) - (b.monthly_report_day ?? 99) || a.name.localeCompare(b.name))
    : clients
        .filter((c): c is ClientRow & { monthly_report_day: number } => c.monthly_report_day !== null)
        .sort((a, b) => a.monthly_report_day - b.monthly_report_day)
  )
    .filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()))
    .filter((c) => (filter === "faltam" ? !doneClientIds.has(c.id) : filter === "feitos" ? doneClientIds.has(c.id) : true));

  // Placar só conta quem tem dia de relatório configurado.
  const tracked = clients.filter((c) => c.monthly_report_day !== null);
  const doneCount = tracked.filter((c) => doneClientIds.has(c.id)).length;
  const missingCount = tracked.length - doneCount;
  const overdueCount = tracked.filter((c) => !doneClientIds.has(c.id) && (c.monthly_report_day as number) < todayDay).length;
  const statusCell = (c: ClientRow) => {
    if (c.monthly_report_day === null) return null;
    const done = doneClientIds.has(c.id);
    const day = c.monthly_report_day;
    const late = !done && day < todayDay;
    const label = done ? "Feito" : late ? `Atrasado ${todayDay - day}d` : day === todayDay ? "Vence hoje" : "Pendente";
    const tone = done
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
      : late
        ? "border-red-500/40 bg-red-500/10 text-red-400"
        : day === todayDay
          ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
          : "border-border text-muted-foreground";
    return (
      <button
        type="button"
        title={done ? "Desmarcar relatório deste mês" : "Marcar relatório deste mês como feito"}
        disabled={doneMutation.isPending}
        onClick={() => doneMutation.mutate({ clientId: c.id, done: !done })}
        className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors hover:brightness-125 ${tone}`}
      >
        <CheckIcon className={`h-3 w-3 ${done ? "" : "opacity-40"}`} />
        {label}
      </button>
    );
  };
  const autoCell = (c: ClientRow) => {
    if (c.monthly_report_day === null) return null;
    const cfg = autoConfig[c.id];
    const enabled = !!cfg?.enabled;
    const destination: AutoReportDestination = cfg?.destination ?? "operacional";
    return (
      <div className="flex items-center gap-2" title="Gera o PDF e envia sozinho no dia do relatório">
        <Switch
          checked={enabled}
          disabled={autoMutation.isPending}
          onCheckedChange={(v) => autoMutation.mutate({ clientId: c.id, enabled: v, destination })}
        />
        <span className="text-xs text-muted-foreground">Automático</span>
        {enabled && (
          <Select value={destination} onValueChange={(v) => autoMutation.mutate({ clientId: c.id, enabled: true, destination: v as AutoReportDestination })}>
            <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="operacional">Grupo operacional</SelectItem>
              <SelectItem value="client_group">Grupo do cliente</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
    );
  };
  const autoCount = tracked.filter((c) => autoConfig[c.id]?.enabled).length;
  const pct = tracked.length > 0 ? Math.round((doneCount / tracked.length) * 100) : 0;

  return (
    <div className="rounded-xl border border-border bg-card mt-2">
      <div className="px-4 py-3 border-b border-border space-y-2.5">
        <div>
          <h3 className="text-sm font-semibold">Datas de relatório</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Dia do mês configurado no cadastro de cada cliente</p>
        </div>
        {tracked.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <p className="text-sm">
                <span className="font-semibold">{doneCount} de {tracked.length}</span> relatórios feitos em <span className="capitalize">{monthLabel}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {isTriad && autoCount > 0 && <span className="text-emerald-400">{autoCount} automático{autoCount > 1 ? "s" : ""} · </span>}
                {missingCount === 0 ? "Tudo feito neste mês" : `Faltam ${missingCount}`}
                {overdueCount > 0 && <span className="text-red-400"> · {overdueCount} atrasado{overdueCount > 1 ? "s" : ""}</span>}
              </p>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex gap-1.5">
              {([["todos", "Todos"], ["faltam", `Faltam (${missingCount})`], ["feitos", `Feitos (${doneCount})`]] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    filter === value ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted/40"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
        {isTriad && (
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar cliente..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 text-sm w-52"
            />
          </div>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground px-4">
          {search.trim()
            ? "Nenhum cliente encontrado."
            : "Nenhum cliente com dia de relatório configurado. Edite um cliente e preencha \"Dia do relatório mensal\"."}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {rows.map((c) =>
            isTriad ? (
              <div key={c.id} className="flex flex-wrap items-center gap-y-2 pr-4 hover:bg-muted/40 transition-colors">
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className="flex items-center gap-3 px-4 py-2.5 flex-1 min-w-0 text-left">
                    {c.monthly_report_day !== null ? (
                      <span className="shrink-0 w-9 h-9 rounded-full bg-muted flex items-center justify-center text-sm font-semibold">
                        {c.monthly_report_day}
                      </span>
                    ) : (
                      <span className="shrink-0 w-9 h-9 rounded-full border border-dashed border-border flex items-center justify-center">
                        <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                      </span>
                    )}
                    <span className="text-sm flex-1">{c.name}</span>
                    {c.monthly_report_day === null && <span className="text-xs text-muted-foreground">adicionar data</span>}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-72" align="start">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Dia do relatório — {c.name}</p>
                  <DayOfMonthPicker
                    value={c.monthly_report_day}
                    onChange={(day) => updateDayMutation.mutate({ client: c, day })}
                  />
                </PopoverContent>
              </Popover>
              <div className="flex flex-wrap items-center justify-end gap-2 pl-4 sm:pl-0">
                {autoCell(c)}
                {statusCell(c)}
                <GenerateReportButton clientId={c.id} clientName={c.name} />
              </div>
              </div>
            ) : (
              <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="shrink-0 w-9 h-9 rounded-full bg-muted flex items-center justify-center text-sm font-semibold">
                  {c.monthly_report_day}
                </span>
                <span className="text-sm flex-1">{c.name}</span>
                {statusCell(c)}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

// ── Gerar relatório (PDF) ────────────────────────────────────────────────────
// Escolhe o período e abre o relatório visual do cliente, de onde sai o PDF.

function GenerateReportButton({ clientId, clientName }: { clientId: string; clientName: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"30" | "custom">("30");
  const today = isoDateInBrasilia();
  const [since, setSince] = useState(daysAgoInBrasilia(30));
  const [until, setUntil] = useState(today);
  const invalid = mode === "custom" && (!since || !until || since > until);

  const go = () => {
    const range = mode === "30" ? { since: daysAgoInBrasilia(30), until: today } : { since, until };
    setOpen(false);
    navigate({ to: "/report-deck/$id", params: { id: clientId }, search: range });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="gap-1.5 shrink-0">
          <FileText className="h-3.5 w-3.5" />
          Gerar relatório
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3" align="end">
        <p className="text-xs font-medium text-muted-foreground">Relatório em PDF — {clientName}</p>
        <div className="grid grid-cols-2 gap-2">
          {([["30", "Últimos 30 dias"], ["custom", "Personalizado"]] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={`rounded-md border px-2 py-1.5 text-xs transition-colors ${
                mode === value ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted/40"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === "custom" && (
          <div className="flex items-center gap-2">
            <Input type="date" value={since} max={until} onChange={(e) => setSince(e.target.value)} className="h-8 text-xs" />
            <span className="text-xs text-muted-foreground">até</span>
            <Input type="date" value={until} min={since} max={today} onChange={(e) => setUntil(e.target.value)} className="h-8 text-xs" />
          </div>
        )}
        <Button type="button" size="sm" className="w-full" disabled={invalid} onClick={go}>
          Abrir relatório
        </Button>
      </PopoverContent>
    </Popover>
  );
}

// ── TaskCard ──────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  onEdit,
  onDelete,
  onStatusChange,
}: {
  task: TaskRow;
  onEdit: () => void;
  onDelete: () => void;
  onStatusChange: (status: TaskStatus) => void;
}) {
  const overdue = isOverdue(task.due_date) && task.status !== "concluida";

  return (
    <div className={`rounded-xl border border-border bg-card px-4 py-3 flex items-start gap-3 ${task.status === "concluida" ? "opacity-50" : ""}`}>
      {/* Status toggle circle */}
      <button
        onClick={() => {
          const next: TaskStatus = task.status === "pendente" ? "em_andamento" : task.status === "em_andamento" ? "concluida" : "pendente";
          onStatusChange(next);
        }}
        className="mt-0.5 shrink-0"
        title="Mudar status"
      >
        {task.status === "concluida" ? (
          <div className="w-4 h-4 rounded-full bg-status-on-target flex items-center justify-center">
            <span className="text-white text-[9px] font-bold">✓</span>
          </div>
        ) : task.status === "em_andamento" ? (
          <div className="w-4 h-4 rounded-full border-2 border-blue-500 bg-blue-500/20" />
        ) : (
          <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/50" />
        )}
      </button>

      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium leading-snug ${task.status === "concluida" ? "line-through text-muted-foreground" : ""}`}>
          {task.title}
        </p>
        <div className="flex flex-wrap items-center gap-2 mt-1.5">
          {statusBadge(task.status)}
          {task.due_date && (
            <span className={`text-xs font-mono ${overdue ? "text-status-critical" : "text-muted-foreground"}`}>
              {overdue ? "⚠ " : ""}
              {new Date(task.due_date + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
            </span>
          )}
          {task.client_name && (
            <span className="text-xs text-muted-foreground">{task.client_name}</span>
          )}
          {task.assignee_name && (
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300 border border-violet-300 dark:border-violet-800/60">
              <span className="w-3.5 h-3.5 rounded-full bg-violet-600 flex items-center justify-center text-[9px] font-bold text-white shrink-0">
                {task.assignee_name[0].toUpperCase()}
              </span>
              {task.assignee_name.split(" ")[0]}
            </span>
          )}
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="shrink-0 text-muted-foreground hover:text-foreground transition-colors mt-0.5">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5 mr-2" />
            Editar
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onDelete} className="text-destructive">
            <Trash2 className="h-3.5 w-3.5 mr-2" />
            Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ── TaskDialog ────────────────────────────────────────────────────────────────

function TaskDialog({
  open,
  editing,
  clients,
  profiles,
  onClose,
  onSave,
  saving,
}: {
  open: boolean;
  editing: TaskRow | null;
  clients: { id: string; name: string }[];
  profiles: { id: string; full_name: string }[];
  onClose: () => void;
  onSave: (fields: { title: string; status: TaskStatus; due_date?: string | null; client_id?: string | null; assigned_to?: string | null }) => void;
  saving: boolean;
}) {
  const [title, setTitle] = useState(editing?.title ?? "");
  const [status, setStatus] = useState<TaskStatus>(editing?.status ?? "pendente");
  const [dueDate, setDueDate] = useState(editing?.due_date ?? "");
  const [clientId, setClientId] = useState(editing?.client_id ?? "");
  const [assignedTo, setAssignedTo] = useState(editing?.assigned_to ?? "");
  const [clientPopoverOpen, setClientPopoverOpen] = useState(false);

  // Sync when editing changes
  useMemo(() => {
    setTitle(editing?.title ?? "");
    setStatus(editing?.status ?? "pendente");
    setDueDate(editing?.due_date ?? "");
    setClientId(editing?.client_id ?? "");
    setAssignedTo(editing?.assigned_to ?? "");
  }, [editing]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      title: title.trim(),
      status,
      due_date: dueDate || null,
      client_id: clientId || null,
      assigned_to: assignedTo || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Editar tarefa" : "Nova tarefa"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Título</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Descreva a tarefa..."
              required
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_ORDER.map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Prazo</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Cliente (opcional)</Label>
            <Popover open={clientPopoverOpen} onOpenChange={setClientPopoverOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  role="combobox"
                  aria-expanded={clientPopoverOpen}
                  className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className={clientId ? "" : "text-muted-foreground"}>
                    {clientId ? clients.find((c) => c.id === clientId)?.name : "Nenhum"}
                  </span>
                  <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0" align="start">
                <Command>
                  <CommandInput placeholder="Buscar cliente..." />
                  <CommandList>
                    <CommandEmpty>Nenhum cliente encontrado.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem value="none" onSelect={() => { setClientId(""); setClientPopoverOpen(false); }}>
                        <CheckIcon className={`mr-2 h-4 w-4 ${!clientId ? "opacity-100" : "opacity-0"}`} />
                        Nenhum
                      </CommandItem>
                      {clients.map((c) => (
                        <CommandItem
                          key={c.id}
                          value={c.name}
                          onSelect={() => { setClientId(c.id); setClientPopoverOpen(false); }}
                        >
                          <CheckIcon className={`mr-2 h-4 w-4 ${clientId === c.id ? "opacity-100" : "opacity-0"}`} />
                          {c.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-1">
            <Label>Responsável (opcional)</Label>
            <Select value={assignedTo || "none"} onValueChange={(v) => setAssignedTo(v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhum</SelectItem>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={saving || !title.trim()}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TabButton({
  active,
  onClick,
  children,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors relative ${
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
      {badge !== undefined && (
        <span className="ml-2 text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-status-attention/10 text-status-attention border border-status-attention/20">
          {badge}
        </span>
      )}
    </button>
  );
}
