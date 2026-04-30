import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Send, Bot, User, AlertTriangle, Check, X, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import {
  agentSendMessage,
  agentExecuteAction,
  agentListConversations,
  agentLoadMessages,
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

function AgentePage() {
  const qc = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: conversations = [] } = useQuery({
    queryKey: ["agent-conversations"],
    queryFn: () => agentListConversations(),
    refetchInterval: 30_000,
  });

  const loadMessagesMutation = useMutation({
    mutationFn: (cId: string) => agentLoadMessages({ data: { conversation_id: cId } }),
    onSuccess: (msgs: ChatMessage[]) => {
      setMessages(msgs.map((m, i) => ({ id: `hist-${i}`, ...m })));
    },
  });

  const sendMutation = useMutation({
    mutationFn: async (message: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Não autenticado.");
      return agentSendMessage({ data: { message, conversation_id: conversationId, user_id: user.id } });
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Não autenticado.");
      setMessages((prev) =>
        prev.map((m) => m.id === confirmMsgId ? { ...m, status: "confirmed" as const } : m)
      );
      setIsThinking(true);
      return agentExecuteAction({
        data: { pending_action: action, conversation_id: conversationId!, user_id: user.id },
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

  const handleSend = () => {
    const msg = input.trim();
    if (!msg || sendMutation.isPending || isThinking) return;
    setInput("");
    sendMutation.mutate(msg);
  };

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
      <div className="flex h-[calc(100vh-0px)] md:h-screen overflow-hidden">

        {/* Sidebar de conversas */}
        <aside className="hidden md:flex w-56 flex-col border-r border-border bg-card/30 shrink-0">
          <div className="p-3 border-b border-border">
            <Button size="sm" variant="outline" className="w-full gap-2 text-xs" onClick={startNewConversation}>
              <Plus className="h-3.5 w-3.5" />
              Nova conversa
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {conversations.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">Nenhuma conversa ainda.</p>
              )}
              {conversations.map((c) => (
                <button
                  key={c.id}
                  onClick={() => selectConversation(c.id)}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-md text-xs transition-colors",
                    conversationId === c.id
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-3 w-3 shrink-0" />
                    <span className="truncate">{c.title ?? "Conversa"}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground/60 mt-0.5 pl-5">
                    {new Date(c.last_msg_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </aside>

        {/* Área principal de chat */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="px-4 py-3 border-b border-border flex items-center gap-2 shrink-0">
            <div className="h-7 w-7 rounded-md bg-primary/20 flex items-center justify-center">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <div>
              <div className="text-sm font-semibold">Agente IA</div>
              <div className="text-[10px] text-muted-foreground">Gestor de tráfego secundário · GPT-4o</div>
            </div>
            <Button size="sm" variant="ghost" className="ml-auto md:hidden gap-1.5 text-xs" onClick={startNewConversation}>
              <Plus className="h-3.5 w-3.5" />
              Nova
            </Button>
          </div>

          {/* Mensagens */}
          <ScrollArea className="flex-1">
            <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
              {messages.length === 0 && !isThinking && (
                <div className="text-center py-16">
                  <Bot className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">Olá! Estou analisando as campanhas.</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Pergunte sobre um cliente, sugira otimizações ou peça para criar uma tarefa.</p>
                </div>
              )}

              {messages.map((msg) => {
                if (msg.role === "user") {
                  return (
                    <div key={msg.id} className="flex justify-end">
                      <div className="flex items-start gap-2 max-w-[80%]">
                        <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed">
                          {msg.content}
                        </div>
                        <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                          <User className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                      </div>
                    </div>
                  );
                }

                if (msg.role === "assistant") {
                  return (
                    <div key={msg.id} className="flex items-start gap-2 max-w-[85%]">
                      <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                        <Bot className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
                        {msg.content}
                      </div>
                    </div>
                  );
                }

                if (msg.role === "confirmation" && msg.pending_action) {
                  const isDone = msg.status === "confirmed" || msg.status === "cancelled";
                  return (
                    <div key={msg.id} className="flex items-start gap-2 max-w-[85%]">
                      <div className="h-7 w-7 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0 mt-0.5">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                      </div>
                      <div className={cn(
                        "border rounded-2xl rounded-tl-sm px-4 py-3 text-sm",
                        msg.status === "confirmed" ? "bg-green-950/30 border-green-800" :
                        msg.status === "cancelled" ? "bg-muted border-border opacity-60" :
                        "bg-amber-950/30 border-amber-800"
                      )}>
                        <p className={cn(
                          "text-xs font-semibold mb-1.5",
                          msg.status === "confirmed" ? "text-green-400" :
                          msg.status === "cancelled" ? "text-muted-foreground" :
                          "text-amber-400"
                        )}>
                          {msg.status === "confirmed" ? "✓ Ação executada" :
                           msg.status === "cancelled" ? "✗ Cancelado" :
                           "⚠ Confirmação necessária"}
                        </p>
                        <p className="text-foreground/90 leading-snug">{msg.pending_action.description}</p>
                        {!isDone && (
                          <div className="flex gap-2 mt-3">
                            <Button
                              size="sm"
                              className="h-7 text-xs bg-green-700 hover:bg-green-600"
                              onClick={() => confirmMutation.mutate({ action: msg.pending_action!, confirmMsgId: msg.id })}
                              disabled={confirmMutation.isPending}
                            >
                              <Check className="h-3.5 w-3.5 mr-1" />
                              Confirmar
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => cancelAction(msg.id)}
                            >
                              <X className="h-3.5 w-3.5 mr-1" />
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
                <div className="flex items-start gap-2">
                  <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                    <Bot className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3">
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0ms]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:150ms]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:300ms]" />
                    </div>
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          {/* Input */}
          <div className="px-4 py-3 border-t border-border shrink-0">
            <div className="max-w-2xl mx-auto flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder="Pergunte algo ou peça uma ação..."
                disabled={isThinking || sendMutation.isPending}
                className="text-sm"
              />
              <Button
                size="icon"
                onClick={handleSend}
                disabled={!input.trim() || isThinking || sendMutation.isPending}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
