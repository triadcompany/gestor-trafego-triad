import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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

// ── Janela flutuante: tamanho/posição arrastáveis e redimensionáveis ────────
const DEFAULT_WIDTH = 380;
const DEFAULT_HEIGHT = 520;
const MIN_WIDTH = 300;
const MIN_HEIGHT = 340;

interface Pos { x: number; y: number }
interface Size { width: number; height: number }

function loadStored<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function saveStored(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage indisponível (aba privada etc.) — segue sem persistir
  }
}

function defaultPos(size: Size): Pos {
  if (typeof window === "undefined") return { x: 24, y: 24 };
  return {
    x: window.innerWidth - size.width - 24,
    y: window.innerHeight - size.height - 96,
  };
}

function clampPos(p: Pos, size: Size): Pos {
  if (typeof window === "undefined") return p;
  const maxX = Math.max(8, window.innerWidth - size.width - 8);
  const maxY = Math.max(8, window.innerHeight - size.height - 8);
  return { x: Math.min(Math.max(p.x, 8), maxX), y: Math.min(Math.max(p.y, 8), maxY) };
}

type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export function AgentChatWidget({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<AgentMode>("trafego");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [size, setSize] = useState<Size>(() => loadStored<Size>("agent-widget-size") ?? { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const [pos, setPos] = useState<Pos>(() => {
    const stored = loadStored<Pos>("agent-widget-pos");
    const initialSize = loadStored<Size>("agent-widget-size") ?? { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
    return stored ? clampPos(stored, initialSize) : defaultPos(initialSize);
  });

  useEffect(() => saveStored("agent-widget-size", size), [size]);
  useEffect(() => saveStored("agent-widget-pos", pos), [pos]);

  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPos(clampPos({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy }, size));
  };
  const onHeaderPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const resizeRef = useRef<{ dir: ResizeDir; startX: number; startY: number; origW: number; origH: number; origX: number; origY: number } | null>(null);

  const makeResizeHandlers = useCallback((dir: ResizeDir) => ({
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      resizeRef.current = { dir, startX: e.clientX, startY: e.clientY, origW: size.width, origH: size.height, origX: pos.x, origY: pos.y };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      const st = resizeRef.current;
      if (!st) return;
      const dx = e.clientX - st.startX;
      const dy = e.clientY - st.startY;
      let newW = st.origW;
      let newH = st.origH;
      let newX = st.origX;
      let newY = st.origY;
      const maxW = window.innerWidth - 16;
      const maxH = window.innerHeight - 16;
      if (st.dir.includes("e")) newW = Math.min(maxW, Math.max(MIN_WIDTH, st.origW + dx));
      if (st.dir.includes("s")) newH = Math.min(maxH, Math.max(MIN_HEIGHT, st.origH + dy));
      if (st.dir.includes("w")) {
        newW = Math.min(maxW, Math.max(MIN_WIDTH, st.origW - dx));
        newX = st.origX + (st.origW - newW);
      }
      if (st.dir.includes("n")) {
        newH = Math.min(maxH, Math.max(MIN_HEIGHT, st.origH - dy));
        newY = st.origY + (st.origH - newH);
      }
      setSize({ width: newW, height: newH });
      setPos({ x: newX, y: newY });
    },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
      resizeRef.current = null;
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
  }), [size, pos]);

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

  // Volta o textarea pra altura mínima depois de limpar a mensagem enviada
  useEffect(() => {
    if (!input && textareaRef.current) textareaRef.current.style.height = "auto";
  }, [input]);

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

  const resizeHandleClass = "absolute z-10";

  return (
    <div
      className="fixed z-50 bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
      style={{ left: pos.x, top: pos.y, width: size.width, height: size.height, maxWidth: "calc(100vw - 16px)", maxHeight: "calc(100vh - 16px)" }}
    >
      {/* Alças de redimensionar — bordas e cantos */}
      <div {...makeResizeHandlers("n")} className={cn(resizeHandleClass, "top-0 left-2 right-2 h-1.5 cursor-ns-resize")} style={{ touchAction: "none" }} />
      <div {...makeResizeHandlers("s")} className={cn(resizeHandleClass, "bottom-0 left-2 right-2 h-1.5 cursor-ns-resize")} style={{ touchAction: "none" }} />
      <div {...makeResizeHandlers("w")} className={cn(resizeHandleClass, "left-0 top-2 bottom-2 w-1.5 cursor-ew-resize")} style={{ touchAction: "none" }} />
      <div {...makeResizeHandlers("e")} className={cn(resizeHandleClass, "right-0 top-2 bottom-2 w-1.5 cursor-ew-resize")} style={{ touchAction: "none" }} />
      <div {...makeResizeHandlers("nw")} className={cn(resizeHandleClass, "top-0 left-0 h-3 w-3 cursor-nwse-resize")} style={{ touchAction: "none" }} />
      <div {...makeResizeHandlers("ne")} className={cn(resizeHandleClass, "top-0 right-0 h-3 w-3 cursor-nesw-resize")} style={{ touchAction: "none" }} />
      <div {...makeResizeHandlers("sw")} className={cn(resizeHandleClass, "bottom-0 left-0 h-3 w-3 cursor-nesw-resize")} style={{ touchAction: "none" }} />
      <div {...makeResizeHandlers("se")} className={cn(resizeHandleClass, "bottom-0 right-0 h-3 w-3 cursor-nwse-resize")} style={{ touchAction: "none" }} />

      {/* Header — arraste aqui pra mover a janela */}
      <div
        className="px-4 py-3 border-b border-border flex items-center gap-2 shrink-0 cursor-move select-none"
        style={{ touchAction: "none" }}
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
      >
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
        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              const el = e.target;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
            }}
            onKeyDown={(e) => {
              // Enter sozinho envia. Ctrl+Shift+Enter ou Cmd+Shift+Enter (ou Shift+Enter)
              // pulam pra próxima linha — comportamento padrão do textarea, não interceptamos.
              if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Pergunte algo ou peça uma ação..."
            disabled={isThinking || sendMutation.isPending}
            rows={1}
            className="text-sm min-h-9 max-h-[120px] resize-none py-2"
          />
          <Button size="icon" className="h-9 w-9 shrink-0" onClick={handleSend} disabled={!input.trim() || isThinking || sendMutation.isPending}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
