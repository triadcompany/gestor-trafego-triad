import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { Plus, Search, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { NoteCard } from "@/components/NoteCard";
import { NoteComposer } from "@/components/NoteComposer";
import { ReportTable } from "@/components/ReportTable";
import { ReportForm } from "@/components/ReportForm";
import {
  fetchNotes, createNote, updateNote, deleteNote,
  fetchReports, createReport, markReportSent, markReportPending, updateReport, deleteReport,
  fetchAllClients,
  fetchTasks, createTask, updateTask, deleteTask,
  fetchProfiles,
  type TaskRow,
  type NoteWithClient,
} from "@/lib/queries";
import type { TaskStatus } from "@/lib/database.types";

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
  if (status === "pendente") return <Badge variant="outline" className="text-amber-400 border-amber-800">Pendente</Badge>;
  if (status === "em_andamento") return <Badge variant="outline" className="text-blue-400 border-blue-800">Em andamento</Badge>;
  return <Badge variant="outline" className="text-green-400 border-green-800">Concluída</Badge>;
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
  const { data: profiles = [] } = useQuery({ queryKey: ["profiles"], queryFn: fetchProfiles });
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
          <div className="w-4 h-4 rounded-full bg-green-600 flex items-center justify-center">
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
            <span className={`text-xs font-mono ${overdue ? "text-red-400" : "text-muted-foreground"}`}>
              {overdue ? "⚠ " : ""}
              {new Date(task.due_date + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
            </span>
          )}
          {task.client_name && (
            <span className="text-xs text-muted-foreground">{task.client_name}</span>
          )}
          {task.assignee_name && (
            <span className="text-xs text-muted-foreground">→ {task.assignee_name}</span>
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
            <Select value={clientId || "none"} onValueChange={(v) => setClientId(v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhum</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {profiles.length > 0 && (
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
          )}
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
        <span className="ml-2 text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-amber-950 text-amber-400 border border-amber-900">
          {badge}
        </span>
      )}
    </button>
  );
}
