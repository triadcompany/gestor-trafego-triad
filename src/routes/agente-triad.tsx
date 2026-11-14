import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import {
  Mic,
  Send,
  Volume2,
  VolumeX,
  Plus,
  Paperclip,
  ShieldAlert,
  Loader2,
  Trash2,
  MessageSquare,
} from "lucide-react";
import { fetchAllClients } from "@/lib/queries";
import { getMetaToken } from "@/lib/meta";
import { getCurrentUser } from "@/server/session";
import { isTriadCompanyOrg } from "@/lib/feature-flags";
import { cn } from "@/lib/utils";

// Agente de campanhas (Claude + conector Meta Ads) que roda no Mac do dono
// em http://localhost:3055 (pasta agente-campanhas/painel). Toda gravação na
// Meta sai pelo n8n; o conector Meta Ads é só leitura. Experimental —
// só pra organização da Triad Company. O navegador fala direto com o
// localhost; o servidor do gestor nunca vê essa conversa.
const PAINEL = "http://localhost:3055";

export const Route = createFileRoute("/agente-triad")({
  head: () => ({ meta: [{ title: "Agente Triad — Gestor de Tráfego" }] }),
  ssr: false,
  beforeLoad: async () => {
    const user = await getCurrentUser();
    const orgId = user?.actingOrganizationId ?? user?.organizationId;
    if (!isTriadCompanyOrg(orgId)) throw redirect({ to: "/dashboard" });
  },
  component: AgenteTriadPage,
  // Mostra o erro real (o padrão do app esconde em produção) — rota experimental.
  errorComponent: ({ error, reset }) => (
    <AppShell>
      <div className="mx-auto max-w-2xl space-y-3 p-6">
        <h1 className="text-lg font-semibold text-destructive">Erro no Agente Triad</h1>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">
          {String((error as Error)?.stack || (error as Error)?.message || error)}
        </pre>
        <Button onClick={reset}>Tentar de novo</Button>
      </div>
    </AppShell>
  ),
});

const GREETING: Item = {
  kind: "ag",
  text: 'Oi! Fale o nome do cliente e o que precisa (ex.: "como estão as campanhas do Campo Grande?" ou "sobe esse vídeo no DV Team, R$ 25 por dia"). Eu sei quais são as contas de cada cliente. Tudo que eu criar fica como rascunho e só vai ao ar com a sua aprovação.',
};
const newId = () => crypto.randomUUID();
interface ConvSummary {
  id: string;
  title: string;
  updatedAt: number;
}

type Item =
  | { kind: "me" | "ag" | "err"; text: string; id?: string }
  | { kind: "tool"; text: string }
  | {
      kind: "approval";
      id: string;
      tool: string;
      detail: string;
      danger: boolean;
      state: "wait" | "ok" | "no";
    };

