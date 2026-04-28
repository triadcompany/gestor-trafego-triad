import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { NoteCard } from "@/components/NoteCard";
import { NoteComposer } from "@/components/NoteComposer";
import { ReportTable } from "@/components/ReportTable";
import { ReportForm } from "@/components/ReportForm";
import {
  fetchNotes,
  createNote,
  updateNote,
  deleteNote,
  fetchReports,
  createReport,
  markReportSent,
  markReportPending,
  fetchAllClients,
} from "@/lib/queries";

export const Route = createFileRoute("/tarefas")({
  head: () => ({
    meta: [{ title: "Tarefas — Gestor de Tráfego" }],
  }),
  ssr: false,
  component: TarefasPage,
});

type Tab = "anotacoes" | "relatorios";

function TarefasPage() {
  const [tab, setTab] = useState<Tab>("anotacoes");
  const [showComposer, setShowComposer] = useState(false);
  const [showReportForm, setShowReportForm] = useState(false);
  const [search, setSearch] = useState("");
  const [filterClientId, setFilterClientId] = useState<string>("all");

  const qc = useQueryClient();

  const { data: clients = [] } = useQuery({
    queryKey: ["all-clients"],
    queryFn: fetchAllClients,
  });

  const { data: notes = [], isLoading: notesLoading } = useQuery({
    queryKey: ["notes"],
    queryFn: () => fetchNotes(),
  });

  const { data: reports = [], isLoading: reportsLoading } = useQuery({
    queryKey: ["reports"],
    queryFn: fetchReports,
  });

  const createNoteMutation = useMutation({
    mutationFn: createNote,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notes"] });
      setShowComposer(false);
      toast.success("Anotação salva.");
    },
    onError: () => toast.error("Erro ao salvar anotação."),
  });

  const updateNoteMutation = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) => updateNote(id, content),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notes"] });
      toast.success("Anotação atualizada.");
    },
    onError: () => toast.error("Erro ao atualizar anotação."),
  });

  const deleteNoteMutation = useMutation({
    mutationFn: deleteNote,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notes"] });
      toast.success("Anotação removida.");
    },
    onError: () => toast.error("Erro ao remover anotação."),
  });

  const createReportMutation = useMutation({
    mutationFn: createReport,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reports"] });
      setShowReportForm(false);
      toast.success("Relatório registrado.");
    },
    onError: () => toast.error("Erro ao registrar relatório."),
  });

  const markSentMutation = useMutation({
    mutationFn: markReportSent,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reports"] });
      toast.success("Relatório marcado como enviado.");
    },
    onError: () => toast.error("Erro ao atualizar relatório."),
  });

  const markPendingMutation = useMutation({
    mutationFn: markReportPending,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reports"] });
      toast.success("Relatório revertido para pendente.");
    },
    onError: () => toast.error("Erro ao atualizar relatório."),
  });

  const filteredNotes = useMemo(() => {
    return notes.filter((n) => {
      const matchClient = filterClientId === "all" || n.client_id === filterClientId;
      const matchSearch = !search || n.content.toLowerCase().includes(search.toLowerCase()) || n.client_name.toLowerCase().includes(search.toLowerCase());
      return matchClient && matchSearch;
    });
  }, [notes, filterClientId, search]);

  const pendingCount = reports.filter((r) => r.status === "pendente").length;

  return (
    <AppShell>
      <div className="px-4 md:px-8 py-6 max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-0">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Tarefas</h1>
            <p className="text-sm text-muted-foreground mt-0.5 font-mono">anotações e controle de relatórios</p>
          </div>
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
          <TabButton active={tab === "anotacoes"} onClick={() => { setTab("anotacoes"); setShowReportForm(false); }}>
            Anotações
          </TabButton>
          <TabButton active={tab === "relatorios"} onClick={() => { setTab("relatorios"); setShowComposer(false); }} badge={pendingCount > 0 ? pendingCount : undefined}>
            Relatórios
          </TabButton>
        </div>

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

            {/* Filter bar */}
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
            />
          </div>
        )}

      </div>
    </AppShell>
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
