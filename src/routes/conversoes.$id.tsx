import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, Plus, RefreshCw, Sparkles, Target, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { fetchClientDetail } from "@/lib/queries";
import {
  addEventKeyword,
  deleteEventKeyword,
  getCapiDataset,
  getConversionsReadiness,
  listEventKeywords,
  listMetaEventLog,
  reapplyWhatsappWebhook,
  setCapiDataset,
  updateEventKeyword,
  type ConversionsReadiness,
  type EventKeywordRow,
  type MetaEventLogRow,
} from "@/server/event-keywords";

export const Route = createFileRoute("/conversoes/$id")({
  head: () => ({ meta: [{ title: "Conversões — Gestor de Tráfego" }] }),
  ssr: false,
  component: ConversionsPage,
});

type EventType = EventKeywordRow["eventType"];
type Source = EventKeywordRow["source"];

const EVENT_LABEL: Record<MetaEventLogRow["eventType"], string> = { qualified: "Lead qualificado", lead: "Lead", purchase: "Compra" };
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Algo deu errado. Tente de novo.");

// Atalhos de um clique pra quem não sabe por onde começar.
const SUGGESTIONS: Record<EventType, string[]> = {
  qualified_lead: ["orçamento enviado", "proposta enviada", "visita agendada", "agendou"],
  purchase: ["negócio fechado", "pagamento confirmado", "pix recebido", "venda realizada"],
};

// Exemplos de prompt pra IA — o gestor só ajusta pro negócio dele.
const AI_EXAMPLE_QUALIFIED =
  "Lead qualificado é quem demonstra interesse real em comprar: pergunta preço, condições ou prazo, pede orçamento, quer agendar uma visita ou informa o que está procurando. Não é qualificado quem só diz “oi”, faz uma pergunta genérica e some, ou está só curioso.";
const AI_EXAMPLE_PURCHASE =
  "Compra fechada é quando a conversa mostra que o lead pagou ou fechou o negócio de forma definitiva: sinal ou pagamento confirmado, Pix recebido, contrato assinado. Intenção de comprar, pedido de orçamento ou “vou pensar” NÃO é compra.";

// "1.500,50" / "1500.5" / "" → número, null (vazio) ou NaN (inválido)
function parseMoney(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) && n >= 0 ? n : Number.NaN;
}

function ConversionsPage() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();

  const client = useQuery({ queryKey: ["client-detail", id], queryFn: () => fetchClientDetail(id) });
  const rules = useQuery({ queryKey: ["event-keywords", id], queryFn: () => listEventKeywords(id) });
  const readiness = useQuery({ queryKey: ["conversions-readiness", id], queryFn: () => getConversionsReadiness(id) });
  const history = useQuery({ queryKey: ["meta-event-log", id], queryFn: () => listMetaEventLog(id, 50) });

  const refreshRules = () => queryClient.invalidateQueries({ queryKey: ["event-keywords", id] });
  const refreshReadiness = () => queryClient.invalidateQueries({ queryKey: ["conversions-readiness", id] });

  return (
    <AppShell>
      <div className="px-4 md:px-8 py-6 max-w-3xl mx-auto pb-28">
        <Link to="/clients/$id" params={{ id }} search={{ openCampaignId: undefined }} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar pro cliente
        </Link>

        <div className="flex items-start gap-3 mb-5">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
            <Target className="h-4.5 w-4.5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Conversões{client.data ? ` — ${client.data.name}` : ""}</h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              Como o sistema descobre que um lead é bom ou que comprou, pra avisar a Meta e ela otimizar seus anúncios.
            </p>
          </div>
        </div>

        <StatusBanner loading={readiness.isLoading} data={readiness.data} />
        <PixelCard clientId={id} onSaved={refreshReadiness} n8nConfigured={readiness.data?.n8nConfigured ?? false} />

        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-8 mb-3">Como detectar</h2>
        <div className="space-y-4">
          <KeywordsCard
            clientId={id}
            rules={rules.data ?? []}
            loading={rules.isLoading}
            onChanged={refreshRules}
            whatsappConnected={readiness.data?.whatsappConnected ?? true}
          />
          <AiCard />
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Você também pode marcar na mão: os botões <strong className="font-medium">Qualificar</strong> e <strong className="font-medium">Converter</strong> continuam na tela de{" "}
          <Link to="/rastreamento" className="underline underline-offset-2">Rastreamento</Link>.
        </p>

        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-8 mb-3">Últimos envios pra Meta</h2>
        <HistorySection rows={history.data} loading={history.isLoading} onRefresh={() => history.refetch()} refreshing={history.isFetching} />
      </div>
    </AppShell>
  );
}

