import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Search, Loader2, X, Paperclip, ChevronDown, Users, Send, Pencil, Repeat, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  fetchScheduledMessages,
  fetchScheduledMessageById,
  createScheduledMessage,
  updateScheduledMessage,
  cancelScheduledMessage,
  searchEvolutionRecipients,
  fetchWhatsappInstances,
  type ScheduledMessageRow,
  type ScheduledMessageDetail,
  type EvolutionRecipient,
  type MediaItem,
} from "@/lib/whatsapp-messages";
import { fetchAllClients } from "@/lib/queries";
import {
  fetchMessageAutomations,
  fetchMessageAutomationMedia,
  upsertMessageAutomation,
  deleteMessageAutomation,
  toggleMessageAutomation,
  runMessageAutomationNow,
  type MessageAutomationRow,
} from "@/server/automations";

export const Route = createFileRoute("/mensagens")({
  head: () => ({
    meta: [{ title: "Mensagens — Gestor de Tráfego" }],
  }),
  ssr: false,
  component: MensagensPage,
});

const STATUS_LABELS: Record<ScheduledMessageRow["status"], string> = {
  pending: "Agendada",
  sent: "Enviada",
  partial: "Parcial",
  failed: "Falhou",
  canceled: "Cancelada",
};

const STATUS_CLASSES: Record<ScheduledMessageRow["status"], string> = {
  pending: "text-primary bg-primary/10",
  sent: "text-status-on-target bg-status-on-target/10",
  partial: "text-status-attention bg-status-attention/10",
  failed: "text-status-critical bg-status-critical/10",
  canceled: "text-muted-foreground bg-muted",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MensagensPage() {
  const queryClient = useQueryClient();
  const [composerOpen, setComposerOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingMessage, setEditingMessage] = useState<ScheduledMessageDetail | null>(null);
  const [loadingEditId, setLoadingEditId] = useState<string | null>(null);

  const { data: messages = [], isLoading, isError } = useQuery({
    queryKey: ["scheduled-messages"],
    queryFn: fetchScheduledMessages,
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelScheduledMessage(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduled-messages"] });
      toast.success("Agendamento cancelado.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao cancelar"),
  });

  const handleEdit = async (id: string) => {
    setLoadingEditId(id);
    try {
      const detail = await fetchScheduledMessageById(id);
      if (!detail) {
        toast.error("Mensagem não encontrada.");
        return;
      }
      setEditingMessage(detail);
      setComposerOpen(true);
    } catch {
      toast.error("Erro ao carregar mensagem para edição.");
    } finally {
      setLoadingEditId(null);
    }
  };

  return (
    <AppShell>
      <div className="px-4 md:px-8 py-6 max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Mensagens</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Programe mensagens de WhatsApp pontuais ou regras que rodam sozinhas na recorrência que você definir.
          </p>
        </div>

        <Tabs defaultValue="agendadas">
          <TabsList className="mb-4">
            <TabsTrigger value="agendadas">Agendadas</TabsTrigger>
            <TabsTrigger value="automacoes">Automações</TabsTrigger>
          </TabsList>

          <TabsContent value="automacoes">
            <AutomacoesTab />
          </TabsContent>

          <TabsContent value="agendadas">
        <div className="flex justify-end mb-4">
          <Button onClick={() => { setEditingMessage(null); setComposerOpen(true); }} className="gap-2 w-full sm:w-auto">
            <Plus className="h-4 w-4" />
            Nova mensagem
          </Button>
        </div>

        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
          </div>
        )}

        {isError && (
          <div className="text-center text-sm text-muted-foreground py-10">
            Erro ao carregar mensagens agendadas.
          </div>
        )}

        {!isLoading && !isError && messages.length === 0 && (
          <div className="text-center py-16 rounded-xl border border-dashed border-border">
            <p className="text-sm text-muted-foreground">Nenhuma mensagem agendada ainda.</p>
          </div>
        )}

        <div className="space-y-3">
          {messages.map((m) => (
            <div key={m.id} className="rounded-xl border border-border bg-card overflow-hidden">
              <button
                className="w-full text-left p-4 flex items-start gap-3 hover:bg-muted/30 transition-colors"
                onClick={() => setExpandedId(expandedId === m.id ? null : m.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full ${STATUS_CLASSES[m.status]}`}>
                      {STATUS_LABELS[m.status]}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(m.scheduled_at)}</span>
                    {m.media_count > 0 && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Paperclip className="h-3 w-3" />
                        {m.media_count > 1 && m.media_count}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-foreground/90 line-clamp-2">{m.body}</p>
                  <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground min-w-0">
                    <Users className="h-3 w-3 shrink-0" />
                    <span className="truncate">{m.recipients.map((r) => r.name).join(", ")}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {m.status === "pending" && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEdit(m.id);
                        }}
                        disabled={loadingEditId === m.id}
                        aria-label="Editar"
                      >
                        {loadingEditId === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          cancelMutation.mutate(m.id);
                        }}
                        disabled={cancelMutation.isPending}
                      >
                        Cancelar
                      </Button>
                    </>
                  )}
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expandedId === m.id ? "rotate-180" : ""}`} />
                </div>
              </button>

              {expandedId === m.id && (
                <div className="px-4 pb-4 border-t border-border pt-3">
                  <div className="text-xs font-medium text-muted-foreground mb-2">Destinatários</div>
                  <div className="space-y-1.5">
                    {m.recipients.map((r) => (
                      <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate min-w-0">{r.name}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          {r.error_message && (
                            <span className="text-xs text-status-critical truncate max-w-[100px] sm:max-w-[200px]" title={r.error_message}>
                              {r.error_message}
                            </span>
                          )}
                          <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_CLASSES[r.status === "pending" ? "pending" : r.status]}`}>
                            {r.status === "pending" ? "Pendente" : r.status === "sent" ? "Enviada" : "Falhou"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
          </TabsContent>
        </Tabs>
      </div>

      <ComposerDialog
        open={composerOpen}
        onOpenChange={setComposerOpen}
        editing={editingMessage}
      />
    </AppShell>
  );
}

// ── Composer ───────────────────────────────────────────────────

function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ComposerDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: ScheduledMessageDetail | null;
}) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [recipients, setRecipients] = useState<EvolutionRecipient[]>([]);
  const [mediaFiles, setMediaFiles] = useState<File[]>([]);
  const [existingMedia, setExistingMedia] = useState<MediaItem[]>([]);
  const [loadedEditingId, setLoadedEditingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (open && editing && loadedEditingId !== editing.id) {
    setBody(editing.body);
    setScheduledAt(isoToLocalInput(editing.scheduled_at));
    setRecipients(
      editing.recipients.map((r) => ({
        remoteJid: r.remote_jid,
        name: r.name,
        isGroup: r.remote_jid.endsWith("@g.us"),
      }))
    );
    setMediaFiles([]);
    setExistingMedia(editing.media);
    setLoadedEditingId(editing.id);
  } else if (open && !editing && loadedEditingId !== "new") {
    setBody("");
    setScheduledAt("");
    setRecipients([]);
    setMediaFiles([]);
    setExistingMedia([]);
    setLoadedEditingId("new");
  }

  const reset = () => {
    setBody("");
    setScheduledAt("");
    setRecipients([]);
    setMediaFiles([]);
    setExistingMedia([]);
    setLoadedEditingId(null);
  };

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const tooBig = Array.from(files).find((f) => f.size > 100 * 1024 * 1024);
    if (tooBig) {
      toast.error(`"${tooBig.name}" é maior que 100MB.`);
      return;
    }
    setMediaFiles((prev) => [...prev, ...Array.from(files)]);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const uploaded = await Promise.all(
        mediaFiles.map(async (f) => ({
          base64: await fileToBase64(f),
          mimetype: f.type,
          filename: f.name,
        }))
      );
      const media = [...existingMedia, ...uploaded];
      const payload = {
        body,
        media,
        scheduledAt: new Date(scheduledAt).toISOString(),
        recipients: recipients.map((r) => ({ remoteJid: r.remoteJid, name: r.name })),
      };
      if (editing) {
        await updateScheduledMessage({ id: editing.id, ...payload });
      } else {
        await createScheduledMessage(payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduled-messages"] });
      toast.success(editing ? "Mensagem atualizada." : "Mensagem agendada.");
      reset();
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar mensagem", { duration: 8000 }),
  });

  const isPast = scheduledAt !== "" && new Date(scheduledAt) <= new Date();
  const canSubmit = body.trim().length > 0 && recipients.length > 0 && scheduledAt !== "" && !isPast;
  const allMediaLabels = [...existingMedia.map((m) => m.filename), ...mediaFiles.map((f) => f.name)];

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar mensagem agendada" : "Nova mensagem agendada"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Mensagem</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Digite a mensagem..."
              className="min-h-[90px] sm:min-h-[100px] resize-none"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="block">
              Mídia
              <span className="text-muted-foreground font-normal text-xs ml-1.5">opcional — pode anexar mais de uma</span>
            </Label>
            {allMediaLabels.length > 0 && (
              <div className="space-y-1.5">
                {existingMedia.map((m, i) => (
                  <div key={`existing-${i}`} className="flex items-center justify-between px-3 py-2 border border-border rounded-md text-sm">
                    <span className="truncate">{m.filename}</span>
                    <button onClick={() => setExistingMedia((prev) => prev.filter((_, idx) => idx !== i))}>
                      <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                    </button>
                  </div>
                ))}
                {mediaFiles.map((f, i) => (
                  <div key={`new-${i}`} className="flex items-center justify-between px-3 py-2 border border-border rounded-md text-sm">
                    <span className="truncate">{f.name}</span>
                    <button onClick={() => setMediaFiles((prev) => prev.filter((_, idx) => idx !== i))}>
                      <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="w-full justify-start gap-2"
            >
              <Paperclip className="h-3.5 w-3.5" />
              {allMediaLabels.length > 0 ? "Anexar mais um arquivo" : "Anexar imagem, vídeo ou documento"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*,application/pdf"
              multiple
              className="hidden"
              onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Destinatários</Label>
            <RecipientSearch selected={recipients} onChange={setRecipients} />
          </div>

          <div className="space-y-1.5">
            <Label>Data e hora do envio</Label>
            <Input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
            {isPast && <p className="text-xs text-status-critical">Escolha uma data/hora no futuro.</p>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!canSubmit || saveMutation.isPending}
            className="gap-2"
          >
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {editing ? "Salvar alterações" : "Agendar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Recipient search ─────────────────────────────────────────────

function RecipientSearch({
  selected,
  onChange,
}: {
  selected: EvolutionRecipient[];
  onChange: (recipients: EvolutionRecipient[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EvolutionRecipient[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = (q: string) => {
    setQuery(q);
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await searchEvolutionRecipients(q);
        setResults(data.filter((r) => !selected.some((s) => s.remoteJid === r.remoteJid)));
      } catch {
        toast.error("Erro ao buscar contatos/grupos na Evolution API.");
      } finally {
        setSearching(false);
      }
    }, 400);
  };

  const add = (r: EvolutionRecipient) => {
    onChange([...selected, r]);
    setResults([]);
    setQuery("");
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 px-3 py-2 border border-border rounded-md bg-background">
        {searching ? <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin" /> : <Search className="h-3.5 w-3.5 text-muted-foreground" />}
        <input
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Buscar contato ou grupo..."
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      {results.length > 0 && (
        <div className="border border-border rounded-md overflow-hidden bg-popover shadow-sm max-h-56 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.remoteJid}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 transition-colors flex items-center justify-between gap-2"
              onClick={() => add(r)}
            >
              <span className="truncate">{r.name}</span>
              <span className="text-xs text-muted-foreground shrink-0">{r.isGroup ? "Grupo" : "Contato"}</span>
            </button>
          ))}
        </div>
      )}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((r) => (
            <span key={r.remoteJid} className="flex items-center gap-1.5 bg-muted/60 rounded-full px-2.5 py-1 text-xs">
              {r.name}
              <button onClick={() => onChange(selected.filter((s) => s.remoteJid !== r.remoteJid))}>
                <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Automações ─────────────────────────────────────────────────

const DOW_LABEL: Record<number, string> = { 1: "seg", 2: "ter", 3: "qua", 4: "qui", 5: "sex", 6: "sáb", 7: "dom" };

function recurrenceSummary(r: MessageAutomationRow): string {
  const hhmm = `${String(r.send_hour).padStart(2, "0")}:${String(r.send_minute).padStart(2, "0")}`;
  if (r.recurrence_type === "daily") return `Todo dia às ${hhmm}`;
  const days = [...r.recurrence_days].sort((a, b) => a - b);
  if (r.recurrence_type === "weekly") {
    return `Toda ${days.map((d) => DOW_LABEL[d]).join(" e ")} às ${hhmm}`;
  }
  return `Todo mês nos dias ${days.join(", ")} às ${hhmm}`;
}

function contentLabel(r: MessageAutomationRow): string {
  if (r.content_type === "report") {
    return `Relatório ${r.report_period_days} dias${r.client_name ? ` · ${r.client_name}` : ""}`;
  }
  if (r.content_type === "group_summary") {
    return `Resumo de grupo · ${r.summary_turno === "tarde" ? "tarde" : "manhã"} · ${r.summary_client_ids.length} cliente${r.summary_client_ids.length === 1 ? "" : "s"}`;
  }
  return "Texto";
}

function AutomacoesTab() {
  const qc = useQueryClient();
  const [composerOpen, setComposerOpen] = useState(false);
  const [editing, setEditing] = useState<MessageAutomationRow | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterClient, setFilterClient] = useState("all");
  const [filterType, setFilterType] = useState("all");

  const { data: automations = [], isLoading, isError } = useQuery({
    queryKey: ["message-automations"],
    queryFn: fetchMessageAutomations,
  });

  // Opções de cliente derivadas das próprias automações (sem query extra).
  const clientOptions = Array.from(
    new Map(automations.filter((a) => a.client_id).map((a) => [a.client_id!, a.client_name ?? a.client_id!])).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]));
  const hasNoClientRules = automations.some((a) => !a.client_id);

  const q = search.trim().toLowerCase();
  const filtered = automations.filter((a) => {
    if (q && !a.name.toLowerCase().includes(q)) return false;
    if (filterClient === "none" && a.client_id) return false;
    if (filterClient !== "all" && filterClient !== "none" && a.client_id !== filterClient) return false;
    if (filterType !== "all" && a.content_type !== filterType) return false;
    return true;
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => toggleMessageAutomation(id, active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["message-automations"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao atualizar"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteMessageAutomation(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["message-automations"] });
      toast.success("Automação excluída.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao excluir"),
  });

  const runNow = async (id: string) => {
    setRunningId(id);
    try {
      const r = await runMessageAutomationNow(id);
      if (r.created) {
        toast.success("Mensagem gerada — veja na aba Agendadas.");
        qc.invalidateQueries({ queryKey: ["scheduled-messages"] });
        qc.invalidateQueries({ queryKey: ["message-automations"] });
      } else {
        toast.error(r.warnings[0] ?? "Nada foi enviado.", { duration: 8000 });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao rodar automação");
    } finally {
      setRunningId(null);
    }
  };

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button onClick={() => { setEditing(null); setComposerOpen(true); }} className="gap-2 w-full sm:w-auto">
          <Plus className="h-4 w-4" />
          Nova automação
        </Button>
      </div>

      {!isLoading && !isError && automations.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <div className="flex items-center gap-1.5 px-3 py-2 border border-border rounded-md bg-background flex-1 min-w-0">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome..."
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground min-w-0"
            />
          </div>
          <Select value={filterClient} onValueChange={setFilterClient}>
            <SelectTrigger className="w-full sm:w-48 h-9"><SelectValue placeholder="Cliente" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os clientes</SelectItem>
              {hasNoClientRules && <SelectItem value="none">Sem cliente</SelectItem>}
              {clientOptions.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-full sm:w-40 h-9"><SelectValue placeholder="Tipo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os tipos</SelectItem>
              <SelectItem value="report">Relatório</SelectItem>
              <SelectItem value="text">Mensagem</SelectItem>
              <SelectItem value="group_summary">Resumo de grupo</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {!isLoading && !isError && automations.length > 0 && (
        <p className="text-xs text-muted-foreground mb-3">
          {filtered.length} de {automations.length}
        </p>
      )}

      {isLoading && (
        <div className="space-y-3">{[1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}</div>
      )}
      {isError && <div className="text-center text-sm text-muted-foreground py-10">Erro ao carregar automações.</div>}
      {!isLoading && !isError && automations.length === 0 && (
        <div className="text-center py-16 rounded-xl border border-dashed border-border">
          <Repeat className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Nenhuma automação ainda.</p>
          <p className="text-xs text-muted-foreground mt-1">Ex: toda segunda às 8h30 enviar o relatório dos últimos 7 dias.</p>
        </div>
      )}
      {!isLoading && !isError && automations.length > 0 && filtered.length === 0 && (
        <div className="text-center py-12 text-sm text-muted-foreground">Nenhuma automação com esses filtros.</div>
      )}

      <div className="space-y-3">
        {filtered.map((a) => (
          <div key={a.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="font-medium text-sm">{a.name}</span>
                  <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {contentLabel(a)}
                  </span>
                  {!a.active && (
                    <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      Pausada
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{recurrenceSummary(a)}</p>
                <div className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground min-w-0">
                  <Users className="h-3 w-3 shrink-0" />
                  <span className="truncate">{a.destinations.map((d) => d.name).join(", ") || "sem destino"}</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {a.last_run_at ? `Rodou por último em ${formatDateTime(a.last_run_at)}` : "Nunca rodou"}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <Switch
                  checked={a.active}
                  onCheckedChange={(v) => toggleMut.mutate({ id: a.id, active: v })}
                  aria-label="Ativar/pausar"
                />
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => runNow(a.id)}
                    disabled={runningId === a.id}
                    aria-label="Rodar agora"
                  >
                    {runningId === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditing(a); setComposerOpen(true); }} aria-label="Editar">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-status-critical hover:text-status-critical"
                    onClick={() => { if (confirm(`Excluir a automação "${a.name}"?`)) deleteMut.mutate(a.id); }}
                    aria-label="Excluir"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <AutomationComposerDialog open={composerOpen} onOpenChange={setComposerOpen} editing={editing} />
    </div>
  );
}

const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: "Seg" }, { value: 2, label: "Ter" }, { value: 3, label: "Qua" },
  { value: 4, label: "Qui" }, { value: 5, label: "Sex" }, { value: 6, label: "Sáb" }, { value: 7, label: "Dom" },
];

function AutomationComposerDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: MessageAutomationRow | null;
}) {
  const qc = useQueryClient();
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [contentType, setContentType] = useState<"text" | "report" | "group_summary">("text");
  const [body, setBody] = useState("");
  const [clientId, setClientId] = useState<string>("none");
  const [reportPeriodDays, setReportPeriodDays] = useState<number>(7);
  const [summaryTurno, setSummaryTurno] = useState<"manha" | "tarde">("manha");
  const [summaryClientIds, setSummaryClientIds] = useState<string[]>([]);
  const [recurrenceType, setRecurrenceType] = useState<"weekly" | "daily" | "monthly">("weekly");
  const [weekdays, setWeekdays] = useState<number[]>([1]);
  const [monthdays, setMonthdays] = useState<number[]>([1]);
  const [sendHour, setSendHour] = useState("10");
  const [sendMinute, setSendMinute] = useState("00");
  const [instanceId, setInstanceId] = useState<string>("auto");
  const [useClientGroup, setUseClientGroup] = useState(false);
  const [customRecipients, setCustomRecipients] = useState<EvolutionRecipient[]>([]);
  const [mediaFiles, setMediaFiles] = useState<File[]>([]);
  const [existingMedia, setExistingMedia] = useState<MediaItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: clients = [] } = useQuery({ queryKey: ["clients-all"], queryFn: fetchAllClients });
  const { data: instances = [] } = useQuery({ queryKey: ["whatsapp-instances"], queryFn: fetchWhatsappInstances });

  const reset = () => {
    setLoadedId(null);
    setName(""); setContentType("text"); setBody(""); setClientId("none"); setReportPeriodDays(7);
    setSummaryTurno("manha"); setSummaryClientIds([]);
    setRecurrenceType("weekly"); setWeekdays([1]); setMonthdays([1]); setSendHour("10"); setSendMinute("00");
    setInstanceId("auto"); setUseClientGroup(false); setCustomRecipients([]); setMediaFiles([]); setExistingMedia([]);
  };

  if (open && editing && loadedId !== editing.id) {
    setLoadedId(editing.id);
    setName(editing.name);
    setContentType(editing.content_type);
    setBody(editing.body ?? "");
    setClientId(editing.client_id ?? "none");
    setReportPeriodDays(editing.report_period_days);
    setSummaryTurno(editing.summary_turno ?? "manha");
    setSummaryClientIds(editing.summary_client_ids ?? []);
    setRecurrenceType(editing.recurrence_type);
    if (editing.recurrence_type === "weekly") setWeekdays(editing.recurrence_days.length ? editing.recurrence_days : [1]);
    if (editing.recurrence_type === "monthly") setMonthdays(editing.recurrence_days.length ? editing.recurrence_days : [1]);
    setSendHour(String(editing.send_hour).padStart(2, "0"));
    setSendMinute(String(editing.send_minute).padStart(2, "0"));
    setInstanceId(editing.whatsapp_instance_id ?? "auto");
    setUseClientGroup(editing.destinations.some((d) => d.kind === "client_group"));
    setCustomRecipients(
      editing.destinations
        .filter((d) => d.kind === "custom" && d.remote_jid)
        .map((d) => ({ remoteJid: d.remote_jid!, name: d.name, isGroup: (d.remote_jid ?? "").endsWith("@g.us") }))
    );
    setMediaFiles([]);
    setExistingMedia([]);
    if (editing.media_count > 0) {
      fetchMessageAutomationMedia(editing.id).then(setExistingMedia).catch(() => {});
    }
  } else if (open && !editing && loadedId !== "new") {
    reset();
    setLoadedId("new");
  }

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const tooBig = Array.from(files).find((f) => f.size > 100 * 1024 * 1024);
    if (tooBig) { toast.error(`"${tooBig.name}" é maior que 100MB.`); return; }
    setMediaFiles((prev) => [...prev, ...Array.from(files)]);
  };

  const toggleDay = (list: number[], setList: (v: number[]) => void, day: number) => {
    setList(list.includes(day) ? list.filter((d) => d !== day) : [...list, day].sort((a, b) => a - b));
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const uploaded = await Promise.all(
        mediaFiles.map(async (f) => ({ base64: await fileToBase64(f), mimetype: f.type, filename: f.name }))
      );
      const destinations = [
        ...(useClientGroup && clientId !== "none"
          ? [{ kind: "client_group" as const, remoteJid: null, name: "Grupo do cliente" }]
          : []),
        ...customRecipients.map((r) => ({ kind: "custom" as const, remoteJid: r.remoteJid, name: r.name })),
      ];
      await upsertMessageAutomation({
        id: editing?.id,
        name: name.trim(),
        contentType,
        body: contentType === "text" ? body : null,
        summaryTurno: contentType === "group_summary" ? summaryTurno : null,
        summaryClientIds: contentType === "group_summary" ? summaryClientIds : [],
        clientId: clientId === "none" ? null : clientId,
        reportPeriodDays,
        recurrenceType,
        recurrenceDays: recurrenceType === "weekly" ? weekdays : recurrenceType === "monthly" ? monthdays : [],
        sendHour: Number(sendHour),
        sendMinute: Number(sendMinute),
        whatsappInstanceId: instanceId === "auto" ? null : instanceId,
        destinations,
        media: [...existingMedia, ...uploaded],
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["message-automations"] });
      toast.success(editing ? "Automação atualizada." : "Automação criada.");
      reset();
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar", { duration: 8000 }),
  });

  const hasClient = clientId !== "none";
  const canSubmit =
    name.trim().length > 0 &&
    (contentType === "text"
      ? body.trim().length > 0 || mediaFiles.length > 0 || existingMedia.length > 0
      : contentType === "report"
        ? hasClient
        : summaryClientIds.length > 0) &&
    (recurrenceType === "daily" ||
      (recurrenceType === "weekly" && weekdays.length > 0) ||
      (recurrenceType === "monthly" && monthdays.length > 0)) &&
    (useClientGroup && hasClient) || customRecipients.length > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar automação" : "Nova automação"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Relatório semanal Auto Motors" />
          </div>

          <div className="space-y-1.5">
            <Label>Tipo de conteúdo</Label>
            <RadioGroup value={contentType} onValueChange={(v) => setContentType(v as "text" | "report" | "group_summary")} className="flex flex-wrap gap-x-4 gap-y-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <RadioGroupItem value="text" /> Texto
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <RadioGroupItem value="report" /> Relatório de métricas
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <RadioGroupItem value="group_summary" /> Resumo de grupo
              </label>
            </RadioGroup>
          </div>

          {contentType === "text" ? (
            <>
              <div className="space-y-1.5">
                <Label>Mensagem</Label>
                <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Digite a mensagem..." className="min-h-[90px] resize-none" />
              </div>
              <div className="space-y-1.5">
                <Label className="block">Mídia <span className="text-muted-foreground font-normal text-xs ml-1.5">opcional</span></Label>
                {(existingMedia.length > 0 || mediaFiles.length > 0) && (
                  <div className="space-y-1.5">
                    {existingMedia.map((m, i) => (
                      <div key={`e${i}`} className="flex items-center justify-between px-3 py-2 border border-border rounded-md text-sm">
                        <span className="truncate">{m.filename}</span>
                        <button onClick={() => setExistingMedia((p) => p.filter((_, idx) => idx !== i))}><X className="h-3.5 w-3.5 text-muted-foreground" /></button>
                      </div>
                    ))}
                    {mediaFiles.map((f, i) => (
                      <div key={`n${i}`} className="flex items-center justify-between px-3 py-2 border border-border rounded-md text-sm">
                        <span className="truncate">{f.name}</span>
                        <button onClick={() => setMediaFiles((p) => p.filter((_, idx) => idx !== i))}><X className="h-3.5 w-3.5 text-muted-foreground" /></button>
                      </div>
                    ))}
                  </div>
                )}
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="w-full justify-start gap-2">
                  <Paperclip className="h-3.5 w-3.5" /> Anexar arquivo
                </Button>
                <input ref={fileInputRef} type="file" accept="image/*,video/*,application/pdf" multiple className="hidden"
                  onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
              </div>
              <div className="space-y-1.5">
                <Label>Cliente <span className="text-muted-foreground font-normal text-xs ml-1.5">opcional — habilita "grupo do cliente"</span></Label>
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : contentType === "report" ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Cliente</Label>
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Período</Label>
                <Select value={String(reportPeriodDays)} onValueChange={(v) => setReportPeriodDays(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">7 dias</SelectItem>
                    <SelectItem value="15">15 dias</SelectItem>
                    <SelectItem value="30">30 dias</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Turno</Label>
                <RadioGroup value={summaryTurno} onValueChange={(v) => setSummaryTurno(v as "manha" | "tarde")} className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm cursor-pointer"><RadioGroupItem value="manha" /> Manhã (00h–12h)</label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer"><RadioGroupItem value="tarde" /> Tarde (12h–17h30)</label>
                </RadioGroup>
              </div>
              <div className="space-y-1.5">
                <Label>Clientes no resumo <span className="text-muted-foreground font-normal text-xs ml-1.5">os grupos desses clientes entram</span></Label>
                <div className="max-h-44 overflow-y-auto rounded-md border border-border divide-y divide-border">
                  {clients.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-muted-foreground">Nenhum cliente.</p>
                  ) : (
                    clients.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={summaryClientIds.includes(c.id)}
                          onCheckedChange={(v) =>
                            setSummaryClientIds((prev) => (v === true ? [...prev, c.id] : prev.filter((x) => x !== c.id)))
                          }
                        />
                        <span className="flex-1 truncate">{c.name}</span>
                        {!c.whatsapp_group_id && <span className="text-[10px] text-muted-foreground shrink-0">sem grupo</span>}
                      </label>
                    ))
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {summaryClientIds.length} selecionado{summaryClientIds.length === 1 ? "" : "s"}. Clientes "sem grupo" aparecem no aviso do resumo, mas não são lidos.
                </p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Recorrência</Label>
            <RadioGroup value={recurrenceType} onValueChange={(v) => setRecurrenceType(v as typeof recurrenceType)} className="flex gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer"><RadioGroupItem value="weekly" /> Semanal</label>
              <label className="flex items-center gap-2 text-sm cursor-pointer"><RadioGroupItem value="daily" /> Diária</label>
              <label className="flex items-center gap-2 text-sm cursor-pointer"><RadioGroupItem value="monthly" /> Mensal</label>
            </RadioGroup>

            {recurrenceType === "weekly" && (
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => toggleDay(weekdays, setWeekdays, d.value)}
                    className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${weekdays.includes(d.value) ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"}`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            )}
            {recurrenceType === "monthly" && (
              <div className="flex flex-wrap gap-1">
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDay(monthdays, setMonthdays, d)}
                    className={`w-7 h-7 rounded text-xs border transition-colors ${monthdays.includes(d) ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"}`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Horário (Brasília)</Label>
              <Select value={sendHour} onValueChange={setSendHour}>
                <SelectTrigger className="w-20 h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")).map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                </SelectContent>
              </Select>
              <span>:</span>
              <Select value={sendMinute} onValueChange={setSendMinute}>
                <SelectTrigger className="w-20 h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Destinos</Label>
            {hasClient && (
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={useClientGroup} onCheckedChange={(v) => setUseClientGroup(v === true)} />
                Enviar no grupo do WhatsApp do cliente
              </label>
            )}
            <RecipientSearch selected={customRecipients} onChange={setCustomRecipients} />
          </div>

          {instances.length > 1 && (
            <div className="space-y-1.5">
              <Label>Instância WhatsApp</Label>
              <Select value={instanceId} onValueChange={setInstanceId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Automática (padrão da organização)</SelectItem>
                  {instances.map((i) => <SelectItem key={i.id} value={i.id}>{i.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => saveMut.mutate()} disabled={!canSubmit || saveMut.isPending} className="gap-2">
            {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {editing ? "Salvar" : "Criar automação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
