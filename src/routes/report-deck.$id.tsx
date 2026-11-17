import { createFileRoute, redirect, useParams, useSearch, Link } from "@tanstack/react-router";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Download, Loader2, Plus, X, Play, ImagePlus, Save, Eye, EyeOff, Trash2, GripVertical, Bold, Type } from "lucide-react";
import { toast } from "sonner";
import { getCurrentUser } from "@/server/session";
import { isTriadCompanyOrg } from "@/lib/feature-flags";
import { fetchClientDetail } from "@/lib/queries";
import { getMetaToken, fetchCampaigns, fetchOptimizationInsights, fetchAllAds, fetchAdBestImageUrl } from "@/lib/meta";
import { fetchRemoteImage } from "@/server/deck-creative";
import { fetchClientBrand } from "@/server/client-brand";
import { DEFAULT_DIAGNOSTICO, DEFAULT_PLANO_TRAFEGO } from "@/server/report-decks";
import { buildAutoLists, mergeAuto, pickBestAd, sameList } from "@/lib/deck-auto";
import { fetchReportDeck, upsertReportDeck, sendReportPdfToOperationalGroup, type ReportDeckRow, type ReportDeckFunilItem, type ReportDeckCreative, type ReportDeckCustomPage, type ReportDeckTextBox } from "@/server/report-decks";
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
  validateSearch: (s: Record<string, unknown>): { since?: string; until?: string } => {
    const ok = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
    return { since: ok(s.since), until: ok(s.until) };
  },
  component: ReportDeckPage,
});

// ── Período dos números automáticos (Meta) ──────────────────────────────────

type Preset = "30" | "mes" | "mes_passado" | "custom";
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

// html2canvas 1.4 não entende cores modernas (oklch, oklab, color-mix...) que o
// Tailwind gera. No clone usado na captura, varre TODAS as propriedades de cada
// elemento (e de ::before/::after) e troca cada cor moderna pelo rgb equivalente.
const MODERN_COLOR = /(?:oklch|oklab|color-mix|lab|lch|color)\(/;
const MODERN_COLOR_G = /(?:oklch|oklab|color-mix|lab|lch|color)\(/g;

function replaceModernColors(value: string, toRgb: (c: string) => string): string {
  let out = "";
  let last = 0;
  MODERN_COLOR_G.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MODERN_COLOR_G.exec(value))) {
    // não casa "rgb(" nem nomes que só terminam em lab/lch/color
    if (m.index > 0 && /[\w-]/.test(value[m.index - 1])) continue;
    let depth = 0;
    let end = m.index + m[0].length - 1;
    for (; end < value.length; end++) {
      if (value[end] === "(") depth++;
      else if (value[end] === ")" && --depth === 0) break;
    }
    out += value.slice(last, m.index) + toRgb(value.slice(m.index, end + 1));
    last = end + 1;
    MODERN_COLOR_G.lastIndex = last;
  }
  return out + value.slice(last);
}

function sanitizeModernColors(clonedDoc: Document) {
  const canvas = clonedDoc.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const view = clonedDoc.defaultView;
  if (!ctx || !view) return;
  const toRgb = (value: string) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
  };
  const pseudoRules: string[] = [];
  let n = 0;
  // Só o slide em captura (+ html/body, que a lib também lê): varrer o documento
  // inteiro a cada slide era o que deixava a exportação lenta.
  const root = clonedDoc.querySelector<HTMLElement>("[data-h2c-root]");
  const targets: HTMLElement[] = [clonedDoc.documentElement, clonedDoc.body];
  if (root) targets.push(root, ...Array.from(root.querySelectorAll<HTMLElement>("*")));
  targets.forEach((el) => {
    const cs = view.getComputedStyle(el);
    for (let k = 0; k < cs.length; k++) {
      const prop = cs[k];
      const v = cs.getPropertyValue(prop);
      if (v && MODERN_COLOR.test(v)) el.style.setProperty(prop, replaceModernColors(v, toRgb), "important");
    }
    for (const pseudo of ["::before", "::after"]) {
      const ps = view.getComputedStyle(el, pseudo);
      const decls: string[] = [];
      for (let k = 0; k < ps.length; k++) {
        const prop = ps[k];
        const v = ps.getPropertyValue(prop);
        if (v && MODERN_COLOR.test(v)) decls.push(`${prop}: ${replaceModernColors(v, toRgb)} !important`);
      }
      if (decls.length) {
        el.setAttribute("data-h2c", String(n));
        pseudoRules.push(`[data-h2c="${n}"]${pseudo} { ${decls.join("; ")} }`);
        n++;
      }
    }
  });
  if (pseudoRules.length) {
    const style = clonedDoc.createElement("style");
    style.textContent = pseudoRules.join("\n");
    clonedDoc.head.appendChild(style);
  }
}

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

// Contexto de edição livre: o slide atual e os deslocamentos dos textos fixos.
const EditCtx = createContext<{
  slideId: string;
  offsets: Record<string, { x: number; y: number }>;
  setOffset: (key: string, x: number, y: number) => void;
}>({ slideId: "", offsets: {}, setOffset: () => {} });

