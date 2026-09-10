import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Plus,
  Send,
  Bot,
  AlertTriangle,
  Check,
  X,
  MessageSquare,
  Sparkles,
  TrendingUp,
  ListChecks,
  Search,
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  agentSendMessage,
  agentExecuteAction,
  agentListConversations,
  agentLoadMessages,
  agentRenameConversation,
  agentDeleteConversation,
  type ChatMessage,
  type PendingAction,
} from "@/lib/agent-chat";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/agente")({
  head: () => ({
    meta: [{ title: "Agente IA — Gestor de Tráfego" }],
  }),
  ssr: false,
  component: AgentePage,
});

interface DisplayMessage {
  id: string;
  role: "user" | "assistant" | "confirmation";
  content?: string;
  pending_action?: PendingAction;
  status?: "waiting" | "confirmed" | "cancelled";
}

const SUGGESTIONS = [
  { icon: Search, label: "Quais clientes estão críticos hoje?", prompt: "Quais clientes estão críticos hoje e por quê?" },
  { icon: TrendingUp, label: "Resumo de performance da semana", prompt: "Me dá um resumo da performance de todos os clientes nos últimos 7 dias." },
  { icon: ListChecks, label: "Sugira otimizações", prompt: "Analise as campanhas ativas e sugira otimizações concretas." },
  { icon: Sparkles, label: "Criar uma tarefa", prompt: "Quero criar uma tarefa para um cliente." },
];