// ── Status único no topo ─────────────────────────────────────────────────────

function StatusBanner({ loading, data }: { loading: boolean; data: ConversionsReadiness | undefined }) {
  if (loading || !data) return <Skeleton className="h-14 w-full" />;

  const problems: string[] = [];
  if (!data.metaTokenOk) problems.push("A conta da Meta deste cliente está sem acesso válido. Reconecte o Facebook.");
  if (!data.whatsappConnected) problems.push("Falta conectar o WhatsApp do cliente. Sem ele, o sistema não lê as conversas.");
  if (!data.n8nConfigured && !data.fallbackDatasetSet) problems.push("Falta o pixel: informe o ID do pixel de mensagem no campo logo abaixo.");
  if (data.noPixelFailuresLast7d > 0) {
    problems.push(
      `${data.noPixelFailuresLast7d} ${data.noPixelFailuresLast7d === 1 ? "envio falhou" : "envios falharam"} nos últimos 7 dias porque o anúncio não tem pixel de mensagem.`
    );
  }

  if (problems.length === 0) {
    return (
      <Card className="p-4 flex items-start gap-3 border-emerald-600/30">
        <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-medium">Tudo pronto</div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {data.n8nConfigured ? "O pixel é descoberto automaticamente pelo anúncio de cada lead." : "Os eventos usam o pixel informado abaixo."}
          </p>
        </div>
      </Card>
    );
  }
  return (
    <Card className="p-4 flex items-start gap-3 border-amber-600/40">
      <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
      <div>
        <div className="text-sm font-medium">{problems.length === 1 ? "Falta 1 coisa" : `Faltam ${problems.length} coisas`}</div>
        <ul className="mt-1 space-y-1 text-sm text-muted-foreground list-disc pl-4">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

// ── Cartão: palavras-chave ───────────────────────────────────────────────────

function KeywordsCard({
  clientId,
  rules,
  loading,
  onChanged,
  whatsappConnected,
}: {
  clientId: string;
  rules: EventKeywordRow[];
  loading: boolean;
  onChanged: () => void;
  whatsappConnected: boolean;
}) {
  const reapply = useMutation({
    mutationFn: () => reapplyWhatsappWebhook(clientId),
    onSuccess: () => toast.success("Conexão do WhatsApp atualizada."),
    onError: (e) => toast.error(errMsg(e)),
  });
  const count = (t: EventType) => rules.filter((r) => r.eventType === t && r.active).length;

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Palavras-chave</h3>
          <p className="text-sm text-muted-foreground mt-0.5 max-w-lg">
            Quando uma frase aparecer na conversa de um lead de anúncio, o sistema qualifica o lead ou registra a compra sozinho.
          </p>
        </div>
        <Badge variant="secondary" className="shrink-0">
          {count("qualified_lead")} qualificado · {count("purchase")} compra
        </Badge>
      </div>

      <KeywordSection
        clientId={clientId}
        eventType="qualified_lead"
        title="Lead qualificado"
        help="Frases que mostram que o lead é bom."
        rules={rules.filter((r) => r.eventType === "qualified_lead")}
        loading={loading}
        onChanged={onChanged}
      />
      <KeywordSection
        clientId={clientId}
        eventType="purchase"
        title="Compra"
        help="Frases que mostram que a venda fechou. Se a mensagem tiver “R$ 1.500,00”, esse valor é enviado; senão vale o valor padrão da frase (ou vai sem valor)."
        rules={rules.filter((r) => r.eventType === "purchase")}
        loading={loading}
        onChanged={onChanged}
      />

      <div className="mt-5 pt-4 border-t flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>As frases da equipe só são lidas se a conexão do WhatsApp estiver atualizada.</span>
        <Button size="sm" variant="outline" className="gap-2" onClick={() => reapply.mutate()} disabled={reapply.isPending || !whatsappConnected}>
          {reapply.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Atualizar conexão do WhatsApp
        </Button>
      </div>
    </Card>
  );
}

function KeywordSection({
  clientId,
  eventType,
  title,
  help,
  rules,
  loading,
  onChanged,
}: {
  clientId: string;
  eventType: EventType;
  title: string;
  help: string;
  rules: EventKeywordRow[];
  loading: boolean;
  onChanged: () => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [source, setSource] = useState<Source>("team");
  const [value, setValue] = useState("");
  const isPurchase = eventType === "purchase";
  const inputId = `kw-${eventType}`;

  const add = useMutation({
    mutationFn: (input: { keyword: string; defaultValue: number | null }) =>
      addEventKeyword({ clientId, eventType, keyword: input.keyword, source, defaultValue: input.defaultValue }),
    onSuccess: () => {
      setKeyword("");
      setValue("");
      onChanged();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const update = useMutation({
    mutationFn: (p: { id: string; active?: boolean; source?: Source }) => updateEventKeyword(p),
    onSuccess: onChanged,
    onError: (e) => toast.error(errMsg(e)),
  });
  const remove = useMutation({
    mutationFn: (rid: string) => deleteEventKeyword(rid),
    onSuccess: onChanged,
    onError: (e) => toast.error(errMsg(e)),
  });

  const submit = () => {
    const defaultValue = isPurchase ? parseMoney(value) : null;
    if (defaultValue !== null && Number.isNaN(defaultValue)) {
      toast.error("Valor padrão inválido. Use algo como 1500 ou 1.500,00.");
      return;
    }
    add.mutate({ keyword, defaultValue });
  };

  const existing = new Set(rules.map((r) => r.keyword.toLowerCase()));
  const suggestions = SUGGESTIONS[eventType].filter((s) => !existing.has(s.toLowerCase()));

  return (
    <section className="mt-5">
      <h4 className="text-sm font-semibold">{title}</h4>
      <p className="text-xs text-muted-foreground mt-0.5 mb-2 max-w-lg">{help}</p>

      {loading ? (
        <Skeleton className="h-10 w-full" />
      ) : rules.length > 0 ? (
        <div className="rounded-md border divide-y mb-3">
          {rules.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <div className="flex-1 min-w-[150px]">
                <div className={r.active ? "text-sm font-medium" : "text-sm font-medium text-muted-foreground line-through"}>{r.keyword}</div>
                {isPurchase && (
                  <div className="text-xs text-muted-foreground">{r.defaultValue != null ? `Valor padrão ${brl(r.defaultValue)}` : "Sem valor padrão"}</div>
                )}
              </div>
              <Select value={r.source} onValueChange={(v) => v && update.mutate({ id: r.id, source: v as Source })}>
                <SelectTrigger className="w-[150px] h-8" aria-label={`Quem escreve: ${r.keyword}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="team">Equipe escreve</SelectItem>
                  <SelectItem value="lead">Lead escreve</SelectItem>
                  <SelectItem value="any">Qualquer um</SelectItem>
                </SelectContent>
              </Select>
              <Switch checked={r.active} onCheckedChange={(active) => update.mutate({ id: r.id, active })} aria-label={`${r.active ? "Desativar" : "Ativar"} ${r.keyword}`} />
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => remove.mutate(r.id)} disabled={remove.isPending} aria-label={`Remover ${r.keyword}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <span className="text-xs text-muted-foreground">Sugestões:</span>
          {suggestions.map((s) => (
            <Button key={s} type="button" size="sm" variant="outline" className="h-7 px-2.5 text-xs gap-1" disabled={add.isPending} onClick={() => add.mutate({ keyword: s, defaultValue: null })}>
              <Plus className="h-3 w-3" /> {s}
            </Button>
          ))}
        </div>
      )}

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (keyword.trim().length >= 2) submit();
        }}
      >
        <div className="flex-1 min-w-[170px]">
          <Label htmlFor={inputId} className="text-xs">Outra frase</Label>
          <Input id={inputId} value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder={isPurchase ? "ex.: fechou o pedido" : "ex.: passei o orçamento"} maxLength={80} />
        </div>
        <div className="w-[150px]">
          <Label htmlFor={`${inputId}-source`} className="text-xs">Quem escreve</Label>
          <Select value={source} onValueChange={(v) => v && setSource(v as Source)}>
            <SelectTrigger id={`${inputId}-source`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="team">Equipe</SelectItem>
              <SelectItem value="lead">Lead</SelectItem>
              <SelectItem value="any">Qualquer um</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {isPurchase && (
          <div className="w-[120px]">
            <Label htmlFor={`${inputId}-value`} className="text-xs">Valor (R$)</Label>
            <Input id={`${inputId}-value`} value={value} onChange={(e) => setValue(e.target.value)} placeholder="opcional" inputMode="decimal" />
          </div>
        )}
        <Button type="submit" variant="secondary" className="gap-2" disabled={add.isPending || keyword.trim().length < 2}>
          {add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Adicionar
        </Button>
      </form>
    </section>
  );
}

// ── Cartão: inteligência artificial (prévia) ─────────────────────────────────
// A análise automática ainda não roda: esta é a tela pra o gestor ver como fica.
// Nada aqui é salvo por enquanto.

function AiCard() {
  const [qualified, setQualified] = useState("");
  const [purchase, setPurchase] = useState("");
  const [minutes, setMinutes] = useState("15");

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Sparkles className="h-4.5 w-4.5 text-primary mt-0.5 shrink-0" />
          <div>
            <h3 className="text-base font-semibold flex items-center gap-2">
              Inteligência artificial <Badge variant="outline">Em breve</Badge>
            </h3>
            <p className="text-sm text-muted-foreground mt-0.5 max-w-lg">
              A IA lê a conversa de cada lead de anúncio e decide se ele é qualificado ou se comprou. Você só descreve o que é cada um.
            </p>
          </div>
        </div>
        <Switch checked={false} disabled aria-label="Ligar IA neste cliente (em breve)" />
      </div>

      <div className="mt-4 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        Prévia da tela: a análise automática ainda não está ativa, e o que você escrever aqui por enquanto não é salvo.
      </div>

      <div className="mt-4 space-y-4">
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <Label htmlFor="ai-qualified" className="text-sm">O que é um lead qualificado neste negócio?</Label>
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setQualified(AI_EXAMPLE_QUALIFIED)}>
              Usar exemplo
            </Button>
          </div>
          <Textarea id="ai-qualified" rows={4} value={qualified} onChange={(e) => setQualified(e.target.value)} placeholder="Descreva com suas palavras quem vale a pena atender." />
        </div>
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <Label htmlFor="ai-purchase" className="text-sm">O que é uma compra fechada?</Label>
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPurchase(AI_EXAMPLE_PURCHASE)}>
              Usar exemplo
            </Button>
          </div>
          <Textarea id="ai-purchase" rows={4} value={purchase} onChange={(e) => setPurchase(e.target.value)} placeholder="Descreva quando dá pra ter certeza de que a venda aconteceu." />
        </div>
      </div>

      <div className="mt-5 rounded-md border px-3 py-3">
        <div className="text-sm font-medium mb-2">Como a IA trabalha</div>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex flex-wrap items-center gap-1.5">
            <span>Lê a conversa depois de</span>
            <Input className="h-7 w-16 px-2 text-center" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, "").slice(0, 3))} aria-label="Minutos sem mensagem" />
            <span>minutos sem ninguém falar.</span>
          </li>
          <li>
            <strong className="font-medium text-foreground">No máximo 10 análises por lead.</strong> Protege seu gasto na OpenAI: um lead normal se resolve em 2 ou 3 leituras; o teto só pega contato que fica voltando por semanas.
          </li>
          <li>
            <strong className="font-medium text-foreground">Ignora lead sem mensagem há mais de 7 dias.</strong> A Meta recusa evento mais antigo que isso, então analisar seria gasto à toa.
          </li>
          <li>
            <strong className="font-medium text-foreground">Age sozinha só quando tem certeza.</strong> Com dúvida, vira uma sugestão pra você confirmar.
          </li>
        </ul>
        <div className="mt-3 pt-3 border-t flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Só sugerir, não enviar sozinha</div>
            <p className="text-xs text-muted-foreground">Recomendado nos primeiros dias: você vê o que a IA decidiria antes de deixá-la agir.</p>
          </div>
          <Switch checked disabled aria-label="Só sugerir, não enviar sozinha (em breve)" />
        </div>
      </div>
    </Card>
  );
}

// ── Histórico ────────────────────────────────────────────────────────────────

function HistorySection({
  rows,
  loading,
  onRefresh,
  refreshing,
}: {
  rows: MetaEventLogRow[] | undefined;
  loading: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? rows : rows?.slice(0, 8);

  return (
    <section>
      <div className="flex justify-end mb-2">
        <Button size="sm" variant="outline" className="gap-2" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw className={refreshing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          Atualizar
        </Button>
      </div>
      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : !visible || visible.length === 0 ? (
        <Card className="border-dashed p-4 text-sm text-muted-foreground">Nenhum evento enviado ainda.</Card>
      ) : (
        <Card className="divide-y">
          {visible.map((r) => (
            <div key={r.id} className="px-3 py-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={r.status === "sent" ? "secondary" : "destructive"}>{r.status === "sent" ? "Enviado" : "Falhou"}</Badge>
                <span className="font-medium">{EVENT_LABEL[r.eventType]}</span>
                <span className="text-muted-foreground">· {r.contactName ?? r.remoteJid.split("@")[0]}</span>
                <span className="ml-auto text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString("pt-BR")}</span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground space-y-0.5">
                <div>
                  {r.trigger === "keyword" ? `Palavra-chave “${r.keyword ?? ""}”` : "Botão ou etiqueta"}
                  {r.messageExcerpt ? ` — “${r.messageExcerpt}”` : ""}
                </div>
                {r.datasetId && (
                  <div>
                    Pixel {r.datasetId}
                    {r.pageId ? ` · Página ${r.pageId}` : ""}
                    {r.adName ? ` · ${r.adName}` : ""}
                  </div>
                )}
                {r.error && <div className="text-destructive">{r.error}</div>}
              </div>
            </div>
          ))}
        </Card>
      )}
      {rows && rows.length > 8 && (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Mostrar menos" : `Mostrar todos (${rows.length})`}
        </Button>
      )}
    </section>
  );
}

// ── Pixel de mensagem ────────────────────────────────────────────────────────

function PixelCard({ clientId, onSaved, n8nConfigured }: { clientId: string; onSaved: () => void; n8nConfigured: boolean }) {
  const queryClient = useQueryClient();
  const saved = useQuery({ queryKey: ["capi-dataset", clientId], queryFn: () => getCapiDataset(clientId) });
  const [value, setValue] = useState("");
  useEffect(() => {
    if (saved.data !== undefined) setValue(saved.data);
  }, [saved.data]);

  const save = useMutation({
    mutationFn: () => setCapiDataset(clientId, value.trim()),
    onSuccess: () => {
      toast.success("Pixel salvo.");
      queryClient.invalidateQueries({ queryKey: ["capi-dataset", clientId] });
      onSaved();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <Card className="p-4 mt-4">
      <Label htmlFor="capi-dataset" className="text-sm font-semibold">ID do pixel de mensagem</Label>
      <p className="text-xs text-muted-foreground mt-0.5 mb-3 max-w-xl">
        {n8nConfigured
          ? "É o pixel que recebe os eventos de lead qualificado e compra. Normalmente o sistema o descobre pelo próprio anúncio; este ID é usado quando um anúncio não tem pixel."
          : "É o pixel que recebe os eventos de lead qualificado e compra. Fica no Gerenciador de Eventos da Meta, em “Business Messaging”."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input id="capi-dataset" className="max-w-xs" value={value} onChange={(e) => setValue(e.target.value)} placeholder="ex.: 1234567890123456" inputMode="numeric" />
        <Button variant="secondary" onClick={() => save.mutate()} disabled={save.isPending || value.trim() === (saved.data ?? "")}>
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
        </Button>
      </div>
    </Card>
  );
}
