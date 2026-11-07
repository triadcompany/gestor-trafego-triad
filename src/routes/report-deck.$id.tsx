import { createFileRoute, redirect, useParams, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Download, Loader2, Plus, X, Play, ImagePlus, Save } from "lucide-react";
import { toast } from "sonner";
import { getCurrentUser } from "@/server/session";
import { isTriadCompanyOrg } from "@/lib/feature-flags";
import { fetchClientDetail } from "@/lib/queries";
import { getMetaToken, fetchCampaigns } from "@/lib/meta";
import { fetchReportDeck, upsertReportDeck, type ReportDeckRow, type ReportDeckFunilItem, type ReportDeckCreative } from "@/server/report-decks";
import { isoDateInBrasilia, daysAgoInBrasilia, monthRangeInBrasilia } from "@/lib/brasilia-date";

export const Route = createFileRoute("/report-deck/$id")({
  head: () => ({ meta: [{ title: "Relatório visual — Gestor de Tráfego" }] }),
  ssr: false,
  // Experimental — só pra organização Triad Company (ver memória "Triad
  // Company é a org do dono"), mesmo gate usado em /conversas.
  beforeLoad: async () => {
    const user = await getCurrentUser();
    const orgId = user?.actingOrganizationId ?? user?.organizationId;
    if (!isTriadCompanyOrg(orgId)) throw redirect({ to: "/dashboard" });
  },
  component: ReportDeckPage,
});

// ── Período dos números automáticos (Meta) ──────────────────────────────────

type Preset = "30" | "mes" | "mes_passado";
function rangeForPreset(preset: Preset): { since: string; until: string } {
  const today = isoDateInBrasilia();
  if (preset === "mes") return { since: monthRangeInBrasilia(0).start, until: today };
  if (preset === "mes_passado") {
    const r = monthRangeInBrasilia(-1);
    return { since: r.start, until: r.end };
  }
  return { since: daysAgoInBrasilia(30), until: today };
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// ── Blocos visuais compartilhados ────────────────────────────────────────────

// Tela de edição em 960x540 (16:9) — metade do tamanho final. Export usa
// scale:2 no html2canvas, resultando em exatamente 1920x1080 no PDF.
const PAGE_W = 960;
const PAGE_H = 540;
const EXPORT_SCALE = 2;

function Slide({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`relative overflow-hidden shrink-0 ${className}`}
      style={{ width: PAGE_W, height: PAGE_H, background: "#0a0a0c", color: "#fff" }}
    >
      <div
        className="absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-40 blur-[70px]"
        style={{ background: "radial-gradient(circle, #ff7a1a 0%, transparent 70%)" }}
      />
      <div
        className="absolute -left-28 bottom-10 h-72 w-72 rounded-full opacity-30 blur-[70px]"
        style={{ background: "radial-gradient(circle, #7a3bff 0%, transparent 70%)" }}
      />
      <div className="relative h-full w-full flex flex-col px-16 py-10">{children}</div>
      <div className="absolute bottom-7 right-10 text-[11px] font-semibold tracking-wide text-white/70">imperial <span className="font-normal opacity-70">marketing</span></div>
    </div>
  );
}

function SlideEyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-semibold tracking-[0.12em] text-orange-400 uppercase mb-2">{children}</p>;
}

function SlideTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[30px] font-bold leading-snug mb-6 max-w-[620px]">{children}</h2>;
}

// Input "invisível" — sem borda/fundo em repouso, só mostra que é editável no
// hover/foco. Fica igual texto normal no screenshot do export.
function Field({
  value,
  onChange,
  placeholder,
  className = "",
  as = "input",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  as?: "input" | "textarea";
}) {
  const common =
    "bg-transparent outline-none w-full placeholder:text-white/30 hover:bg-white/5 focus:bg-white/10 rounded px-1 -mx-1 transition-colors";
  if (as === "textarea") {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className={`${common} resize-none ${className}`}
      />
    );
  }
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`${common} ${className}`}
    />
  );
}

function BulletList({ items, onChange }: { items: string[]; onChange: (items: string[]) => void }) {
  const set = (i: number, v: string) => onChange(items.map((it, idx) => (idx === i ? v : it)));
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const add = () => onChange([...items, ""]);
  return (
    <div className="space-y-2.5 flex-1 max-w-[680px]">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-2 group">
          <span className="text-orange-400 mt-[9px] text-[10px] shrink-0">●</span>
          <Field as="textarea" value={item} onChange={(v) => set(i, v)} placeholder="Digite aqui..." className="text-[14px] leading-relaxed" />
          <button
            type="button"
            onClick={() => remove(i)}
            className="opacity-0 group-hover:opacity-100 shrink-0 mt-1 text-white/40 hover:text-white/80 print:hidden"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      <button type="button" onClick={add} className="flex items-center gap-1.5 text-[11px] text-white/50 hover:text-white/90 mt-1">
        <Plus className="h-3 w-3" /> adicionar item
      </button>
    </div>
  );
}