function formatDay(value: string): string {
  const d = new Date(value);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (sameDay) return "Hoje";
  if (d.toDateString() === yest.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function AgentePage() {
  const qc = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const { data: conversations = [] } = useQuery({
    queryKey: ["agent-conversations"],
    queryFn: () => agentListConversations(),
    refetchInterval: 30_000,
  });

  const activeConversation = conversations.find((c) => c.id === conversationId);

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      agentRenameConversation({ data: { conversation_id: id, title } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-conversations"] }),
    onError: () => toast.error("Não foi possível renomear a conversa."),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => agentDeleteConversation({ data: { conversation_id: id } }),
    onSuccess: (_res, id) => {
      qc.invalidateQueries({ queryKey: ["agent-conversations"] });
      if (conversationId === id) {
        setConversationId(null);
        setMessages([]);
      }
    },
    onError: () => toast.error("Não foi possível excluir a conversa."),
  });

  const commitRename = (id: string, raw: string) => {
    const title = raw.trim();
    setEditingId(null);
    const current = conversations.find((c) => c.id === id)?.title ?? "";
    if (title && title !== current) renameMutation.mutate({ id, title });
  };

  const loadMessagesMutation = useMutation({
    mutationFn: (cId: string) => agentLoadMessages({ data: { conversation_id: cId } }),
    onSuccess: (msgs: ChatMessage[]) => {
      setMessages(msgs.map((m, i) => ({ id: `hist-${i}`, ...m })));
    },
  });

  const sendMutation = useMutation({
    mutationFn: async (message: string) => {
      return agentSendMessage({ data: { message, conversation_id: conversationId } });
    },
    onMutate: (message) => {
      setMessages((prev) => [
        ...prev,
        { id: `user-${Date.now()}`, role: "user", content: message },
      ]);
      setIsThinking(true);
    },
    onSuccess: (res) => {
      setIsThinking(false);
      if (res.type !== "error" && !conversationId && res.conversation_id) {
        setConversationId(res.conversation_id);
        qc.invalidateQueries({ queryKey: ["agent-conversations"] });
      }
      if (res.type === "message") {
        setMessages((prev) => [
          ...prev,
          { id: `asst-${Date.now()}`, role: "assistant", content: res.content },
        ]);
      } else if (res.type === "confirmation_required") {
        if (res.partial_response) {
          setMessages((prev) => [
            ...prev,
            { id: `asst-${Date.now()}`, role: "assistant", content: res.partial_response },
          ]);
        }
        setMessages((prev) => [
          ...prev,
          {
            id: `confirm-${Date.now()}`,
            role: "confirmation",
            pending_action: res.pending_action,
            status: "waiting",
          },
        ]);
      } else if (res.type === "error") {
        toast.error(res.message);
        setMessages((prev) => [
          ...prev,
          { id: `err-${Date.now()}`, role: "assistant", content: `❌ ${res.message}` },
        ]);
      }
    },
    onError: (err) => {
      setIsThinking(false);
      toast.error(err instanceof Error ? err.message : "Erro ao enviar mensagem.");
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async ({ action, confirmMsgId }: { action: PendingAction; confirmMsgId: string }) => {
      setMessages((prev) =>
        prev.map((m) => m.id === confirmMsgId ? { ...m, status: "confirmed" as const } : m)
      );
      setIsThinking(true);
      return agentExecuteAction({
        data: { pending_action: action, conversation_id: conversationId! },
      });
    },
    onSuccess: (res) => {
      setIsThinking(false);
      if (res.type === "message") {
        setMessages((prev) => [
          ...prev,
          { id: `asst-${Date.now()}`, role: "assistant", content: res.content },
        ]);
      } else if (res.type === "error") {
        toast.error(res.message);
      }
    },
    onError: () => { setIsThinking(false); toast.error("Erro ao executar ação."); },
  });

  const cancelAction = (confirmMsgId: string) => {
    setMessages((prev) =>
      prev.map((m) => m.id === confirmMsgId ? { ...m, status: "cancelled" as const } : m)
    );
    setMessages((prev) => [
      ...prev,
      { id: `asst-${Date.now()}`, role: "assistant", content: "Ok, ação cancelada." },
    ]);
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const busy = isThinking || sendMutation.isPending;

  const runPrompt = (msg: string) => {
    const trimmed = msg.trim();
    if (!trimmed || busy) return;
    setInput("");
    sendMutation.mutate(trimmed);
  };

  const handleSend = () => runPrompt(input);

  const startNewConversation = () => {
    setConversationId(null);
    setMessages([]);
  };

  const selectConversation = (cId: string) => {
    setConversationId(cId);
    setMessages([]);
    loadMessagesMutation.mutate(cId);
  };

  return (
    <AppShell>
      <div className="flex h-[100dvh] md:h-screen overflow-hidden bg-background">

        {/* Sidebar de conversas */}
        <aside className="hidden md:flex w-64 flex-col border-r border-border bg-card/40 shrink-0">
          <div className="p-3">
            <Button
              size="sm"
              className="w-full gap-2 justify-start font-medium"
              onClick={startNewConversation}
            >
              <Plus className="h-4 w-4" />
              Nova conversa
            </Button>
          </div>
          <div className="px-4 pb-1.5 pt-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Histórico
            </span>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 pt-1 space-y-0.5">
              {conversations.length === 0 && (
                <p className="text-xs text-muted-foreground/70 text-center py-8 px-4">
                  Suas conversas com o agente aparecem aqui.
                </p>
              )}
              {conversations.map((c) => {
                const active = conversationId === c.id;
                const editing = editingId === c.id;
                return (
                  <div
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => !editing && selectConversation(c.id)}
                    onKeyDown={(e) => {
                      if (!editing && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        selectConversation(c.id);
                      }
                    }}
                    className={cn(
                      "group relative w-full cursor-pointer rounded-lg px-3 py-2 text-left transition-colors",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
                    )}
                  >
                    {active && (
                      <span className="absolute left-0 top-3 h-5 w-0.5 rounded-full bg-primary" />
                    )}

                    {editing ? (
                      <input
                        autoFocus
                        defaultValue={c.title ?? ""}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter") {
                            e.preventDefault();
                            commitRename(c.id, e.currentTarget.value);
                          } else if (e.key === "Escape") {
                            setEditingId(null);
                          }
                        }}
                        onBlur={(e) => commitRename(c.id, e.currentTarget.value)}
                        className="w-full rounded-md border border-primary/50 bg-background px-2 py-1 text-[13px] font-medium text-foreground outline-none"
                      />
                    ) : (
                      <>
                        <div className="flex min-w-0 items-start gap-2 pr-12">
                          <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" />
                          <span className="min-w-0 flex-1 whitespace-normal break-words text-[13px] font-medium leading-snug">
                            {c.title ?? "Conversa"}
                          </span>
                        </div>
                        <div className="mt-0.5 pl-[22px] text-[10px] text-muted-foreground/60">
                          {formatDay(c.last_msg_at)}
                        </div>

                        <div className="absolute right-1.5 top-1.5 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                          <button
                            type="button"
                            title="Renomear"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingId(c.id);
                            }}
                            className="rounded-md p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Excluir"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm(`Excluir a conversa "${c.title ?? "sem título"}"? Isso apaga o histórico dela.`)) {
                                deleteMutation.mutate(c.id);
                              }
                            }}
                            className="rounded-md p-1 text-muted-foreground hover:bg-background hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </aside>

        {/* Área principal de chat */}
        <div className="flex flex-1 flex-col min-w-0">
          {/* Header */}
          <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3 md:px-6">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/60 shadow-sm">
              <Bot className="h-[18px] w-[18px] text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold leading-tight">
                {activeConversation?.title ?? "Agente IA"}
              </div>
              <div className="text-[11px] text-muted-foreground">
                Gestor de tráfego secundário · GPT-4o
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto gap-1.5 text-xs md:hidden"
              onClick={startNewConversation}
            >
              <Plus className="h-3.5 w-3.5" />
              Nova
            </Button>
          </header>

          {/* Mensagens */}
          <ScrollArea className="flex-1">
            <div className="mx-auto max-w-3xl px-4 py-6 md:px-6 md:py-8">
              {messages.length === 0 && !isThinking ? (
                <div className="flex flex-col items-center pt-10 text-center md:pt-16">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/60 shadow-md">
                    <Bot className="h-7 w-7 text-primary-foreground" />
                  </div>
                  <h2 className="text-lg font-semibold">Como posso ajudar hoje?</h2>
                  <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                    Pergunte sobre um cliente, peça uma análise das campanhas ou crie uma tarefa.
                  </p>
                  <div className="mt-6 grid w-full max-w-lg gap-2 sm:grid-cols-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s.label}
                        onClick={() => runPrompt(s.prompt)}
                        className="group flex items-start gap-2.5 rounded-xl border border-border bg-card px-3.5 py-3 text-left text-sm transition-colors hover:border-primary/40 hover:bg-accent"
                      >
                        <s.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span className="leading-snug text-foreground/90">{s.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  {messages.map((msg) => {
                    if (msg.role === "user") {
                      return (
                        <div key={msg.id} className="flex justify-end">
                          <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground shadow-sm">
                            {msg.content}
                          </div>
                        </div>
                      );
                    }

                    if (msg.role === "assistant") {
                      return (
                        <div key={msg.id} className="flex items-start gap-3">
                          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/15">
                            <Bot className="h-4 w-4 text-primary" />
                          </div>
                          <div className="min-w-0 flex-1 whitespace-pre-wrap pt-0.5 text-sm leading-relaxed text-foreground/90">
                            {msg.content}
                          </div>
                        </div>
                      );
                    }

                    if (msg.role === "confirmation" && msg.pending_action) {
                      const isDone = msg.status === "confirmed" || msg.status === "cancelled";
                      return (
                        <div key={msg.id} className="flex items-start gap-3">
                          <div
                            className={cn(
                              "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                              msg.status === "confirmed"
                                ? "bg-status-on-target/20"
                                : msg.status === "cancelled"
                                  ? "bg-muted"
                                  : "bg-status-attention/20"
                            )}
                          >
                            {msg.status === "confirmed" ? (
                              <Check className="h-4 w-4 text-status-on-target" />
                            ) : msg.status === "cancelled" ? (
                              <X className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <AlertTriangle className="h-4 w-4 text-status-attention" />
                            )}
                          </div>
                          <div
                            className={cn(
                              "min-w-0 flex-1 rounded-xl border px-4 py-3 text-sm",
                              msg.status === "confirmed"
                                ? "border-status-on-target/30 bg-status-on-target/10"
                                : msg.status === "cancelled"
                                  ? "border-border bg-muted opacity-60"
                                  : "border-status-attention/30 bg-status-attention/10"
                            )}
                          >
                            <p
                              className={cn(
                                "mb-1.5 text-xs font-semibold",
                                msg.status === "confirmed"
                                  ? "text-status-on-target"
                                  : msg.status === "cancelled"
                                    ? "text-muted-foreground"
                                    : "text-status-attention"
                              )}
                            >
                              {msg.status === "confirmed"
                                ? "Ação executada"
                                : msg.status === "cancelled"
                                  ? "Cancelado"
                                  : "Confirmação necessária"}
                            </p>
                            <p className="leading-snug text-foreground/90">{msg.pending_action.description}</p>
                            {!isDone && (
                              <div className="mt-3 flex gap-2">
                                <Button
                                  size="sm"
                                  className="h-7 bg-status-on-target text-xs text-white hover:opacity-90"
                                  onClick={() => confirmMutation.mutate({ action: msg.pending_action!, confirmMsgId: msg.id })}
                                  disabled={confirmMutation.isPending}
                                >
                                  <Check className="mr-1 h-3.5 w-3.5" />
                                  Confirmar
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  onClick={() => cancelAction(msg.id)}
                                >
                                  <X className="mr-1 h-3.5 w-3.5" />
                                  Cancelar
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    }

                    return null;
                  })}

                  {isThinking && (
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/15">
                        <Bot className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex items-center gap-1 pt-2">
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:0ms]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:150ms]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:300ms]" />
                      </div>
                    </div>
                  )}

                  <div ref={bottomRef} />
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Input */}
          <div className="shrink-0 border-t border-border bg-background px-4 py-3 md:px-6 md:py-4">
            <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-border bg-card px-3 py-2 shadow-sm focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20">
              <textarea
                ref={taRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                rows={1}
                placeholder="Pergunte algo ou peça uma ação..."
                disabled={busy}
                className="max-h-40 flex-1 resize-none bg-transparent py-1.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/70 disabled:opacity-60"
              />
              <Button
                size="icon"
                className="h-8 w-8 shrink-0 rounded-xl"
                onClick={handleSend}
                disabled={!input.trim() || busy}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <p className="mx-auto mt-1.5 max-w-3xl px-1 text-[10px] text-muted-foreground/60">
              Enter envia · Shift+Enter quebra linha
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