function AgenteTriadPage() {
  const [items, setItems] = useState<Item[]>([GREETING]);
  const [convId, setConvId] = useState<string>(newId);
  const [convs, setConvs] = useState<ConvSummary[]>([]);
  const dirty = useRef(false);
  const opened = useRef(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [speak, setSpeak] = useState(true);
  const [listening, setListening] = useState(false);
  const [attached, setAttached] = useState<
    Array<{ path: string; transcript: string | null; error: string | null }>
  >([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recRef = useRef<any>(null);

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: fetchAllClients,
    staleTime: 60_000,
  });
  // Token da Meta por conta de anúncio — vai separado do texto (o modelo nunca
  // vê) e o painel só o repassa ao n8n quando o agente grava na Meta.
  const clientIds = clients.filter((c) => c.active).map((c) => c.id);
  const { data: tokenMap, refetch: loadTokens } = useQuery({
    queryKey: ["agente-triad-tokens", clientIds.join(",")],
    queryFn: async () => {
      const out: Record<string, string> = {};
      await Promise.all(
        clients
          .filter((c) => c.active && c.meta_ad_account_id)
          .map(async (c) => {
            const t = await getMetaToken(c.id).catch(() => null);
            if (t) out[c.meta_ad_account_id] = t;
          }),
      );
      return out;
    },
    enabled: clientIds.length > 0,
    staleTime: 5 * 60_000,
  });
  const clientCtx = useMemo(
    () =>
      clients
        .filter((c) => c.active)
        .map((c) => ({
          name: c.name,
          account: c.meta_ad_account_id,
          page: c.meta_page_id,
          whatsapp: c.meta_whatsapp_number,
          budget: c.monthly_budget,
        })),
    [clients],
  );

  useEffect(() => {
    const ping = () =>
      fetch(`${PAINEL}/api/ping`)
        .then((r) => setOnline(r.ok))
        .catch(() => setOnline(false));
    ping();
    const t = setInterval(ping, 8000);
    return () => clearInterval(t);
  }, []);

  async function loadList(): Promise<ConvSummary[]> {
    try {
      const r = await fetch(`${PAINEL}/api/conversations`);
      const l: ConvSummary[] = await r.json();
      setConvs(l);
      return l;
    } catch {
      return [];
    }
  }

  async function openConv(id: string) {
    const r = await fetch(`${PAINEL}/api/conversations/${id}`);
    if (!r.ok) return;
    const c = await r.json();
    dirty.current = false;
    setConvId(id);
    // aprovação pendente de uma sessão antiga não pode mais ser respondida
    setItems(
      (c.items as Item[]).map((it) =>
        it.kind === "approval" && it.state === "wait" ? { ...it, state: "no" as const } : it,
      ),
    );
  }

  function startNew() {
    dirty.current = false;
    setConvId(newId());
    setItems([GREETING]);
  }

  async function removeConv(id: string) {
    await fetch(`${PAINEL}/api/conversations/${id}`, { method: "DELETE" }).catch(() => {});
    if (id === convId) startNew();
    loadList();
  }

  // ao abrir (painel online) carrega a lista e reabre a conversa mais recente
  useEffect(() => {
    if (!online || opened.current) return;
    opened.current = true;
    loadList().then((l) => {
      if (l[0]) openConv(l[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, busy, convId]);

  // a caixa cresce com o texto até ~10 linhas; passando disso, rola
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 216)}px`;
  }, [input]);

  useEffect(() => {
    // chaves de propósito: o efeito não pode devolver valor (React chamaria como cleanup)
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items]);

  const say = (t: string) => {
    if (!speak || !t) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t.replace(/[\u{1F300}-\u{1FAFF}✅⚠️]/gu, ""));
    u.lang = "pt-BR";
    u.rate = 1.25;
    const vs = speechSynthesis.getVoices();
    const v =
      vs.find((x) => x.lang === "pt-BR" && /Google|Luciana|Felipe/.test(x.name)) ??
      vs.find((x) => x.lang === "pt-BR");
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  };

  async function send(textArg?: string) {
    let text = (textArg ?? input).trim();
    if (!text || busy) return;
    const shown = text;
    if (attached.length)
      text += attached
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
    setInput("");
    dirty.current = true;
    setItems((p) => [...p, { kind: "me", text: shown }]);
    setBusy(true);
    speechSynthesis.cancel();
    let full = "";
    let curId: string | null = null;
    try {
      const tokens =
        tokenMap && Object.keys(tokenMap).length > 0 ? tokenMap : ((await loadTokens()).data ?? {});
      const res = await fetch(`${PAINEL}/api/chat`, {
        method: "POST",
        body: JSON.stringify({ text, clients: clientCtx, conversationId: convId, tokens }),
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
          } else if (ev === "approval") {
            curId = null;
            full = "";
            setItems((p) => [...p, { kind: "approval", ...data, state: "wait" }]);
          } else if (ev === "done") {
            if (data.error) setItems((p) => [...p, { kind: "err", text: data.error }]);
            say(full);
          }
        }
      }
    } catch {
      setItems((p) => [
        ...p,
        { kind: "err", text: "Não consegui falar com o painel no seu Mac. Ele está aberto?" },
      ]);
    }
    setBusy(false);
  }

  async function decide(idx: number, id: string, allow: boolean) {
    dirty.current = true;
    setItems((p) =>
      p.map((it, i) =>
        i === idx && it.kind === "approval" ? { ...it, state: allow ? "ok" : "no" } : it,
      ),
    );
    await fetch(`${PAINEL}/api/approve`, { method: "POST", body: JSON.stringify({ id, allow }) });
  }

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

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    for (const f of Array.from(e.dataTransfer.files)) {
      setUploading(f.name);
      try {
        const r = await fetch(`${PAINEL}/api/upload?name=${encodeURIComponent(f.name)}`, {
          method: "POST",
          body: f,
        });
        const j = await r.json();
        setAttached((a) => [
          ...a,
          { path: j.path, transcript: j.transcript ?? null, error: j.transcriptError ?? null },
        ]);
      } catch {
        setItems((p) => [
          ...p,
          { kind: "err", text: `Não consegui enviar ${f.name} para o painel.` },
        ]);
      }
      setUploading(null);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto flex h-[calc(100vh-7rem)] max-w-5xl gap-4">
        <aside className="hidden w-56 shrink-0 flex-col gap-1 overflow-y-auto md:flex">
          <div className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Conversas
          </div>
          {convs.length === 0 && (
            <div className="px-2 text-xs text-muted-foreground">Nenhuma conversa salva ainda.</div>
          )}
          {convs.map((c) => (
            <div
              key={c.id}
              className={cn(
                "group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm hover:bg-accent",
                c.id === convId && "bg-accent",
              )}
            >
              <button
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onClick={() => openConv(c.id)}
                title={c.title}
              >
                <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{c.title}</span>
              </button>
              <button
                className="opacity-0 group-hover:opacity-100"
                onClick={() => removeConv(c.id)}
                title="Apagar"
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
          ))}
        </aside>
        <div
          className="flex min-w-0 flex-1 flex-col"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        >
          <div className="flex items-center gap-2 pb-3">
            <h1 className="text-lg font-semibold">Agente Triad</h1>
            <span className="text-xs text-muted-foreground">
              Claude + conector Meta Ads · {clientCtx.length} clientes
            </span>
            <span
              className={cn(
                "ml-2 inline-flex items-center gap-1 text-xs",
                online ? "text-emerald-500" : "text-destructive",
              )}
            >
              <span
                className={cn("h-2 w-2 rounded-full", online ? "bg-emerald-500" : "bg-destructive")}
              />
              {online === null ? "verificando" : online ? "painel online" : "painel offline"}
            </span>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setSpeak((s) => !s);
                speechSynthesis.cancel();
              }}
              title="Voz"
            >
              {speak ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </Button>
            <Button variant="outline" size="sm" onClick={startNew}>
              <Plus className="mr-1 h-4 w-4" /> Nova
            </Button>
          </div>

          {online === false && (
            <div className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
              O painel não está rodando no seu Mac. Abra o <b>iniciar.command</b> da pasta{" "}
              <code>agente-campanhas2/painel</code> e esta tela volta sozinha.
            </div>
          )}

          <div className="flex-1 space-y-3 overflow-y-auto rounded-xl border bg-card/40 p-4">
            {items.map((it, i) => {
              if (!it) return null;
              if (it.kind === "tool")
                return (
                  <div key={i} className="font-mono text-[11px] text-muted-foreground">
                    ▸ {it.text}
                  </div>
                );
              if (it.kind === "approval")
                return (
                  <div
                    key={i}
                    className={cn(
                      "rounded-xl border p-3",
                      it.danger ? "border-destructive/60" : "border-amber-500/60",
                      it.state !== "wait" && "opacity-60",
                    )}
                  >
                    <div
                      className={cn(
                        "mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide",
                        it.danger ? "text-destructive" : "text-amber-500",
                      )}
                    >
                      <ShieldAlert className="h-3.5 w-3.5" />{" "}
                      {it.danger ? "Vai ao ar — aprovar?" : "Aprovar ação?"} · {it.tool}
                    </div>
                    <pre className="mb-3 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-muted-foreground">
                      {it.detail}
                    </pre>
                    {it.state === "wait" ? (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant={it.danger ? "destructive" : "default"}
                          onClick={() => decide(i, it.id, true)}
                        >
                          {it.danger ? "Ativar" : "Permitir"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => decide(i, it.id, false)}>
                          Negar
                        </Button>
                      </div>
                    ) : (
                      <div className="text-xs">
                        {it.state === "ok" ? "✅ Aprovado" : "⛔ Negado"}
                      </div>
                    )}
                  </div>
                );
              return (
                <div
                  key={i}
                  className={cn(
                    "max-w-[86%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm",
                    it.kind === "me"
                      ? "ml-auto bg-primary text-primary-foreground"
                      : it.kind === "err"
                        ? "border border-destructive/40 text-destructive"
                        : "border bg-background",
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

          {uploading && (
            <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Enviando e transcrevendo {uploading}…
            </div>
          )}
          {attached.length > 0 && (
            <div className="mt-2 flex items-center gap-1 text-xs text-emerald-500">
              <Paperclip className="h-3 w-3" /> {attached.length} arquivo(s) pronto(s)
              {attached.some((a) => a.transcript) ? " (transcrito)" : ""} — vão junto na próxima
              mensagem
            </div>
          )}
          <div className="mt-3 flex items-end gap-2">
            <Button
              variant={listening ? "destructive" : "outline"}
              size="icon"
              onClick={toggleMic}
              title="Falar"
            >
              <Mic className="h-4 w-4" />
            </Button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder="Fale o cliente e o que precisa… (arraste o vídeo aqui)"
              className="max-h-[216px] min-h-10 flex-1 resize-none overflow-y-auto rounded-lg border bg-background px-3 py-2 text-sm leading-5 outline-none focus:border-primary"
            />
            <Button size="icon" onClick={() => send()} disabled={busy || !online}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