// Alça de arrastar (fora da captura do PDF). Mexe só em posição, não no texto.
function useDragger(x: number, y: number, set: (x: number, y: number) => void) {
  const start = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      start.current = { px: e.clientX, py: e.clientY, x, y };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const d = start.current;
      if (d) set(Math.round(d.x + e.clientX - d.px), Math.round(d.y + e.clientY - d.py));
    },
    onPointerUp: () => (start.current = null),
    onPointerCancel: () => (start.current = null),
  };
}

// Envolve um texto fixo do slide pra poder arrastar pela alça à esquerda.
function Movable({ name, children }: { name: string; children: React.ReactNode }) {
  const { slideId, offsets, setOffset } = useContext(EditCtx);
  const key = `${slideId}:${name}`;
  const o = offsets[key] ?? { x: 0, y: 0 };
  const drag = useDragger(o.x, o.y, (x, y) => setOffset(key, x, y));
  return (
    <div className="relative group/mv" style={{ transform: `translate(${o.x}px, ${o.y}px)` }}>
      <div
        data-html2canvas-ignore
        {...drag}
        title="Arrastar"
        className="absolute -left-6 top-1 h-5 w-5 flex items-center justify-center rounded bg-white/10 text-white/70 cursor-grab active:cursor-grabbing opacity-0 group-hover/mv:opacity-100 touch-none"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </div>
      {children}
    </div>
  );
}

function SlideEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <Movable name="eyebrow">
      <p className="text-[11px] font-semibold tracking-[0.12em] text-orange-400 uppercase mb-2">{children}</p>
    </Movable>
  );
}

function SlideTitle({ children }: { children: React.ReactNode }) {
  return (
    <Movable name="title">
      <h2 className="text-[30px] font-bold leading-snug mb-6 max-w-[620px]">{children}</h2>
    </Movable>
  );
}

