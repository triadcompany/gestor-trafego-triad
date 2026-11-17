import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, Plus, RefreshCw, Target, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { fetchClientDetail } from "@/lib/queries";
import {
  addEventKeyword,
  deleteEventKeyword,
  getConversionsReadiness,
  listEventKeywords,
  listMetaEventLog,
  reapplyWhatsappWebhook,
  updateEventKeyword,
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

const SOURCE_LABEL: Record<Source, string> = { team: "Equipe", lead: "Lead", any: "Qualquer um" };
const EVENT_LABEL: Record<MetaEventLogRow["eventType"], string> = { qualified: "Lead qualificado", lead: "Lead", purchase: "Compra" };
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Algo deu errado. Tente de novo.");

// "1.500,50" / "1500.5" / "" → número ou null (vazio) ou NaN (inválido)
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

  const reapply = useMutation({
    mutationFn: () => reapplyWhatsappWebhook(id),
    onSuccess: () => toast.success("Conexão do WhatsApp atualizada."),
    onError: (e) => toast.error(errMsg(e)),
  });

  const refreshRules = () => queryClient.invalidateQueries({ queryKey: ["event-keywords", id] });
  const allRules = rules.data ?? [];

  return (
    <AppShell>
      <div className="px-4 md:px-8 py-6 max-w-3xl mx-auto pb-28">
        <Link to="/clients/$id" params={{ id }} search={{ openCampaignId: undefined }} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar pro cliente
        </Link>

        <div className="flex items-start gap-3 mb-6">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
            <Target className="h-4.5 w-4.5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Conversões{client.data ? ` — ${client.data.name}` : ""}</h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              Quando uma dessas palavras aparecer na conversa de um lead que veio de anúncio, o sistema qualifica o lead ou
              registra a compra e avisa a Meta sozinho. Os botões Qualificar e Converter continuam funcionando.
            </p>
          </div>
        </div>

        <ReadinessCard
          loading={readiness.isLoading}
          data={readiness.data}
          onReapply={() => reapply.mutate()}
          reapplying={reapply.isPending}
        />

        <KeywordSection
          clientId={id}
          eventType="qualified_lead"
          title="Lead qualificado"
          help="Ex.: “orçamento enviado”, “agendou visita”. Marca o lead como qualificado e envia o evento pra Meta."
          rules={allRules.filter((r) => r.eventType === "qualified_lead")}
          loading={rules.isLoading}
          onChanged={refreshRules}
        />
        <KeywordSection
          clientId={id}
          eventType="purchase"
          title="Compra"
          help="Ex.: “negócio fechado”, “pagamento confirmado”. Cria a venda e envia a compra pra Meta. Se a mensagem tiver “R$ 1.500,00”, esse valor é usado; senão vale o valor padrão da palavra (ou vai sem valor)."
          rules={allRules.filter((r) => r.eventType === "purchase")}
          loading={rules.isLoading}
          onChanged={refreshRules}
        />

        <HistorySection rows={history.data} loading={history.isLoading} onRefresh={() => history.refetch()} refreshing={history.isFetching} />
      </div>
    </AppShell>
  );
}

// ── Prontidão ────────────────────────────────────────────────────────────────

