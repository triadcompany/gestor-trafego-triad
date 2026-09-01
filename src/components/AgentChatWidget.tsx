import { useState, useRef, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Send, Bot, User, AlertTriangle, Check, X } from "lucide-react";
import { toast } from "sonner";
import {
  agentSendMessage,
  agentExecuteAction,
  type PendingAction,
} from "@/lib/agent-chat";
import { cn } from "@/lib/utils";

interface DisplayMessage {
  id: string;
  role: "user" | "assistant" | "confirmation";
  content?: string;
  pending_action?: PendingAction;
  status?: "waiting" | "confirmed" | "cancelled";
}

export function AgentChatWidget({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const sendMutation = useMutation({
    mutationFn: async (message: string) => {
      return agentSendMessage({ data: { message, conversation_id: conversationId } });
    },
    onMutate: (message) => {
      setMessages((prev) => [...prev, { id: `user-${Date.now()}`, role: "user", content: message }]);
      setIsThinking(true);
    },
    onSuccess: (res) => {
      setIsThinking(false);
      if (res.type !== "error" && !conversationId && res.conversation_id) {
        setConversationId(res.conversation_id);
        qc.invalidateQueries({ queryKey: ["agent-conversations"] });
      }
      if (res.type === "message") {
        setMessages((prev) => [...prev, { id: `asst-${Date.now()}`, role: "assistant", content: res.content }]);
      } else if (res.type === "confirmation_required") {
        if (res.partial_response) {
          setMessages((prev) => [...prev, { id: `asst-${Date.now()}`, role: "assistant", content: res.partial_response }]);
        }
        setMessages((prev) => [
          ...prev,
          { id: `confirm-${Date.now()}`, role: "confirmation", pending_action: res.pending_action, status: "waiting" },
        ]);
      } else if (res.type === "error") {
        toast.error(res.message);
        setMessages((prev) => [...prev, { id: `err-${Date.now()}`, role: "assistant", content: `❌ ${res.message}` }]);
      }
    },
    onError: (err) => {
      setIsThinking(false);
      toast.error(err instanceof Error ? err.message : "Erro ao enviar mensagem.");
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async ({ action, confirmMsgId }: { action: PendingAction; confirmMsgId: string }) => {
      setMessages((prev) => prev.map((m) => (m.id === confirmMsgId ? { ...m, status: "confirmed" as const } : m)));
      setIsThinking(true);
      return agentExecuteAction({ data: { pending_action: action, conversation_id: conversationId! } });
    },
    onSuccess: (res) => {
      setIsThinking(false);
      if (res.type === "message") {
        setMessages((prev) => [...prev, { id: `asst-${Date.now()}`, role: "assistant", content: res.content }]);
      } else if (res.type === "error") {
        toast.error(res.message);
      }
    },
    onError: () => {
      setIsThinking(false);
      toast.error("Erro ao executar ação.");
    },
  });

  const cancelAction = (confirmMsgId: string) => {
    setMessages((prev) => prev.map((m) => (m.id === confirmMsgId ? { ...m, status: "cancelled" as const } : m)));
    setMessages((prev) => [...prev, { id: `asst-${Date.now()}`, role: "assistant", content: "Ok, ação cancelada." }]);
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

  return (
    <div className="fixed bottom-20 right-4 md:right-6 z-50 w-[92vw] max-w-[380px] h-[70vh] max-h-[560px] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-2 shrink-0">
        <div className="h-7 w-7 rounded-md bg-primary/20 flex items-center justify-center">
          <Bot className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold">Agente IA</div>
          <div className="text-[10px] text-muted-foreground">Gestor de tráfego secundário · GPT-4o</div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={startNewConversation} title="Nova conversa">
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose} title="Fechar">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Mensagens */}
      <ScrollArea className="flex-1">
        <div className="px-3 py-4 space-y-3">
          {messages.length === 0 && !isThinking && (
            <div className="text-center py-10">
              <Bot className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">Olá! Estou analisando as campanhas.</p>
              <p className="text-[11px] text-muted-foreground/60 mt-1 px-4">
                Pergunte sobre um cliente, sugira otimizações ou peça pra criar uma tarefa.
              </p>
            </div>
          )}

          {messages.map((msg) => {
            if (msg.role === "user") {
              return (
                <div key={msg.id} className="flex justify-end">
                  <div className="flex items-start gap-1.5 max-w-[85%]">
                    <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-3 py-2 text-sm leading-relaxed">
                      {msg.content}
                    </div>
                    <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                      <User className="h-3 w-3 text-muted-foreground" />
                    </div>
                  </div>
                </div>
              );
            }

            if (msg.role === "assistant") {
              return (
                <div key={msg.id} className="flex items-start gap-1.5 max-w-[90%]">
                  <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="h-3 w-3 text-primary" />
                  </div>
                  <div className="bg-muted/50 border border-border rounded-2xl rounded-tl-sm px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap">
                    {msg.content}
                  </div>
                </div>
              );
            }

            if (msg.role === "confirmation" && msg.pending_action) {
              const isDone = msg.status === "confirmed" || msg.status === "cancelled";
              return (
                <div key={msg.id} className="flex items-start gap-1.5 max-w-[90%]">
                  <div className="h-6 w-6 rounded-full bg-status-attention/20 flex items-center justify-center shrink-0 mt-0.5">
                    <AlertTriangle className="h-3 w-3 text-status-attention" />
                  </div>
                  <div
                    className={cn(
                      "border rounded-2xl rounded-tl-sm px-3 py-2.5 text-sm",
                      msg.status === "confirmed"
                        ? "bg-status-on-target/10 border-status-on-target/30"
                        : msg.status === "cancelled"
                        ? "bg-muted border-border opacity-60"
                        : "bg-status-attention/10 border-status-attention/30"
                    )}
                  >
                    <p
                      className={cn(
                        "text-xs font-semibold mb-1",
                        msg.status === "confirmed"
                          ? "text-status-on-target"
                          : msg.status === "cancelled"
                          ? "text-muted-foreground"
                          : "text-status-attention"
                      )}
                    >
                      {msg.status === "confirmed" ? "✓ Ação executada" : msg.status === "cancelled" ? "✗ Cancelado" : "⚠ Confirmação necessária"}
                    </p>
                    <p className="text-foreground/90 leading-snug text-xs">{msg.pending_action.description}</p>
                    {!isDone && (
                      <div className="flex gap-2 mt-2.5">
                        <Button
                          size="sm"
                          className="h-6 text-[11px] px-2 bg-status-on-target hover:opacity-90 text-white"
                          onClick={() => confirmMutation.mutate({ action: msg.pending_action!, confirmMsgId: msg.id })}
                          disabled={confirmMutation.isPending}
                        >
                          <Check className="h-3 w-3 mr-1" />
                          Confirmar
                        </Button>
                        <Button size="sm" variant="outline" className="h-6 text-[11px] px-2" onClick={() => cancelAction(msg.id)}>
                          <X className="h-3 w-3 mr-1" />
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
            <div className="flex items-start gap-1.5">
              <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                <Bot className="h-3 w-3 text-primary" />
              </div>
              <div className="bg-muted/50 border border-border rounded-2xl rounded-tl-sm px-3 py-2.5">
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
      <div className="px-3 py-2.5 border-t border-border shrink-0">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Pergunte algo ou peça uma ação..."
            disabled={isThinking || sendMutation.isPending}
            className="text-sm h-9"
          />
          <Button size="icon" className="h-9 w-9 shrink-0" onClick={handleSend} disabled={!input.trim() || isThinking || sendMutation.isPending}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