// Caixa de texto livre: arrasta pela alça, ajusta tamanho/negrito, exclui.
function TextBoxView({
  box,
  onChange,
  onRemove,
}: {
  box: ReportDeckTextBox;
  onChange: (fields: Partial<ReportDeckTextBox>) => void;
  onRemove: () => void;
}) {
  const drag = useDragger(box.x, box.y, (x, y) => onChange({ x, y }));
  return (
    <div className="absolute group/tb pointer-events-auto" style={{ left: box.x, top: box.y, width: box.w }}>
      <div
        data-html2canvas-ignore
        className="absolute -top-7 left-0 flex items-center gap-1 rounded-md bg-black/80 px-1 py-0.5 text-white/80 opacity-0 group-hover/tb:opacity-100 group-focus-within/tb:opacity-100"
      >
        <span {...drag} title="Arrastar" className="h-5 w-5 flex items-center justify-center cursor-grab active:cursor-grabbing touch-none">
          <GripVertical className="h-3.5 w-3.5" />
        </span>
        <button type="button" title="Diminuir" className="h-5 w-5 text-[10px] hover:text-white" onClick={() => onChange({ size: Math.max(10, box.size - 2) })}>A-</button>
        <button type="button" title="Aumentar" className="h-5 w-5 text-xs hover:text-white" onClick={() => onChange({ size: Math.min(72, box.size + 2) })}>A+</button>
        <button type="button" title="Negrito" className={`h-5 w-5 flex items-center justify-center ${box.bold ? "text-orange-400" : "hover:text-white"}`} onClick={() => onChange({ bold: !box.bold })}>
          <Bold className="h-3 w-3" />
        </button>
        <button type="button" title="Mais estreita (largura)" className="h-5 px-1 text-[10px] hover:text-white" onClick={() => onChange({ w: Math.max(80, box.w - 40) })}>L-</button>
        <button type="button" title="Mais larga (largura)" className="h-5 px-1 text-[10px] hover:text-white" onClick={() => onChange({ w: Math.min(PAGE_W - box.x, box.w + 40) })}>L+</button>
        <button type="button" title="Excluir caixa" className="h-5 w-5 flex items-center justify-center hover:text-red-400" onClick={onRemove}>
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      <textarea
        value={box.text}
        onChange={(e) => onChange({ text: e.target.value })}
        placeholder="Digite aqui..."
        rows={1}
        style={{ fieldSizing: "content", fontSize: box.size, fontWeight: box.bold ? 700 : 400 } as React.CSSProperties}
        className="w-full resize-none bg-transparent outline-none leading-snug placeholder:text-white/30 hover:bg-white/5 focus:bg-white/10 rounded px-1 -mx-1 transition-colors text-white"
      />
    </div>
  );
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
        rows={1}
        style={{ fieldSizing: "content" } as React.CSSProperties}
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

function BulletList({ items, onChange, textClass = "text-[14px] leading-relaxed" }: { items: string[]; onChange: (items: string[]) => void; textClass?: string }) {
  const set = (i: number, v: string) => onChange(items.map((it, idx) => (idx === i ? v : it)));
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const add = () => onChange([...items, ""]);
  return (
    <Movable name="list">
    <div className="space-y-2.5 flex-1 max-w-[680px]">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-2 group">
          <span className="text-orange-400 mt-[9px] text-[10px] shrink-0">●</span>
          <Field as="textarea" value={item} onChange={(v) => set(i, v)} placeholder="Digite aqui..." className={textClass} />
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
    </Movable>
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

// Imagem do criativo: arrasta pra mudar a posição, controle de tamanho embaixo.
// Os controles ficam fora da captura do PDF (data-html2canvas-ignore).
function CreativeBox({
  creative,
  onChange,
  onRemove,
}: {
  creative: ReportDeckCreative;
  onChange: (c: ReportDeckCreative) => void;
  onRemove: () => void;
}) {
  const x = creative.x ?? 0;
  const y = creative.y ?? 0;
  const height = creative.height ?? 300;
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  return (
    <div
      className="relative mb-11 cursor-grab active:cursor-grabbing touch-none select-none"
      style={{ transform: `translate(${x}px, ${y}px)` }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { px: e.clientX, py: e.clientY, x, y };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        onChange({ ...creative, x: Math.round(d.x + e.clientX - d.px), y: Math.round(d.y + e.clientY - d.py), height });
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      <img
        src={`data:${creative.mimetype};base64,${creative.base64}`}
        alt=""
        draggable={false}
        style={{ height }}
        className="max-w-none rounded-lg border border-white/10 object-contain"
      />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span className="h-10 w-10 rounded-full bg-black/50 flex items-center justify-center">
          <Play className="h-4 w-4 text-white fill-white" />
        </span>
      </div>
      <div data-html2canvas-ignore data-no-drag className="absolute -top-2 -right-2 flex items-center gap-1">
        <button
          type="button"
          onClick={onRemove}
          className="h-6 w-6 rounded-full bg-black/70 flex items-center justify-center text-white/80 hover:text-white"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <div
        data-html2canvas-ignore
        data-no-drag
        className="absolute -bottom-9 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-[10px] text-white/70 cursor-default"
      >
        Tamanho
        <input
          type="range"
          min={120}
          max={520}
          value={height}
          onChange={(e) => onChange({ ...creative, x, y, height: Number(e.target.value) })}
          className="w-28"
        />
        <button type="button" className="underline hover:text-white" onClick={() => onChange({ ...creative, x: 0, y: 0, height: 300 })}>
          Centralizar
        </button>
      </div>
    </div>
  );
}

// Moldura de cada slide: barra com o olho (ocultar no PDF) fora da área
// capturada. Slide oculto aparece apagado aqui e não entra no PDF.
function SlideFrame({
  id,
  label,
  hidden,
  onToggle,
  onRemove,
  onAddBox,
  boxes,
  onBoxChange,
  onBoxRemove,
  offsets,
  setOffset,
  refs,
  children,
}: {
  id: string;
  label: string;
  hidden: boolean;
  onToggle: () => void;
  onRemove?: () => void;
  onAddBox: () => void;
  boxes: ReportDeckTextBox[];
  onBoxChange: (boxId: string, fields: Partial<ReportDeckTextBox>) => void;
  onBoxRemove: (boxId: string) => void;
  offsets: Record<string, { x: number; y: number }>;
  setOffset: (key: string, x: number, y: number) => void;
  refs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  children: React.ReactNode;
}) {
  return (
    <EditCtx.Provider value={{ slideId: id, offsets, setOffset }}>
    <div>
      <div className="flex items-center justify-between mb-1.5" style={{ width: PAGE_W }}>
        <span className="text-xs text-muted-foreground">
          {label}
          {hidden && " — oculto no relatório"}
        </span>
        <div className="flex items-center gap-1">
          <Button type="button" size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={onAddBox}>
            <Type className="h-3.5 w-3.5" /> Adicionar texto
          </Button>
          {onRemove && (
            <Button type="button" size="sm" variant="ghost" className="h-7 gap-1.5 text-xs text-muted-foreground" onClick={onRemove}>
              <Trash2 className="h-3.5 w-3.5" /> Excluir página
            </Button>
          )}
          <Button type="button" size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={onToggle} title={hidden ? "Mostrar no relatório" : "Ocultar do relatório"}>
            {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {hidden ? "Mostrar" : "Ocultar"}
          </Button>
        </div>
      </div>
      <div ref={(el) => { refs.current[id] = el; }} className={`relative ${hidden ? "opacity-30 transition-opacity" : "transition-opacity"}`} style={{ width: PAGE_W, height: PAGE_H }}>
        {children}
        {boxes.map((b) => (
          <TextBoxView key={b.id} box={b} onChange={(f) => onBoxChange(b.id, f)} onRemove={() => onBoxRemove(b.id)} />
        ))}
      </div>
    </div>
    </EditCtx.Provider>
  );
}

// ── Página ────────────────────────────────────────────────────────────────

const STANDARD_SLIDES = [
  { id: "capa" },
  { id: "resultado" },
  { id: "diagnostico" },
  { id: "plano_trafego" },
  { id: "criativos" },
  { id: "funil" },
  { id: "plano" },
  { id: "consideracoes" },
];

function ReportDeckPage() {
  const { id } = useParams({ from: "/report-deck/$id" });
  const search = useSearch({ from: "/report-deck/$id" });
  // Vindo da tela de Tarefas, o período já chega na URL: datas = personalizado
  const [preset, setPreset] = useState<Preset>(search.since && search.until ? "custom" : "30");
  const [customSince, setCustomSince] = useState(search.since ?? daysAgoInBrasilia(30));
  const [customUntil, setCustomUntil] = useState(search.until ?? isoDateInBrasilia());
  const [deck, setDeck] = useState<ReportDeckRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [sendToGroup, setSendToGroup] = useState(true);
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(null);
  const slideRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: client } = useQuery({ queryKey: ["client", id], queryFn: () => fetchClientDetail(id) });
  // Logo cadastrada no cliente: aparece na capa quando o relatório ainda não tem logo própria.
  const { data: brand } = useQuery({ queryKey: ["client-brand", id], queryFn: () => fetchClientBrand(id), staleTime: 60_000 });
  const range = useMemo(
    () => (preset === "custom" ? { since: customSince, until: customUntil } : rangeForPreset(preset)),
    [preset, customSince, customUntil]
  );

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
          metaValorInvestido: deck.meta_valor_investido,
          metaImpressoes: deck.meta_impressoes,
          metaLeadsCount: deck.meta_leads_count,
          metaCustoPorLead: deck.meta_custo_por_lead,
          diagnosticoItems: deck.diagnostico_items,
          creatives: deck.creatives,
          hiddenSlides: deck.hidden_slides,
          customPages: deck.custom_pages,
          textBoxes: deck.text_boxes,
          planoTrafegoItems: deck.plano_trafego_items,
          criativosItems: deck.criativos_items,
          autoLists: deck.auto_lists,
          offsets: deck.offsets,
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

  // Os 4 números automáticos seguem o período escolhido: ao abrir o relatório e
  // a cada troca de período eles são recalculados com o valor ao vivo da Meta.
  // Depois disso, edição manual vence até o período mudar de novo.
  const filledFor = useRef<string | null>(null);
  useEffect(() => {
    const key = `${range.since}|${range.until}`;
    if (!deck || campaigns.length === 0 || filledFor.current === key) return;
    filledFor.current = key;
    setDeck((d) =>
      d
        ? {
            ...d,
            meta_valor_investido: brl(totals.spend),
            meta_impressoes: totals.impressions.toLocaleString("pt-BR"),
            meta_leads_count: totals.leads.toLocaleString("pt-BR"),
            meta_custo_por_lead: totals.cpl !== null ? brl(totals.cpl) : "—",
          }
        : d
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns, deck === null, range.since, range.until]);

  // Diagnóstico e plano automáticos: números reais do período (mesmas regras da aba Otimização).
  const { data: optInsights, isFetched: optFetched, isError: optError } = useQuery({
    queryKey: ["report-deck-optimization", id, range.since, range.until],
    enabled: !!client,
    retry: false,
    queryFn: async () => {
      const token = await getMetaToken(id);
      if (!token || !client) return null;
      return fetchOptimizationInsights(client.meta_ad_account_id, token, range.since, range.until);
    },
  });
  const autoLists = useMemo(() => {
    if (!client || !optFetched || campaigns.length === 0) return null;
    return buildAutoLists({
      cpl: totals.cpl,
      leads: totals.leads,
      target: client.cpl_max > 0 ? { min: client.cpl_min, max: client.cpl_max } : null,
      insights: optInsights ?? null,
    });
  }, [client, optFetched, optInsights, campaigns.length, totals.cpl, totals.leads]);
  const autoSig = autoLists ? JSON.stringify(autoLists) : "";
  useEffect(() => {
    if (!autoLists) return;
    setDeck((d) => {
      if (!d) return d;
      const diag = mergeAuto(d.diagnostico_items, DEFAULT_DIAGNOSTICO, d.auto_lists.diagnostico, autoLists.diagnostico, true);
      const plano = mergeAuto(d.plano_trafego_items, DEFAULT_PLANO_TRAFEGO, d.auto_lists.plano, autoLists.plano, false);
      // Funil: "Contatos" = leads do período, enquanto o gestor não digitar outro valor.
      const ci = d.funil_items.findIndex((f) => f.label.trim().toLowerCase() === "contatos");
      let funil = d.funil_items;
      if (ci >= 0 && autoLists.contatos && (d.funil_items[ci].value.trim() === "" || d.funil_items[ci].value === d.auto_lists.contatos)) {
        funil = d.funil_items.map((f, i) => (i === ci ? { ...f, value: autoLists.contatos } : f));
      }
      const changed =
        !sameList(d.diagnostico_items, diag) ||
        !sameList(d.plano_trafego_items, plano) ||
        !sameList(d.auto_lists.diagnostico, autoLists.diagnostico) ||
        !sameList(d.auto_lists.plano, autoLists.plano) ||
        d.auto_lists.contatos !== autoLists.contatos ||
        funil !== d.funil_items;
      return changed
        ? { ...d, diagnostico_items: diag, plano_trafego_items: plano, funil_items: funil, auto_lists: { ...d.auto_lists, diagnostico: autoLists.diagnostico, plano: autoLists.plano, contatos: autoLists.contatos } }
        : d;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSig, deck === null]);

  // Sem os dados do período, os itens automáticos ficam como [preencher]: avisa em vez de falhar calado.
  useEffect(() => {
    if (optError) toast.error("Não consegui buscar os dados do período pro diagnóstico automático. Tente recarregar a página.", { id: "deck-opt-error" });
  }, [optError]);

  // Migração única do slide "Melhores Criativos" (layout novo: vídeo à esquerda, texto à direita):
  // posições arrastadas no layout antigo e caixas soltas com as mesmas orientações saem do caminho.
  useEffect(() => {
    if (!deck || deck.auto_lists.layoutV === 2) return;
    setDeck((d) => {
      if (!d || d.auto_lists.layoutV === 2) return d;
      const offsets = Object.fromEntries(Object.entries(d.offsets).filter(([k]) => !k.startsWith("criativos:")));
      const text_boxes = d.text_boxes.filter((b) => !(b.slide === "criativos" && /Falar (sempre km|valor, entrada)/i.test(b.text)));
      const creatives = d.creatives.map((c) => ({ ...c, x: undefined, y: undefined, height: undefined }));
      return { ...d, offsets, text_boxes, creatives, auto_lists: { ...d.auto_lists, layoutV: 2 } };
    });
  }, [deck === null]);

  // Melhores criativos: o anúncio com menor custo por conversa do período, com a imagem
  // de capa que a Meta guarda dele. Preenche sozinho enquanto o slide estiver vazio ou com
  // um criativo automático (arquivo "auto-<id>"); um criativo enviado por você nunca é trocado.
  const { data: periodAds } = useQuery({
    queryKey: ["report-deck-ads", id, range.since, range.until],
    enabled: !!client,
    retry: false,
    queryFn: async () => {
      const token = await getMetaToken(id);
      if (!token || !client) return [];
      return fetchAllAds(client.meta_ad_account_id, token, "today", range);
    },
  });
  const bestAd = useMemo(() => pickBestAd(periodAds ?? []), [periodAds]);
  const [creativeBusy, setCreativeBusy] = useState(false);
  const loadBestCreative = async (manual: boolean) => {
    if (!bestAd) {
      if (manual) toast.error("Nenhum anúncio teve conversas no período.");
      return;
    }
    setCreativeBusy(true);
    try {
      const token = await getMetaToken(id);
      if (!token) throw new Error("Token da Meta não encontrado.");
      const url = await fetchAdBestImageUrl(bestAd.ad.id, token);
      if (!url) throw new Error("A Meta não devolveu imagem desse anúncio.");
      const img = await fetchRemoteImage(url);
      const creative: ReportDeckCreative = {
        base64: img.base64,
        mimetype: img.mimetype,
        filename: `auto-${bestAd.ad.id}.${img.mimetype.includes("png") ? "png" : "jpg"}`,
        caption: `Anúncio com o menor custo por conversa do período.\nEsse anúncio gastou ${brl(bestAd.ad.spend ?? 0)} e teve ${bestAd.conversations} conversas, com custo por lead de ${brl(bestAd.cpl)}.`,
      };
      setDeck((d) => (d ? { ...d, creatives: [creative], auto_lists: { ...d.auto_lists, creativeAd: bestAd.ad.id } } : d));
      if (manual) toast.success("Melhor criativo do período aplicado.");
    } catch (e) {
      if (manual) toast.error(e instanceof Error ? e.message : "Erro ao buscar o criativo.");
    } finally {
      setCreativeBusy(false);
    }
  };
  useEffect(() => {
    if (!deck || !bestAd || creativeBusy) return;
    const cur = deck.creatives[0];
    if (cur && !cur.filename.startsWith("auto-")) return; // criativo enviado pelo gestor
    if (cur && cur.filename.startsWith(`auto-${bestAd.ad.id}.`)) return; // já é o melhor
    if (!cur && deck.auto_lists.creativeAd === bestAd.ad.id) return; // o gestor removeu esse mesmo
    void loadBestCreative(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck === null, bestAd?.ad.id]);

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

  const isHidden = (sid: string) => !!deck?.hidden_slides.includes(sid);
  const toggleHidden = (sid: string) =>
    setDeck((d) => (d ? { ...d, hidden_slides: d.hidden_slides.includes(sid) ? d.hidden_slides.filter((x) => x !== sid) : [...d.hidden_slides, sid] } : d));
  const addPage = () =>
    patch({ custom_pages: [...(deck?.custom_pages ?? []), { id: `pg-${Date.now().toString(36)}`, eyebrow: "", title: "", body: "" }] });
  const patchPage = (pid: string, fields: Partial<ReportDeckCustomPage>) =>
    setDeck((d) => (d ? { ...d, custom_pages: d.custom_pages.map((pg) => (pg.id === pid ? { ...pg, ...fields } : pg)) } : d));
  const removePage = (pid: string) =>
    setDeck((d) => (d ? { ...d, custom_pages: d.custom_pages.filter((pg) => pg.id !== pid), text_boxes: d.text_boxes.filter((b) => b.slide !== pid), hidden_slides: d.hidden_slides.filter((x) => x !== pid) } : d));

  const setOffset = (key: string, x: number, y: number) => setDeck((d) => (d ? { ...d, offsets: { ...d.offsets, [key]: { x, y } } } : d));
  const addBox = (slide: string) =>
    setDeck((d) =>
      d
        ? {
            ...d,
            text_boxes: [...d.text_boxes, { id: `tb-${Date.now().toString(36)}`, slide, text: "", x: 300, y: 220, w: 320, size: 18, bold: false }],
          }
        : d
    );
  const patchBox = (bid: string, fields: Partial<ReportDeckTextBox>) =>
    setDeck((d) => (d ? { ...d, text_boxes: d.text_boxes.map((b) => (b.id === bid ? { ...b, ...fields } : b)) } : d));
  const removeBox = (bid: string) => setDeck((d) => (d ? { ...d, text_boxes: d.text_boxes.filter((b) => b.id !== bid) } : d));
  const frameProps = (sid: string) => ({
    onAddBox: () => addBox(sid),
    boxes: deck?.text_boxes.filter((b) => b.slide === sid) ?? [],
    onBoxChange: patchBox,
    onBoxRemove: removeBox,
    offsets: deck?.offsets ?? {},
    setOffset,
  });

  const setFunilItems = (items: ReportDeckFunilItem[]) => patch({ funil_items: items });

  const exportPdf = async () => {
    if (!deck) return;
    setExporting(true);
    let toastId: string | number | undefined;
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
      const outW = PAGE_W * EXPORT_SCALE;
      const outH = PAGE_H * EXPORT_SCALE;
      const doc = new jsPDF({ orientation: "landscape", unit: "px", format: [outW, outH] });
      const ids = [...STANDARD_SLIDES.map((x) => x.id), ...deck.custom_pages.map((pg) => pg.id)].filter((sid) => !deck.hidden_slides.includes(sid));
      if (ids.length === 0) throw new Error("Todos os slides estão ocultos.");
      toastId = toast.loading(`Gerando PDF... 0 de ${ids.length}`);
      setExportProgress({ done: 0, total: ids.length });
      // deixa a tela pintar o "Gerando..." antes de começar o trabalho pesado
      await new Promise((r) => setTimeout(r, 30));
      let first = true;
      for (let i = 0; i < ids.length; i++) {
        const el = slideRefs.current[ids[i]];
        if (!el) continue;
        el.setAttribute("data-h2c-root", "1");
        let canvas: HTMLCanvasElement;
        try {
          canvas = await html2canvas(el, {
            scale: EXPORT_SCALE,
            backgroundColor: "#0a0a0c",
            logging: false,
            onclone: (d) => sanitizeModernColors(d),
          });
        } finally {
          el.removeAttribute("data-h2c-root");
        }
        const img = canvas.toDataURL("image/jpeg", 0.92);
        if (!first) doc.addPage([outW, outH], "landscape");
        first = false;
        doc.addImage(img, "JPEG", 0, 0, outW, outH);
        setExportProgress({ done: i + 1, total: ids.length });
        toast.loading(`Gerando PDF... ${i + 1} de ${ids.length}`, { id: toastId });
        await new Promise((r) => setTimeout(r, 0));
      }
      const fileName = `relatorio-visual-${client?.name ?? "cliente"}.pdf`;
      doc.save(fileName);
      if (sendToGroup) {
        toast.loading("Enviando pro grupo operacional...", { id: toastId });
        try {
          // jsPDF devolve "data:application/pdf;...;base64,XXXX"
          const pdfBase64 = doc.output("datauristring").split(",")[1] ?? "";
          const fmt = (iso: string) => iso.split("-").reverse().join("/");
          await sendReportPdfToOperationalGroup({
            clientId: id,
            pdfBase64,
            fileName,
            caption: `Relatório — ${client?.name ?? "cliente"} (${fmt(range.since)} a ${fmt(range.until)})`,
          });
          toast.success("PDF exportado e enviado pro grupo operacional.", { id: toastId });
        } catch (e) {
          toast.error(`PDF exportado, mas não foi enviado ao grupo: ${e instanceof Error ? e.message : "erro desconhecido"}`, { id: toastId });
        }
      } else {
        toast.success("PDF exportado.", { id: toastId });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao exportar PDF.", { id: toastId });
    } finally {
      setExporting(false);
      setExportProgress(null);
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

  const fmt = (iso: string) => iso.split("-").reverse().join("/");
  const dataStr = `${fmt(range.since)} a ${fmt(range.until)}`;

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
                <SelectItem value="custom">Personalizado</SelectItem>
              </SelectContent>
            </Select>
            {preset === "custom" && (
              <>
                <Input type="date" value={customSince} max={customUntil} onChange={(e) => e.target.value && setCustomSince(e.target.value)} className="h-9 w-36" />
                <span className="text-xs text-muted-foreground">até</span>
                <Input type="date" value={customUntil} min={customSince} max={isoDateInBrasilia()} onChange={(e) => e.target.value && setCustomUntil(e.target.value)} className="h-9 w-36" />
              </>
            )}
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
              <input type="checkbox" checked={sendToGroup} onChange={(e) => setSendToGroup(e.target.checked)} />
              Enviar ao grupo operacional
            </label>
            <Button onClick={exportPdf} disabled={exporting} className="gap-2">
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {exporting && exportProgress ? `Gerando ${exportProgress.done}/${exportProgress.total}...` : "Exportar PDF"}
            </Button>
          </div>
        </div>

        <div className="flex flex-col items-center gap-8 pb-10">
          {/* Página 1 — Capa */}
          <SlideFrame id="capa" label="Capa" hidden={isHidden("capa")} onToggle={() => toggleHidden("capa")} {...frameProps("capa")} refs={slideRefs}>
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
                  ) : brand?.logo ? (
                    <img src={brand.logo} alt="" className="h-56 max-w-[320px] object-contain" />
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs text-white/40 border border-dashed border-white/20 rounded px-2.5 py-1.5">
                      <ImagePlus className="h-3.5 w-3.5" /> logo do cliente
                    </span>
                  )}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleLogoUpload(e.target.files[0])} />
                </label>
              </div>
            </Slide>
          </SlideFrame>

          {/* Página 2 — Resultado Meta Ads */}
          <SlideFrame id="resultado" label="Resultado Meta Ads" hidden={isHidden("resultado")} onToggle={() => toggleHidden("resultado")} {...frameProps("resultado")} refs={slideRefs}>
            <Slide>
              <SlideEyebrow>Desempenho</SlideEyebrow>
              <SlideTitle>Resultado Meta Ads</SlideTitle>
              <div className="grid grid-cols-4 gap-3.5">
                <MetricCard label="Valor investido" value={<Field value={deck.meta_valor_investido ?? ""} onChange={(v) => patch({ meta_valor_investido: v })} placeholder={brl(totals.spend)} />} />
                <MetricCard label="Impressões" value={<Field value={deck.meta_impressoes ?? ""} onChange={(v) => patch({ meta_impressoes: v })} placeholder={totals.impressions.toLocaleString("pt-BR")} />} />
                <MetricCard label="Leads" value={<Field value={deck.meta_leads_count ?? ""} onChange={(v) => patch({ meta_leads_count: v })} placeholder={totals.leads.toLocaleString("pt-BR")} />} />
                <MetricCard label="Custo por lead" value={<Field value={deck.meta_custo_por_lead ?? ""} onChange={(v) => patch({ meta_custo_por_lead: v })} placeholder={totals.cpl !== null ? brl(totals.cpl) : "—"} />} />
                <MetricCard label="Custo por venda" value={<Field value={deck.meta_custo_venda ?? ""} onChange={(v) => patch({ meta_custo_venda: v })} placeholder="-" />} color="border-green-500/50" />
                <MetricCard label="Faturamento" value={<Field value={deck.meta_faturamento ?? ""} onChange={(v) => patch({ meta_faturamento: v })} placeholder="Consultar loja" />} color="border-green-500/50" />
                <MetricCard label="Vendas" value={<Field value={deck.meta_vendas ?? ""} onChange={(v) => patch({ meta_vendas: v })} placeholder="-" />} color="border-green-500/50" />
                <MetricCard label="Retorno sobre investimento" value={<Field value={deck.meta_roi ?? ""} onChange={(v) => patch({ meta_roi: v })} placeholder="Consultar loja" />} color="border-green-500/50" />
              </div>
              <div className="mt-4 max-w-[220px]">
                <MetricCard label="Seguidores" value={<Field value={deck.meta_seguidores ?? ""} onChange={(v) => patch({ meta_seguidores: v })} placeholder="-" />} />
              </div>
            </Slide>
          </SlideFrame>

          {/* Página 3 — Diagnóstico */}
          <SlideFrame id="diagnostico" label="Diagnóstico" hidden={isHidden("diagnostico")} onToggle={() => toggleHidden("diagnostico")} {...frameProps("diagnostico")} refs={slideRefs}>
            <Slide>
              <SlideEyebrow>Análise</SlideEyebrow>
              <SlideTitle>Diagnóstico do Tráfego</SlideTitle>
              <BulletList items={deck.diagnostico_items} onChange={(items) => patch({ diagnostico_items: items })} />
            </Slide>
          </SlideFrame>

          {/* Página 4 — Plano de Ação do Tráfego */}
          <SlideFrame id="plano_trafego" label="Plano de ação do tráfego" hidden={isHidden("plano_trafego")} onToggle={() => toggleHidden("plano_trafego")} {...frameProps("plano_trafego")} refs={slideRefs}>
            <Slide>
              <SlideEyebrow>Próximos passos</SlideEyebrow>
              <SlideTitle>Plano de Ação do Tráfego</SlideTitle>
              <BulletList items={deck.plano_trafego_items} onChange={(items) => patch({ plano_trafego_items: items })} />
            </Slide>
          </SlideFrame>

          {/* Melhores Criativos */}
          <SlideFrame id="criativos" label="Melhores criativos" hidden={isHidden("criativos")} onToggle={() => toggleHidden("criativos")} {...frameProps("criativos")} refs={slideRefs}>
            <Slide>
              <SlideEyebrow>Destaque</SlideEyebrow>
              <SlideTitle>Melhores Criativos</SlideTitle>
              <button
                type="button"
                data-html2canvas-ignore
                disabled={creativeBusy}
                onClick={() => loadBestCreative(true)}
                className="absolute right-4 top-4 z-10 rounded-md bg-white/10 px-2.5 py-1 text-[11px] text-white/80 hover:bg-white/20 disabled:opacity-50"
              >
                {creativeBusy ? "Buscando..." : "Usar o melhor criativo do período"}
              </button>
              <div className="flex-1 flex items-center gap-10">
                {/* Esquerda: o criativo */}
                <div className="shrink-0 flex w-[260px] justify-center">
                  {deck.creatives[0] ? (
                    <CreativeBox
                      creative={deck.creatives[0]}
                      onChange={(c) => patch({ creatives: [c] })}
                      onRemove={() => patch({ creatives: [] })}
                    />
                  ) : (
                    <label className="flex flex-col items-center gap-2 text-center text-sm text-white/40 border border-dashed border-white/20 rounded-lg px-6 py-10 cursor-pointer">
                      <ImagePlus className="h-6 w-6" />
                      Enviar imagem/thumbnail do criativo
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleCreativeUpload(e.target.files[0])} />
                    </label>
                  )}
                </div>
                {/* Direita: legenda + orientações do vídeo */}
                <div className="min-w-0 flex-1 space-y-4 pb-11">
                  <Movable name="caption">
                    <Field
                      as="textarea"
                      value={deck.creatives[0]?.caption ?? ""}
                      onChange={(v) => patch({ creatives: deck.creatives[0] ? [{ ...deck.creatives[0], caption: v }] : [] })}
                      placeholder="Legenda (ex: Menor custo por conversa do período)"
                      className="text-sm text-white/60"
                    />
                  </Movable>
                  <BulletList items={deck.criativos_items} onChange={(items) => patch({ criativos_items: items })} textClass="text-[18px] leading-snug" />
                </div>
              </div>
            </Slide>
          </SlideFrame>

          {/* Página 5 — Funil de Vendas */}
          <SlideFrame id="funil" label="Funil de vendas" hidden={isHidden("funil")} onToggle={() => toggleHidden("funil")} {...frameProps("funil")} refs={slideRefs}>
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
          </SlideFrame>

          {/* Página 6 — Plano de Ação do Comercial */}
          <SlideFrame id="plano" label="Plano de ação do comercial" hidden={isHidden("plano")} onToggle={() => toggleHidden("plano")} {...frameProps("plano")} refs={slideRefs}>
            <Slide>
              <SlideEyebrow>Comercial</SlideEyebrow>
              <SlideTitle>Plano de Ação do Comercial</SlideTitle>
              <BulletList items={deck.plano_acao_items} onChange={(items) => patch({ plano_acao_items: items })} />
            </Slide>
          </SlideFrame>

          {/* Página 7 — Considerações finais */}
          <SlideFrame id="consideracoes" label="Considerações finais" hidden={isHidden("consideracoes")} onToggle={() => toggleHidden("consideracoes")} {...frameProps("consideracoes")} refs={slideRefs}>
            <Slide>
              <SlideEyebrow>Fechamento</SlideEyebrow>
              <SlideTitle>Considerações Finais</SlideTitle>
              <BulletList items={deck.consideracoes_items} onChange={(items) => patch({ consideracoes_items: items })} />
            </Slide>
          </SlideFrame>

          {deck.custom_pages.map((pg, i) => (
            <SlideFrame
              key={pg.id}
              id={pg.id}
              label={`Página extra ${i + 1}`}
              hidden={isHidden(pg.id)}
              onToggle={() => toggleHidden(pg.id)}
              onRemove={() => removePage(pg.id)}
              {...frameProps(pg.id)}
              refs={slideRefs}
            >
              <Slide>
                <Field value={pg.eyebrow} onChange={(v) => patchPage(pg.id, { eyebrow: v })} placeholder="TEMA" className="text-[11px] font-semibold tracking-[0.12em] text-orange-400 uppercase mb-2" />
                <Field value={pg.title} onChange={(v) => patchPage(pg.id, { title: v })} placeholder="Título da página" className="text-[30px] font-bold leading-snug mb-4" />
                <textarea
                  value={pg.body}
                  onChange={(e) => patchPage(pg.id, { body: e.target.value })}
                  placeholder="Escreva o que quiser aqui..."
                  className="flex-1 w-full max-w-[760px] mb-8 resize-none bg-transparent outline-none text-[15px] leading-relaxed placeholder:text-white/30 hover:bg-white/5 focus:bg-white/10 rounded px-1 -mx-1 transition-colors"
                />
              </Slide>
            </SlideFrame>
          ))}

          <Button type="button" variant="outline" className="gap-2" onClick={addPage}>
            <Plus className="h-4 w-4" /> Adicionar página
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