function ReadinessCard({
  loading,
  data,
  onReapply,
  reapplying,
}: {
  loading: boolean;
  data: Awaited<ReturnType<typeof getConversionsReadiness>> | undefined;
  onReapply: () => void;
  reapplying: boolean;
}) {
  const items: Array<{ ok: boolean; warn?: boolean; text: string }> = data
    ? [
        { ok: data.metaTokenOk, text: data.metaTokenOk ? "Conta da Meta conectada." : "Conta da Meta sem acesso válido — reconecte o Facebook." },
        { ok: data.whatsappConnected, text: data.whatsappConnected ? "WhatsApp do cliente conectado." : "Sem WhatsApp conectado: as palavras-chave não têm como ler as conversas." },
        {
          ok: data.n8nConfigured,
          warn: true,
          text: data.n8nConfigured
            ? "Envio pelo n8n ativo: o pixel é descoberto pelo anúncio."
            : data.fallbackDatasetSet
              ? "Envio direto: usando o conjunto de dados cadastrado no cliente."
              : "Envio direto sem conjunto de dados cadastrado no cliente — os eventos vão falhar.",
        },
      ]
    : [];

  return (
    <Card className="p-4 mb-6">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold">Está tudo pronto?</h2>
        <Button size="sm" variant="outline" className="gap-2" onClick={onReapply} disabled={reapplying || !data?.whatsappConnected}>
          {reapplying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Atualizar conexão do WhatsApp
        </Button>
      </div>
      {loading ? (
        <Skeleton className="h-16 w-full mt-3" />
      ) : (
        <ul className="mt-3 space-y-2 text-sm">
          {items.map((it, i) => (
            <li key={i} className="flex items-start gap-2">
              {it.ok ? <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-600 shrink-0" /> : <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" />}
              <span>{it.text}</span>
            </li>
          ))}
          {data && data.noPixelFailuresLast7d > 0 && (
            <li className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" />
              <span>
                {data.noPixelFailuresLast7d} {data.noPixelFailuresLast7d === 1 ? "evento falhou" : "eventos falharam"} nos últimos 7 dias porque o anúncio não tem
                pixel de mensagem. Confira o pixel no anúncio ou cadastre o conjunto de dados no cliente.
              </span>
            </li>
          )}
        </ul>
      )}
      <p className="text-xs text-muted-foreground mt-3">
        “Atualizar conexão” é preciso uma vez nos WhatsApps criados antes desta tela, pra que as mensagens enviadas pelo sistema também sejam lidas.
      </p>
    </Card>
  );
}

// ── Lista de palavras-chave ──────────────────────────────────────────────────

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
    mutationFn: () => {
      const defaultValue = isPurchase ? parseMoney(value) : null;
      if (defaultValue !== null && Number.isNaN(defaultValue)) throw new Error("Valor padrão inválido. Use algo como 1500 ou 1.500,00.");
      return addEventKeyword({ clientId, eventType, keyword, source, defaultValue });
    },
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

  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-3 max-w-xl">{help}</p>

      <form
        className="flex flex-wrap items-end gap-2 mb-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (keyword.trim().length >= 2) add.mutate();
        }}
      >
        <div className="flex-1 min-w-[180px]">
          <Label htmlFor={inputId} className="text-xs">Palavra ou frase</Label>
          <Input id={inputId} value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder={isPurchase ? "negócio fechado" : "orçamento enviado"} maxLength={80} />
        </div>
        <div className="w-[150px]">
          <Label htmlFor={`${inputId}-source`} className="text-xs">Quem escreve</Label>
          <Select value={source} onValueChange={(v) => v && setSource(v as Source)}>
            <SelectTrigger id={`${inputId}-source`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="team">Equipe</SelectItem>
              <SelectItem value="lead">Lead</SelectItem>
              <SelectItem value="any">Qualquer um</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {isPurchase && (
          <div className="w-[130px]">
            <Label htmlFor={`${inputId}-value`} className="text-xs">Valor padrão (R$)</Label>
            <Input id={`${inputId}-value`} value={value} onChange={(e) => setValue(e.target.value)} placeholder="opcional" inputMode="decimal" />
          </div>
        )}
        <Button type="submit" className="gap-2" disabled={add.isPending || keyword.trim().length < 2}>
          {add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Adicionar
        </Button>
      </form>

      {loading ? (
        <Skeleton className="h-12 w-full" />
      ) : rules.length === 0 ? (
        <Card className="border-dashed p-4 text-sm text-muted-foreground">Nenhuma palavra cadastrada ainda.</Card>
      ) : (
        <Card className="divide-y">
          {rules.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="flex-1 min-w-[160px]">
                <div className={r.active ? "font-medium" : "font-medium text-muted-foreground line-through"}>{r.keyword}</div>
                {isPurchase && (
                  <div className="text-xs text-muted-foreground">{r.defaultValue != null ? `Valor padrão ${brl(r.defaultValue)}` : "Sem valor padrão"}</div>
                )}
              </div>
              <Select value={r.source} onValueChange={(v) => v && update.mutate({ id: r.id, source: v as Source })}>
                <SelectTrigger className="w-[130px] h-8" aria-label={`Quem escreve: ${r.keyword}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="team">Equipe</SelectItem>
                  <SelectItem value="lead">Lead</SelectItem>
                  <SelectItem value="any">Qualquer um</SelectItem>
                </SelectContent>
              </Select>
              <Switch checked={r.active} onCheckedChange={(active) => update.mutate({ id: r.id, active })} aria-label={`${r.active ? "Desativar" : "Ativar"} ${r.keyword}`} />
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => remove.mutate(r.id)} disabled={remove.isPending} aria-label={`Remover ${r.keyword}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </Card>
      )}
    </section>
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
  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-base font-semibold">Últimos eventos enviados</h2>
        <Button size="sm" variant="outline" className="gap-2" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw className={refreshing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          Atualizar
        </Button>
      </div>
      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : !rows || rows.length === 0 ? (
        <Card className="border-dashed p-4 text-sm text-muted-foreground">Nenhum evento enviado ainda.</Card>
      ) : (
        <Card className="divide-y">
          {rows.map((r) => (
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
    </section>
  );
}
