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
import { Plus, Search, Loader2, X, Paperclip, ChevronDown, Users, Send } from "lucide-react";
import { toast } from "sonner";
import {
  fetchScheduledMessages,
  createScheduledMessage,
  cancelScheduledMessage,
  searchEvolutionRecipients,
  type ScheduledMessageRow,
  type EvolutionRecipient,
} from "@/lib/whatsapp-messages";

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

  return (
    <AppShell>
      <div className="px-4 md:px-8 py-6 max-w-4xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Mensagens</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Programe mensagens de WhatsApp para pessoas ou grupos específicos.
            </p>
          </div>
          <Button onClick={() => setComposerOpen(true)} className="gap-2 w-full sm:w-auto">
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
                    {m.has_media && <Paperclip className="h-3 w-3 text-muted-foreground" />}
                  </div>
                  <p className="text-sm text-foreground/90 line-clamp-2">{m.body}</p>
                  <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground min-w-0">
                    <Users className="h-3 w-3 shrink-0" />
                    <span className="truncate">{m.recipients.map((r) => r.name).join(", ")}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {m.status === "pending" && (
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
      </div>

      <ComposerDialog open={composerOpen} onOpenChange={setComposerOpen} />
    </AppShell>
  );
}

// ── Composer ───────────────────────────────────────────────────

function ComposerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [recipients, setRecipients] = useState<EvolutionRecipient[]>([]);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setBody("");
    setScheduledAt("");
    setRecipients([]);
    setMediaFile(null);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      let mediaBase64: string | null = null;
      let mediaMimetype: string | null = null;
      let mediaFilename: string | null = null;
      if (mediaFile) {
        if (mediaFile.size > 16 * 1024 * 1024) {
          throw new Error("Arquivo muito grande (limite de 16MB).");
        }
        mediaBase64 = await fileToBase64(mediaFile);
        mediaMimetype = mediaFile.type;
        mediaFilename = mediaFile.name;
      }
      await createScheduledMessage({
        body,
        mediaBase64,
        mediaMimetype,
        mediaFilename,
        scheduledAt: new Date(scheduledAt).toISOString(),
        recipients: recipients.map((r) => ({ remoteJid: r.remoteJid, name: r.name })),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduled-messages"] });
      toast.success("Mensagem agendada.");
      reset();
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao agendar mensagem", { duration: 8000 }),
  });

  const isPast = scheduledAt !== "" && new Date(scheduledAt) <= new Date();
  const canSubmit = body.trim().length > 0 && recipients.length > 0 && scheduledAt !== "" && !isPast;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova mensagem agendada</DialogTitle>
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
              <span className="text-muted-foreground font-normal text-xs ml-1.5">opcional</span>
            </Label>
            {mediaFile ? (
              <div className="flex items-center justify-between px-3 py-2 border border-border rounded-md text-sm">
                <span className="truncate">{mediaFile.name}</span>
                <button onClick={() => setMediaFile(null)}>
                  <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                </button>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="gap-2">
                <Paperclip className="h-3.5 w-3.5" />
                Anexar imagem, vídeo ou documento
              </Button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*,application/pdf"
              className="hidden"
              onChange={(e) => setMediaFile(e.target.files?.[0] ?? null)}
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
            onClick={() => createMutation.mutate()}
            disabled={!canSubmit || createMutation.isPending}
            className="gap-2"
          >
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Agendar
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
