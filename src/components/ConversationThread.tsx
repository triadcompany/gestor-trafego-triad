import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, FileText, Download, Image as ImageIcon, Video as VideoIcon, Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchConversationMessages, fetchConversationMedia, type ConversationMessage } from "@/server/whatsapp-conversations";
import { formatPhoneFromJid } from "@/components/LeadsDashboard";

const POLL_MS = 18_000;
const NEAR_BOTTOM_PX = 120;
const NEAR_TOP_PX = 80;

interface ConversationThreadProps {
  clientId: string;
  remoteJid: string;
  contactName: string;
}

export function ConversationThread({ clientId, remoteJid, contactName }: ConversationThreadProps) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const didInitialScrollRef = useRef(false);

  // Troca de conversa: reseta tudo e busca a página 1 de novo.
  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setPage(1);
    setHasMore(true);
    setError(null);
    setLoadingInitial(true);
    didInitialScrollRef.current = false;

    fetchConversationMessages(clientId, remoteJid, 1)
      .then((res) => {
        if (cancelled) return;
        setMessages(res.messages);
        setHasMore(res.hasMore);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erro ao carregar a conversa.");
      })
      .finally(() => {
        if (!cancelled) setLoadingInitial(false);
      });

    return () => {
      cancelled = true;
    };
  }, [clientId, remoteJid]);

  // Desce pro fim só uma vez, assim que a primeira leva de mensagens chega.
  useEffect(() => {
    if (!loadingInitial && !didInitialScrollRef.current && messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: "auto" });
      didInitialScrollRef.current = true;
    }
  }, [loadingInitial, messages.length]);

  const isNearBottom = () => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  };

  // Verifica mensagens novas periodicamente (sempre a página mais recente) —
  // só anexa o que ainda não está na tela, e só rola pro fim sozinho se o
  // gestor já estava lendo o final da conversa (não interrompe quem rolou
  // pra cima lendo histórico).
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetchConversationMessages(clientId, remoteJid, 1);
        setMessages((prev) => {
          const known = new Set(prev.map((m) => m.id));
          const fresh = res.messages.filter((m) => !known.has(m.id));
          if (fresh.length === 0) return prev;
          const shouldStickToBottom = isNearBottom();
          const merged = [...prev, ...fresh].sort((a, b) => a.timestamp - b.timestamp);
          if (shouldStickToBottom) {
            requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
          }
          return merged;
        });
      } catch {
        // falha de uma checagem de polling não deve interromper a leitura
      }
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [clientId, remoteJid]);

  const loadOlder = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    const el = scrollRef.current;
    const prevScrollHeight = el?.scrollHeight ?? 0;
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const res = await fetchConversationMessages(clientId, remoteJid, nextPage);
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id));
        const older = res.messages.filter((m) => !known.has(m.id));
        return [...older, ...prev].sort((a, b) => a.timestamp - b.timestamp);
      });
      setHasMore(res.hasMore);
      setPage(nextPage);
      // Preserva a posição de leitura — sem isso, prepender mensagens mais
      // antigas no topo faz a tela "pular" pro meio do nada.
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevScrollHeight;
      });
    } catch {
      // mantém hasMore como estava — o gestor pode rolar de novo pra tentar
    } finally {
      setLoadingMore(false);
    }
  }, [clientId, remoteJid, page, hasMore, loadingMore]);

  const handleScroll = () => {
    if ((scrollRef.current?.scrollTop ?? 0) < NEAR_TOP_PX) loadOlder();
  };

  if (loadingInitial) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando conversa...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{error}</div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-4 py-3">
        <p className="text-sm font-medium">{contactName}</p>
        <p className="text-xs text-muted-foreground">{formatPhoneFromJid(remoteJid)}</p>
      </div>

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {loadingMore && (
          <div className="flex justify-center py-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {!hasMore && messages.length > 0 && (
          <p className="py-2 text-center text-xs text-muted-foreground/60">Início da conversa</p>
        )}
        {messages.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma mensagem encontrada nesta conversa.</p>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} clientId={clientId} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function MessageBubble({ clientId, msg }: { clientId: string; msg: ConversationMessage }) {
  const time = new Date(msg.timestamp * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className={cn("flex", msg.fromMe ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-3 py-2 text-sm",
          msg.fromMe
            ? "rounded-tr-sm bg-primary text-primary-foreground"
            : "rounded-tl-sm border border-border bg-muted/50"
        )}
      >
        <MessageContent clientId={clientId} msg={msg} />
        <p className={cn("mt-1 text-right text-[10px]", msg.fromMe ? "text-primary-foreground/70" : "text-muted-foreground")}>
          {time}
        </p>
      </div>
    </div>
  );
}