function MetricCard({ label, value, color = "border-orange-500/60" }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div className={`rounded-md border ${color} px-3 py-2.5`}>
      <p className="text-[10px] font-semibold text-orange-300 uppercase tracking-wide mb-1">{label}</p>
      <div className="text-[15px] font-bold leading-tight">{value}</div>
    </div>
  );
}

// ── Página ────────────────────────────────────────────────────────────────

function ReportDeckPage() {
  const { id } = useParams({ from: "/report-deck/$id" });
  const [preset, setPreset] = useState<Preset>("mes");
  const [deck, setDeck] = useState<ReportDeckRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: client } = useQuery({ queryKey: ["client", id], queryFn: () => fetchClientDetail(id) });
  const range = useMemo(() => rangeForPreset(preset), [preset]);

  const { data: campaigns = [] } = useQuery({
    queryKey: ["report-deck-campaigns", id, range.since, range.until],
    queryFn: async () => {
      const token = await getMetaToken(id);
      if (!token || !client) return [];
      return fetchCampaigns(client.meta_ad_account_id, token, "today", range);
    },
    enabled: !!client,
  });

  const { data: savedDeck, isLoading: deckLoading } = useQuery({ queryKey: ["report-deck", id], queryFn: () => fetchReportDeck(id) });

  useEffect(() => {
    if (savedDeck && !deck) setDeck(savedDeck);
  }, [savedDeck, deck]);

  // Auto-save com debounce — 1.2s depois da última mudança.
  useEffect(() => {
    if (!deck) return;
    setSaving(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await upsertReportDeck({
          clientId: id,
          coverLogoBase64: deck.cover_logo_base64,
          coverLogoMimetype: deck.cover_logo_mimetype,
          metaCustoVenda: deck.meta_custo_venda,
          metaFaturamento: deck.meta_faturamento,
          metaVendas: deck.meta_vendas,
          metaRoi: deck.meta_roi,
          metaSeguidores: deck.meta_seguidores,
          diagnosticoItems: deck.diagnostico_items,
          creatives: deck.creatives,
          funilItems: deck.funil_items,
          planoAcaoItems: deck.plano_acao_items,
          consideracoesItems: deck.consideracoes_items,
        });
      } catch {
        toast.error("Erro ao salvar — suas últimas edições podem não ter sido salvas.");
      } finally {
        setSaving(false);
      }
    }, 1200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck]);

  const patch = (fields: Partial<ReportDeckRow>) => setDeck((d) => (d ? { ...d, ...fields } : d));

  const totals = useMemo(() => {
    const spend = campaigns.reduce((s, c) => s + c.spend, 0);
    const impressions = campaigns.reduce((s, c) => s + c.impressions, 0);
    const leads = campaigns.reduce((s, c) => s + c.leads + c.forms, 0);
    const cpl = leads > 0 ? spend / leads : null;
    return { spend, impressions, leads, cpl };
  }, [campaigns]);

  const handleLogoUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      patch({ cover_logo_base64: result.split(",")[1] ?? result, cover_logo_mimetype: file.type });
    };
    reader.readAsDataURL(file);
  };

  const handleCreativeUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const creative: ReportDeckCreative = {
        base64: result.split(",")[1] ?? result,
        mimetype: file.type,
        filename: file.name,
        caption: "",
      };
      patch({ creatives: [creative] });
    };
    reader.readAsDataURL(file);
  };

  const setFunilItems = (items: ReportDeckFunilItem[]) => patch({ funil_items: items });

  const exportPdf = async () => {
    setExporting(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
      const outW = PAGE_W * EXPORT_SCALE;
      const outH = PAGE_H * EXPORT_SCALE;
      const doc = new jsPDF({ orientation: "landscape", unit: "px", format: [outW, outH] });
      for (let i = 0; i < slideRefs.current.length; i++) {
        const el = slideRefs.current[i];
        if (!el) continue;
        const canvas = await html2canvas(el, { scale: EXPORT_SCALE, backgroundColor: "#0a0a0c" });
        const img = canvas.toDataURL("image/jpeg", 0.92);
        if (i > 0) doc.addPage([outW, outH], "landscape");
        doc.addImage(img, "JPEG", 0, 0, outW, outH);
      }
      doc.save(`relatorio-visual-${client?.name ?? "cliente"}.pdf`);
      toast.success("PDF exportado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao exportar PDF.");
    } finally {
      setExporting(false);
    }
  };

  if (deckLoading || !deck || !client) {
    return (
      <AppShell>
        <div className="px-4 md:px-8 py-10 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    );
  }

  const dataStr = new Date().toLocaleDateString("pt-BR");

  return (
    <AppShell>
      <div className="px-4 md:px-8 py-6">
        <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
          <div className="flex items-center gap-3">
            <Button asChild size="icon" variant="ghost">
              <Link to="/clients/$id" params={{ id }} search={{ openCampaignId: undefined }}><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Relatório visual — {client.name}</h1>
              <p className="text-xs text-muted-foreground font-mono flex items-center gap-1.5">
                {saving ? <><Loader2 className="h-3 w-3 animate-spin" /> salvando...</> : <><Save className="h-3 w-3" /> salvo</>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={preset} onValueChange={(v) => setPreset(v as Preset)}>
              <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="30">Últimos 30 dias</SelectItem>
                <SelectItem value="mes">Mês atual</SelectItem>
                <SelectItem value="mes_passado">Mês passado</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={exportPdf} disabled={exporting} className="gap-2">
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Exportar PDF
            </Button>
          </div>
        </div>

        <div className="flex flex-col items-center gap-8 pb-10">
          {/* Página 1 — Capa */}
          <div ref={(el) => { slideRefs.current[0] = el; }}>
            <Slide>
              <div className="flex-1 flex items-center justify-between gap-8">
                <div>
                  <h1 className="text-[64px] font-extrabold leading-[1.05] mb-3">Relatório<br />Mensal</h1>
                  <p className="text-base text-white/60">{dataStr}</p>
                </div>
                <label className="shrink-0 cursor-pointer">
                  {deck.cover_logo_base64 ? (
                    <img
                      src={`data:${deck.cover_logo_mimetype};base64,${deck.cover_logo_base64}`}
                      alt=""
                      className="h-56 object-contain"
                    />
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs text-white/40 border border-dashed border-white/20 rounded px-2.5 py-1.5">
                      <ImagePlus className="h-3.5 w-3.5" /> logo do cliente
                    </span>
                  )}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleLogoUpload(e.target.files[0])} />
                </label>
              </div>
            </Slide>
          </div>

          {/* Página 2 — Resultado Meta Ads */}
          <div ref={(el) => { slideRefs.current[1] = el; }}>
            <Slide>
              <SlideEyebrow>Desempenho</SlideEyebrow>
              <SlideTitle>Resultado Meta Ads</SlideTitle>
              <div className="grid grid-cols-4 gap-3.5">
                <MetricCard label="Valor investido" value={brl(totals.spend)} />
                <MetricCard label="Impressões" value={totals.impressions.toLocaleString("pt-BR")} />
                <MetricCard label="Leads" value={totals.leads.toLocaleString("pt-BR")} />
                <MetricCard label="Custo por lead" value={totals.cpl !== null ? brl(totals.cpl) : "—"} />
                <MetricCard label="Custo por venda" value={<Field value={deck.meta_custo_venda ?? ""} onChange={(v) => patch({ meta_custo_venda: v })} placeholder="-" />} color="border-green-500/50" />
                <MetricCard label="Faturamento" value={<Field value={deck.meta_faturamento ?? ""} onChange={(v) => patch({ meta_faturamento: v })} placeholder="Consultar loja" />} color="border-green-500/50" />
                <MetricCard label="Vendas" value={<Field value={deck.meta_vendas ?? ""} onChange={(v) => patch({ meta_vendas: v })} placeholder="-" />} color="border-green-500/50" />
                <MetricCard label="Retorno sobre investimento" value={<Field value={deck.meta_roi ?? ""} onChange={(v) => patch({ meta_roi: v })} placeholder="Consultar loja" />} color="border-green-500/50" />
              </div>
              <div className="mt-4 max-w-[220px]">
                <MetricCard label="Seguidores" value={<Field value={deck.meta_seguidores ?? ""} onChange={(v) => patch({ meta_seguidores: v })} placeholder="-" />} />
              </div>
            </Slide>
          </div>

          {/* Página 3 — Diagnóstico */}
          <div ref={(el) => { slideRefs.current[2] = el; }}>
            <Slide>
              <SlideEyebrow>Análise</SlideEyebrow>
              <SlideTitle>Diagnóstico do Tráfego e Plano de Ação do Tráfego</SlideTitle>
              <BulletList items={deck.diagnostico_items} onChange={(items) => patch({ diagnostico_items: items })} />
            </Slide>
          </div>

          {/* Página 4 — Melhores Criativos */}
          <div ref={(el) => { slideRefs.current[3] = el; }}>
            <Slide>
              <SlideEyebrow>Destaque</SlideEyebrow>
              <SlideTitle>Melhores Criativos</SlideTitle>
              <div className="flex-1 flex flex-col items-center justify-center">
                {deck.creatives[0] ? (
                  <div className="relative">
                    <img
                      src={`data:${deck.creatives[0].mimetype};base64,${deck.creatives[0].base64}`}
                      alt=""
                      className="max-h-[420px] rounded-lg border border-white/10 object-contain"
                    />
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <span className="h-10 w-10 rounded-full bg-black/50 flex items-center justify-center">
                        <Play className="h-4 w-4 text-white fill-white" />
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => patch({ creatives: [] })}
                      className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-black/70 flex items-center justify-center text-white/80 hover:text-white print:hidden"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center gap-2 text-sm text-white/40 border border-dashed border-white/20 rounded-lg px-8 py-10 cursor-pointer">
                    <ImagePlus className="h-6 w-6" />
                    Enviar imagem/thumbnail do criativo
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleCreativeUpload(e.target.files[0])} />
                  </label>
                )}
                <div className="mt-4 w-full max-w-sm">
                  <Field
                    value={deck.creatives[0]?.caption ?? ""}
                    onChange={(v) => patch({ creatives: deck.creatives[0] ? [{ ...deck.creatives[0], caption: v }] : [] })}
                    placeholder="Legenda (ex: Criativos com 2 veículos)"
                    className="text-center text-xs text-white/60"
                  />
                </div>
              </div>
            </Slide>
          </div>

          {/* Página 5 — Funil de Vendas */}
          <div ref={(el) => { slideRefs.current[4] = el; }}>
            <Slide>
              <SlideEyebrow>Conversão</SlideEyebrow>
              <SlideTitle>Funil de Vendas</SlideTitle>
              <div className="flex-1 flex flex-col justify-center gap-2.5 max-w-[620px]">
                {deck.funil_items.map((item, i) => {
                  const widthPct = 100 - i * (60 / Math.max(1, deck.funil_items.length - 1));
                  return (
                    <div key={i} className="flex items-center gap-3 group">
                      <div
                        className="h-10 rounded flex items-center px-3"
                        style={{ width: `${Math.max(30, widthPct)}%`, background: `linear-gradient(90deg, #ff7a1a, #7a3bff)`, opacity: 0.85 - i * 0.08 }}
                      >
                        <Field
                          value={item.label}
                          onChange={(v) => setFunilItems(deck.funil_items.map((it, idx) => (idx === i ? { ...it, label: v } : it)))}
                          placeholder="Etapa"
                          className="text-[12px] font-semibold text-white"
                        />
                      </div>
                      <Field
                        value={item.value}
                        onChange={(v) => setFunilItems(deck.funil_items.map((it, idx) => (idx === i ? { ...it, value: v } : it)))}
                        placeholder="valor"
                        className="text-[12px] text-white/70 w-28"
                      />
                      <button
                        type="button"
                        onClick={() => setFunilItems(deck.funil_items.filter((_, idx) => idx !== i))}
                        className="opacity-0 group-hover:opacity-100 text-white/40 hover:text-white/80 print:hidden shrink-0"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setFunilItems([...deck.funil_items, { label: "", value: "" }])}
                  className="flex items-center gap-1.5 text-[11px] text-white/50 hover:text-white/90 mt-1"
                >
                  <Plus className="h-3 w-3" /> adicionar etapa
                </button>
              </div>
            </Slide>
          </div>

          {/* Página 6 — Plano de Ação do Comercial */}
          <div ref={(el) => { slideRefs.current[5] = el; }}>
            <Slide>
              <SlideEyebrow>Comercial</SlideEyebrow>
              <SlideTitle>Plano de Ação do Comercial</SlideTitle>
              <BulletList items={deck.plano_acao_items} onChange={(items) => patch({ plano_acao_items: items })} />
            </Slide>
          </div>

          {/* Página 7 — Considerações finais */}
          <div ref={(el) => { slideRefs.current[6] = el; }}>
            <Slide>
              <SlideEyebrow>Fechamento</SlideEyebrow>
              <SlideTitle>Considerações Finais</SlideTitle>
              <BulletList items={deck.consideracoes_items} onChange={(items) => patch({ consideracoes_items: items })} />
            </Slide>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
