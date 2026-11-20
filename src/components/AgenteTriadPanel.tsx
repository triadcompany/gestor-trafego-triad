import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, History, Loader2, Mic, Paperclip, Send, Trash2, Volume2, VolumeX, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { fetchAllClients } from "@/lib/queries";
import { getMetaToken } from "@/lib/meta";
import { cn } from "@/lib/utils";

// Versão compacta do Agente Triad (Claude + conector Meta Ads) dentro do botão
// flutuante "Agente IA". Fala com o painel local do Mac (localhost:3055), igual à
// página /agente-triad, mas já entra focada no cliente que está aberto na tela.
const PAINEL = "http://localhost:3055";

type Item =
  | { kind: "me" | "ag" | "err"; text: string; id?: string }
  | { kind: "tool"; text: string }
  | { kind: "img"; url: string; name: string }
  | { kind: "approval"; id: string; tool: string; detail: string; danger: boolean; state: "wait" | "ok" | "no" };

const newId = () => crypto.randomUUID();
interface ConvSummary {
  id: string;
  title: string;
  updatedAt: number;
}
interface Attached {
  path: string;
  transcript: string | null;
  error: string | null;
}

export function AgenteTriadPanel() {
  const { id: routeId } = useParams({ strict: false }) as { id?: string };
  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: fetchAllClients, staleTime: 60_000 });
  const focus = useMemo(() => clients.find((c) => c.id === routeId && c.active) ?? null, [clients, routeId]);

  const [items, setItems] = useState<Item[]>([]);
  const [convId, setConvId] = useState<string>(newId);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [abrindo, setAbrindo] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const [speak, setSpeak] = useState(true);
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);
  const [attached, setAttached] = useState<Attached[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [convs, setConvs] = useState<ConvSummary[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const dirty = useRef(false);

  // Trocou de cliente na tela: começa uma conversa nova, senão o agente continuaria no cliente anterior.
  const lastFocus = useRef<string | null>(null);
  useEffect(() => {
    const cur = focus?.id ?? null;
    if (lastFocus.current !== null && lastFocus.current !== cur) {
      dirty.current = false;
      setItems([]);
      setAttached([]);
      setConvId(newId());
    }
    lastFocus.current = cur;
  }, [focus?.id]);

  useEffect(() => {
    const ping = () =>
      fetch(`${PAINEL}/api/ping`)
        .then((r) => setOnline(r.ok))
        .catch(() => setOnline(false));
    ping();
    const t = setInterval(ping, 8000);
    return () => clearInterval(t);
  }, []);

  // a caixa cresce com o texto até 5 linhas; passando disso, rola
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 116)}px`;
  }, [input, showHistory]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [items]);

  const abrirPainel = () => {
    setAbrindo(true);
    window.location.href = "triadpainel://abrir";
    setTimeout(() => setAbrindo(false), 8000);
  };

  const say = (t: string) => {
    if (!speak || !t) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t.replace(/[\u{1F300}-\u{1FAFF}✅⚠️]/gu, ""));
    u.lang = "pt-BR";
    u.rate = 1.25;
    const vs = speechSynthesis.getVoices();
    const v = vs.find((x) => x.lang === "pt-BR" && /Google|Luciana|Felipe/.test(x.name)) ?? vs.find((x) => x.lang === "pt-BR");
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  };

  function toggleMic() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return alert("Use o Chrome para voz.");
    if (recRef.current) return recRef.current.stop();
    const rec = new SR();
    rec.lang = "pt-BR";
    rec.interimResults = true;
    let last = "";
    rec.onresult = (e: any) => {
      last = [...e.results].map((r: any) => r[0].transcript).join("");
      setInput(last);
    };
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
      if (last.trim()) send(last);
    };
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  async function uploadFiles(files: File[]) {
    for (const f of files) {
      setUploading(f.name);
      try {
        const r = await fetch(`${PAINEL}/api/upload?name=${encodeURIComponent(f.name)}`, { method: "POST", body: f });
        const j = await r.json();
        setAttached((a) => [...a, { path: j.path, transcript: j.transcript ?? null, error: j.transcriptError ?? null }]);
      } catch {
        setItems((p) => [...p, { kind: "err", text: `Não consegui enviar ${f.name} para o painel.` }]);
      }
      setUploading(null);
    }
  }

  // ── histórico de conversas (guardado no painel do Mac) ──
  async function loadList() {
    try {
      const r = await fetch(`${PAINEL}/api/conversations`);
      const j = await r.json();
      setConvs(Array.isArray(j) ? j : []);
    } catch {
      setConvs([]);
    }
  }
  useEffect(() => {
    if (online) loadList();
  }, [online]);

  async function openConv(id: string) {
    const r = await fetch(`${PAINEL}/api/conversations/${id}`).catch(() => null);
    if (!r || !r.ok) return;
    const c = await r.json();
    dirty.current = false;
    setConvId(id);
    setItems(
      (Array.isArray(c.items) ? (c.items as Item[]) : []).map((it) =>
        it.kind === "approval" && it.state === "wait" ? { ...it, state: "no" as const } : it,
      ),
    );
    setShowHistory(false);
  }

  async function removeConv(id: string) {
    await fetch(`${PAINEL}/api/conversations/${id}`, { method: "DELETE" }).catch(() => {});
    if (id === convId) {
      setItems([]);
      setConvId(newId());
    }
    loadList();
  }

  // salva depois de cada resposta/aprovação (só quando algo mudou por ação do usuário)
  useEffect(() => {
    if (busy || !dirty.current) return;
    const firstMe = items.find((i) => i.kind === "me");
    if (!firstMe) return;
    const t = setTimeout(() => {
      dirty.current = false;
      fetch(`${PAINEL}/api/conversations/${convId}`, {
        method: "POST",
        body: JSON.stringify({ title: (firstMe as { text: string }).text.slice(0, 60), items }),
      })
        .then(() => loadList())
        .catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [items, busy, convId]);

  async function send(textArg?: string) {
    const shown = (textArg ?? input).trim();
    if (!shown || busy) return;
    // O cliente em foco vai na própria mensagem, pro agente já saber de qual conta se trata.
    const base = focus
      ? `[Cliente aberto na tela: ${focus.name} — conta de anúncio ${focus.meta_ad_account_id}. Considere este cliente, a menos que eu cite outro.]\n\n${shown}`
      : shown;
    const text =
      base +
      attached
        .map(
          (a) =>
            `\n\nArquivo enviado pelo painel: ${a.path}` +
            (a.transcript
              ? `\nTranscrição do vídeo (já feita, use direto):\n${a.transcript}`
              : a.error
                ? `\nTranscrição indisponível (${a.error}). Peça os dados do carro ao usuário.`
                : ""),
        )
        .join("");
    setAttached([]);
    dirty.current = true;
    speechSynthesis.cancel();
    const ctxClients = (focus ? [focus] : clients.filter((c) => c.active)).map((c) => ({
      id: c.id,
      name: c.name,
      account: c.meta_ad_account_id,
      page: c.meta_page_id,
      whatsapp: c.meta_whatsapp_number,
      budget: c.monthly_budget,
      cci: c.cpl_max > 0 ? `${c.cpl_min}-${c.cpl_max}` : null,
    }));
    setInput("");
    setItems((p) => [...p, { kind: "me", text: shown }]);
    setBusy(true);
    let full = "";
    let curId: string | null = null;
    try {
      const tokens: Record<string, string> = {};
      await Promise.all(
        (focus ? [focus] : clients.filter((c) => c.active))
          .filter((c) => c.meta_ad_account_id)
          .map(async (c) => {
            const t = await getMetaToken(c.id).catch(() => null);
            if (t) tokens[c.meta_ad_account_id] = t;
          }),
      );
      const res = await fetch(`${PAINEL}/api/chat`, {
        method: "POST",
        body: JSON.stringify({ text, clients: ctxClients, conversationId: convId, tokens }),
      });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const ev = part.match(/event: (.*)/)?.[1];
          const data = JSON.parse(part.match(/data: (.*)/)?.[1] ?? "null");
          if (ev === "text") {
            full += data;
            const snapshot = full;
            if (!curId) curId = `m${Date.now()}${Math.random()}`;
            const id = curId;
            setItems((p) => {
              const idx = p.findIndex((x) => x.kind === "ag" && x.id === id);
              if (idx === -1) return [...p, { kind: "ag", text: snapshot, id }];
              const copy = [...p];
              copy[idx] = { kind: "ag", text: snapshot, id };
              return copy;
            });
          } else if (ev === "tool") {
            curId = null;
            full = "";
            setItems((p) => [...p, { kind: "tool", text: data.name }]);
          } else if (ev === "image") {
            curId = null;
            full = "";
            setItems((p) => [...p, { kind: "img", url: data.url, name: data.name }]);
          } else if (ev === "approval") {
            curId = null;
            full = "";
            setItems((p) => [...p, { kind: "approval", ...data, state: "wait" }]);
          } else if (ev === "done") {
            if (data?.error) setItems((p) => [...p, { kind: "err", text: data.error }]);
            say(full);
          }
        }
      }
    } catch {
      setItems((p) => [...p, { kind: "err", text: "Não consegui falar com o painel no seu Mac. Ele está aberto?" }]);
    }
    setBusy(false);
  }

  async function decide(idx: number, id: string, allow: boolean) {
    dirty.current = true;
    setItems((p) => p.map((it, i) => (i === idx && it.kind === "approval" ? { ...it, state: allow ? "ok" : "no" } : it)));
    await fetch(`${PAINEL}/api/approve`, { method: "POST", body: JSON.stringify({ id, allow }) }).catch(() => {});
  }

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs shrink-0">
        <span className={cn("h-2 w-2 rounded-full", online ? "bg-emerald-500" : online === false ? "bg-destructive" : "bg-muted-foreground")} />
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {focus ? (
            <>
              Cliente: <b className="text-foreground">{focus.name}</b>
            </>
          ) : (
            "Abra um cliente pra focar nele (ou cite o nome na conversa)"
          )}
        </span>
        <button
          className="text-muted-foreground hover:text-foreground"
          title={speak ? "Desligar voz" : "Ligar voz"}
          onClick={() => {
            setSpeak((v) => !v);
            speechSynthesis.cancel();
          }}
        >
          {speak ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
        </button>
        <button
          className={cn("text-muted-foreground hover:text-foreground", showHistory && "text-foreground")}
          title="Conversas salvas"
          onClick={() => {
            setShowHistory((v) => !v);
            loadList();
          }}
        >
          <History className="h-3.5 w-3.5" />
        </button>
        <button
          className="text-muted-foreground hover:text-foreground"
          onClick={() => {
            dirty.current = false;
            setItems([]);
            setAttached([]);
            setConvId(newId());
            setShowHistory(false);
          }}
        >
          Nova
        </button>
      </div>

      {online === false && (
        <div className="m-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs space-y-2">
          <p>O painel não está rodando no seu Mac.</p>
          <Button size="sm" onClick={abrirPainel} disabled={abrindo}>
            {abrindo ? "Abrindo..." : "Abrir painel"}
          </Button>
        </div>
      )}

      {showHistory && (
        <div className="flex-1 space-y-1 overflow-y-auto px-2 py-2">
          {convs.length === 0 && <div className="px-2 py-3 text-xs text-muted-foreground">Nenhuma conversa salva ainda.</div>}
          {convs.map((c) => (
            <div key={c.id} className={cn("group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm hover:bg-accent", c.id === convId && "bg-accent")}>
              <button className="min-w-0 flex-1 truncate text-left" onClick={() => openConv(c.id)} title={c.title}>
                {c.title}
              </button>
              <button className="opacity-0 group-hover:opacity-100" onClick={() => removeConv(c.id)} title="Apagar">
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
          ))}
        </div>
      )}

      {!showHistory && (
      <div
        className="flex-1 space-y-2 overflow-y-auto px-3 py-3"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          uploadFiles(Array.from(e.dataTransfer.files));
        }}
      >
        {items.length === 0 && (
          <p className="pt-6 text-center text-xs text-muted-foreground">
            {focus
              ? `Pergunte sobre as campanhas de ${focus.name} ou peça pra criar uma (ex.: "sobe esse vídeo, R$ 25 por dia"). Tudo que eu criar fica como rascunho até você aprovar.`
              : "Fale o nome do cliente e o que precisa. Tudo que eu criar fica como rascunho até você aprovar."}
          </p>
        )}
        {items.map((it, i) => {
          if (it.kind === "tool")
            return (
              <div key={i} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Wrench className="h-3 w-3" /> {it.text}
              </div>
            );
          if (it.kind === "img")
            return <img key={i} src={`${PAINEL}${it.url}`} alt={it.name} className="max-h-48 rounded-md border" />;
          if (it.kind === "approval")
            return (
              <div key={i} className={cn("rounded-lg border p-2.5 text-xs", it.danger ? "border-destructive/50" : "border-border")}>
                <div className="font-medium">{it.tool}</div>
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-[11px] text-muted-foreground">{it.detail}</pre>
                {it.state === "wait" ? (
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" className="h-7" onClick={() => decide(i, it.id, true)}>
                      <Check className="mr-1 h-3.5 w-3.5" /> Aprovar
                    </Button>
                    <Button size="sm" variant="outline" className="h-7" onClick={() => decide(i, it.id, false)}>
                      <X className="mr-1 h-3.5 w-3.5" /> Negar
                    </Button>
                  </div>
                ) : (
                  <div className="mt-1.5 text-[11px] text-muted-foreground">{it.state === "ok" ? "Aprovado" : "Negado"}</div>
                )}
              </div>
            );
          return (
            <div
              key={i}
              className={cn(
                "max-w-[92%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm",
                it.kind === "me" && "ml-auto bg-primary text-primary-foreground",
                it.kind === "ag" && "bg-muted",
                it.kind === "err" && "bg-destructive/10 text-destructive",
              )}
            >
              {it.text}
            </div>
          );
        })}
        {busy && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> pensando…
          </div>
        )}
        <div ref={endRef} />
      </div>
      )}

      <div className="px-3 py-2.5 border-t border-border shrink-0">
        {uploading && (
          <div className="mb-1.5 flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Enviando e transcrevendo {uploading}…
          </div>
        )}
        {attached.length > 0 && (
          <div className="mb-1.5 flex items-center gap-1 text-xs text-emerald-500">
            <Paperclip className="h-3 w-3" /> {attached.length} arquivo(s) pronto(s){attached.some((a) => a.transcript) ? " (transcrito)" : ""} — vão junto na próxima mensagem
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            uploadFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <div className="flex gap-2 items-end">
          <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" title="Anexar vídeo" onClick={() => fileRef.current?.click()} disabled={!online}>
            <Paperclip className="h-4 w-4" />
          </Button>
          <Button variant={listening ? "destructive" : "outline"} size="icon" className="h-9 w-9 shrink-0" title="Falar" onClick={toggleMic}>
            <Mic className="h-4 w-4" />
          </Button>
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={focus ? `Fale sobre ${focus.name}… (arraste o vídeo aqui)` : "Fale o cliente e o que precisa… (arraste o vídeo aqui)"}
            disabled={busy}
            rows={1}
            className="text-sm min-h-9 max-h-[116px] resize-none py-2"
          />
          <Button size="icon" className="h-9 w-9 shrink-0" onClick={() => send()} disabled={!input.trim() || busy || !online}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </>
  );
}