function MessageContent({ clientId, msg }: { clientId: string; msg: ConversationMessage }) {
  switch (msg.type) {
    case "text":
      return <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>;
    case "image":
      return <ImageBubble clientId={clientId} msg={msg} />;
    case "sticker":
      return <ImageBubble clientId={clientId} msg={msg} isSticker />;
    case "video":
      return <VideoBubble clientId={clientId} msg={msg} />;
    case "audio":
      return <AudioBubble clientId={clientId} msg={msg} />;
    case "document":
      return <DocumentBubble clientId={clientId} msg={msg} />;
    default:
      return <p className="italic text-muted-foreground">Mensagem não suportada</p>;
  }
}

// Busca o conteúdo de uma mídia sob demanda (a listagem de mensagens não traz
// o conteúdo, só o tipo) — autoLoad=true pras imagens (carregam sozinhas ao
// aparecer), false pra áudio/vídeo/documento (só quando o gestor clica, pra
// não baixar tudo de uma vez numa conversa longa).
function useLazyMedia(clientId: string, msg: ConversationMessage, autoLoad: boolean) {
  const [data, setData] = useState<{ base64: string; mimetype: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const requestedRef = useRef(false);

  const load = useCallback(() => {
    if (requestedRef.current) return;
    requestedRef.current = true;
    setLoading(true);
    setError(false);
    fetchConversationMedia(clientId, msg.id, msg.remoteJid, msg.fromMe)
      .then(setData)
      .catch(() => {
        setError(true);
        requestedRef.current = false;
      })
      .finally(() => setLoading(false));
  }, [clientId, msg.id, msg.remoteJid, msg.fromMe]);

  useEffect(() => {
    if (autoLoad) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad, msg.id]);

  return { data, loading, error, load };
}

function ImageBubble({ clientId, msg, isSticker }: { clientId: string; msg: ConversationMessage; isSticker?: boolean }) {
  const { data, loading, error, load } = useLazyMedia(clientId, msg, true);

  if (loading) {
    return (
      <div className={cn("flex items-center justify-center rounded-lg bg-muted", isSticker ? "h-28 w-28" : "h-40 w-56")}>
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error) {
    return (
      <button onClick={load} className="flex items-center gap-1.5 text-xs underline">
        <ImageIcon className="h-3.5 w-3.5" />
        Não foi possível carregar — tentar de novo
      </button>
    );
  }
  if (!data) return null;

  const src = `data:${data.mimetype || "image/jpeg"};base64,${data.base64}`;
  return (
    <div className="space-y-1">
      <a href={src} target="_blank" rel="noopener noreferrer">
        <img src={src} alt="" className={cn("rounded-lg object-cover", isSticker ? "h-28 w-28" : "max-h-60 max-w-full")} />
      </a>
      {msg.text && <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>}
    </div>
  );
}

function VideoBubble({ clientId, msg }: { clientId: string; msg: ConversationMessage }) {
  const { data, loading, error, load } = useLazyMedia(clientId, msg, false);

  if (data) {
    const src = `data:${data.mimetype || "video/mp4"};base64,${data.base64}`;
    return (
      <div className="space-y-1">
        <video src={src} controls className="max-h-60 max-w-full rounded-lg" />
        {msg.text && <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>}
      </div>
    );
  }
  return (
    <button onClick={load} disabled={loading} className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs">
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <VideoIcon className="h-4 w-4" />}
      {loading ? "Carregando vídeo..." : error ? "Erro — tentar de novo" : "Carregar vídeo"}
    </button>
  );
}

function AudioBubble({ clientId, msg }: { clientId: string; msg: ConversationMessage }) {
  const { data, loading, error, load } = useLazyMedia(clientId, msg, false);

  if (data) {
    const src = `data:${data.mimetype || "audio/ogg"};base64,${data.base64}`;
    return <audio src={src} controls autoPlay className="h-10 max-w-full" />;
  }
  return (
    <button onClick={load} disabled={loading} className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs">
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
      {loading ? "Carregando áudio..." : error ? "Erro — tentar de novo" : msg.isPtt ? "Ouvir áudio" : "Carregar áudio"}
    </button>
  );
}

function DocumentBubble({ clientId, msg }: { clientId: string; msg: ConversationMessage }) {
  const { data, loading, error, load } = useLazyMedia(clientId, msg, false);
  const fileName = msg.fileName || "arquivo";

  if (data) {
    const href = `data:${data.mimetype || "application/octet-stream"};base64,${data.base64}`;
    return (
      <a href={href} download={fileName} className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs underline">
        <FileText className="h-4 w-4 shrink-0" />
        {fileName}
      </a>
    );
  }
  return (
    <button onClick={load} disabled={loading} className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs">
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      {loading ? "Carregando..." : error ? "Erro — tentar de novo" : `Baixar ${fileName}`}
    </button>
  );
}
