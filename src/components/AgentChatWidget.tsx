import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Send, Bot, User, AlertTriangle, Check, X, Download } from "lucide-react";
import { toast } from "sonner";
import { jsPDF } from "jspdf";
import {
  agentSendMessage,
  agentExecuteAction,
  agentListConversations,
  agentLoadMessages,
  type PendingAction,
  type AgentMode,
} from "@/lib/agent-chat";
import { cn } from "@/lib/utils";

interface DisplayMessage {
  id: string;
  role: "user" | "assistant" | "confirmation";
  content?: string;
  pending_action?: PendingAction;
  status?: "waiting" | "confirmed" | "cancelled";
}

interface RoteiroSection {
  heading: string;
  lines: string[];
}

/**
 * Extrai só o essencial do texto do roteiro pro PDF: nome do veículo (título),
 * e por seção (ROTEIRO 1, ROTEIRO 2...) só as falas entre aspas — sem o
 * parágrafo de introdução, sem os subtítulos (GANCHO, QUALIFICAÇÃO etc.) e
 * sem marcação de markdown (**).
 */
function parseRoteiroContent(content: string): { title: string; sections: RoteiroSection[] } {
  const veiculoMatch = content.match(/VE[ÍI]CULO:\s*(.+)/i);
  const title = veiculoMatch ? veiculoMatch[1].trim() : "Roteiro de Vídeo";

  // Divide o texto a cada título (### ...) — o texto antes do primeiro título
  // (introdução + linha "VEÍCULO:") é descartado de propósito.
  let blocks = content.split(/^#{1,6}\s*/m).slice(1);

  // Fallback: se o modelo não usou "###", tenta dividir direto em "ROTEIRO N".
  if (blocks.length === 0) {
    blocks = content.split(/(?=ROTEIRO\s*\d)/i).filter((b) => /^ROTEIRO\s*\d/i.test(b.trim()));
  }

  const sections: RoteiroSection[] = [];
  for (const block of blocks) {
    const breakIdx = block.indexOf("\n");
    const rawHeading = breakIdx === -1 ? block : block.slice(0, breakIdx);
    const heading = rawHeading.replace(/\*\*/g, "").replace(/^#+\s*/, "").trim();
    if (!/^ROTEIRO/i.test(heading)) continue;

    const body = breakIdx === -1 ? "" : block.slice(breakIdx + 1);
    const lines = Array.from(body.matchAll(/"([^"]+)"/g)).map((m) => m[1].trim());
    sections.push({ heading, lines });
  }

  return { title, sections };
}

const MODE_TABS: Array<{ mode: AgentMode; label: string }> = [
  { mode: "trafego", label: "Tráfego" },
  { mode: "copy_automotivo", label: "Copy" },
  { mode: "roteiro_automotivo", label: "Roteiro" },
];

export function AgentChatWidget({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<AgentMode>("trafego");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: conversations = [] } = useQuery({
    queryKey: ["agent-conversations"],
    queryFn: () => agentListConversations(),
    staleTime: 1000 * 10,
  });

  const loadMessagesMutation = useMutation({
    mutationFn: (cId: string) => agentLoadMessages({ data: { conversation_id: cId } }),
    onSuccess: (msgs) => {
      setMessages(msgs.map((m, i) => ({ id: `hist-${i}`, ...m })));
    },
  });

  const selectMode = (newMode: AgentMode) => {
    setMode(newMode);
    const latest = conversations.find((c) => c.mode === newMode);
    if (latest) {
      setConversationId(latest.id);
      setMessages([]);
      loadMessagesMutation.mutate(latest.id);
    } else {
      setConversationId(null);
      setMessages([]);
    }
  };

  const sendMutation = useMutation({
    mutationFn: async (message: string) => {
      return agentSendMessage({ data: { message, conversation_id: conversationId, mode } });
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

  const downloadPdf = (content: string) => {
    const { title, sections } = parseRoteiroContent(content);

    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const marginX = 48;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const usableWidth = pageWidth - marginX * 2;
    const topMargin = 56;
    const bottomMargin = 60;

    const ACCENT: [number, number, number] = [217, 119, 6]; // laranja da marca
    const INK: [number, number, number] = [30, 30, 30];
    const MUTED: [number, number, number] = [130, 130, 130];

    let y = topMargin;
    let pageNum = 1;

    const addFooter = () => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...MUTED);
      doc.text(String(pageNum), pageWidth - marginX, pageHeight - 28, { align: "right" });
    };

    const ensureSpace = (needed: number) => {
      if (y + needed > pageHeight - bottomMargin) {
        addFooter();
        doc.addPage();
        pageNum += 1;
        y = topMargin;
      }
    };

    // Título (nome do veículo)
    doc.setFont("helvetica", "bold");
    doc.setFontSize(19);
    doc.setTextColor(...INK);
    const titleLines = doc.splitTextToSize(title, usableWidth);
    doc.text(titleLines, marginX, y);
    y += titleLines.length * 24;

    // Linha de destaque abaixo do título
    doc.setDrawColor(...ACCENT);
    doc.setLineWidth(2);
    doc.line(marginX, y, marginX + 60, y);
    y += 30;

    sections.forEach((section, idx) => {
      ensureSpace(50);

      // Selo colorido "ROTEIRO N"
      doc.setFillColor(...ACCENT);
      doc.roundedRect(marginX, y - 14, 16, 16, 3, 3, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(String(idx + 1), marginX + 8, y - 2.5, { align: "center" });

      doc.setTextColor(...ACCENT);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      const headingLines = doc.splitTextToSize(section.heading, usableWidth - 24);
      doc.text(headingLines, marginX + 24, y);
      y += headingLines.length * 16 + 14;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(11.5);
      doc.setTextColor(...INK);

      section.lines.forEach((paragraph) => {
        const wrapped = doc.splitTextToSize(paragraph, usableWidth);
        ensureSpace(wrapped.length * 17 + 12);
        doc.text(wrapped, marginX, y);
        y += wrapped.length * 17 + 12;
      });

      if (idx < sections.length - 1) {
        y += 6;
        ensureSpace(20);
        doc.setDrawColor(225, 225, 225);
        doc.setLineWidth(0.75);
        doc.line(marginX, y, pageWidth - marginX, y);
        y += 26;
      }
    });

    addFooter();
    doc.save(`roteiro-${Date.now()}.pdf`);
  };

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
          <div className="text-[10px] text-muted-foreground">GPT-4o</div>
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

      {/* Abas de modo */}
      <div className="flex border-b border-border shrink-0">
        {MODE_TABS.map((tab) => (
          <button
            key={tab.mode}
            onClick={() => selectMode(tab.mode)}
            className={cn(
              "flex-1 text-xs font-medium py-2 transition-colors border-b-2 -mb-px",
              mode === tab.mode
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Mensagens */}
      <ScrollArea className="flex-1">
        <div className="px-3 py-4 space-y-3">
          {messages.length === 0 && !isThinking && (
            <div className="text-center py-10">
              <Bot className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">
                {mode === "trafego" && "Olá! Estou analisando as campanhas."}
                {mode === "copy_automotivo" && "Manda os dados do veículo que eu crio a copy."}
                {mode === "roteiro_automotivo" && "Manda os dados do veículo que eu crio o roteiro."}
              </p>
              <p className="text-[11px] text-muted-foreground/60 mt-1 px-4">
                {mode === "trafego"
                  ? "Pergunte sobre um cliente, sugira otimizações ou peça pra criar uma tarefa."
                  : "Envie modelo, versão, ano, km, preço, diferenciais, cidade/região e condições comerciais."}
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
                  <div className="flex flex-col gap-1.5 min-w-0">
                    <div className="bg-muted/50 border border-border rounded-2xl rounded-tl-sm px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap">
                      {msg.content}
                    </div>
                    {mode === "roteiro_automotivo" && msg.content && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[11px] px-2 self-start gap-1"
                        onClick={() => downloadPdf(msg.content!)}
                      >
                        <Download className="h-3 w-3" />
                        Baixar PDF
                      </Button>
                    )}
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
