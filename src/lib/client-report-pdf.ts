import { jsPDF } from "jspdf";
import type { MetaCampaign } from "./meta";

export interface ClientReportInput {
  clientName: string;
  organizationName: string;
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
  cplMax: number | null;
  campaigns: MetaCampaign[];
}

// ── Paleta ───────────────────────────────────────────────────────────────────
const INK: [number, number, number] = [26, 26, 26];
const MUTED: [number, number, number] = [128, 128, 128];
const MUTED_DARK: [number, number, number] = [90, 90, 90];
const LINE: [number, number, number] = [228, 228, 228];
const CARD_BG: [number, number, number] = [246, 246, 246];
const ACCENT_DARK: [number, number, number] = [180, 83, 9]; // amber-700
const ACCENT_LIGHT: [number, number, number] = [245, 166, 35]; // amber-400
const BADGE_BG: [number, number, number] = [220, 252, 231];
const BADGE_TEXT: [number, number, number] = [22, 101, 52];
const TAG_BG: [number, number, number] = [238, 238, 238];
const TAG_TEXT: [number, number, number] = [120, 120, 120];

const brl = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brlWhole = (v: number) => Math.round(v).toLocaleString("pt-BR");
const int = (v: number) => Math.round(v).toLocaleString("pt-BR");
const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(2)}%`);

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MONTHS_ABBR = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function isFullCalendarMonth(since: string, until: string): { y: number; m: number } | null {
  const [sy, sm, sd] = since.split("-").map(Number);
  const [uy, um, ud] = until.split("-").map(Number);
  if (sd !== 1 || sm !== um || sy !== uy) return null;
  const lastDay = new Date(uy, um, 0).getDate();
  return ud === lastDay ? { y: sy, m: sm } : null;
}

function periodLabel(since: string, until: string, kind: "eyebrow" | "short"): string {
  const month = isFullCalendarMonth(since, until);
  if (month) {
    return kind === "eyebrow"
      ? `${MONTHS[month.m - 1].toUpperCase()} ${month.y}`
      : `${MONTHS_ABBR[month.m - 1]}/${month.y}`;
  }
  return kind === "eyebrow" ? `${fmtDate(since)} A ${fmtDate(until)}` : `${fmtDate(since)} a ${fmtDate(until)}`;
}

function slug(s: string): string {
  return (
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "cliente"
  );
}

function lerp(c1: [number, number, number], c2: [number, number, number], t: number): [number, number, number] {
  return [Math.round(c1[0] + (c2[0] - c1[0]) * t), Math.round(c1[1] + (c2[1] - c1[1]) * t), Math.round(c1[2] + (c2[2] - c1[2]) * t)];
}

// ── Texto com tracking manual (jsPDF não tem letter-spacing nativo) ──────────
function drawTracked(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  opts: { size: number; color: [number, number, number]; bold?: boolean; spacing?: number; align?: "left" | "right" },
): number {
  const { size, color, bold = false, spacing = 0.7, align = "left" } = opts;
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(size);
  const chars = text.split("");
  const widths = chars.map((c) => doc.getTextWidth(c));
  const total = widths.reduce((a, b) => a + b, 0) + spacing * Math.max(0, chars.length - 1);
  let cx = align === "right" ? x - total : x;
  doc.setTextColor(...color);
  for (let i = 0; i < chars.length; i++) {
    doc.text(chars[i], cx, y);
    cx += widths[i] + spacing;
  }
  return total;
}

// ── Parágrafo com trechos em negrito/monoespaçado, com quebra de linha ───────
interface RichSeg {
  text: string;
  bold?: boolean;
  mono?: boolean;
}
interface RichTok {
  text: string;
  bold?: boolean;
  mono?: boolean;
}

function wrapRich(doc: jsPDF, segs: RichSeg[], maxWidth: number, size: number): RichTok[][] {
  // Mantém os espaços como tokens próprios (com largura real) — dividir só por
  // palavra e descartar strings vazias perde o espaço entre trechos (ex.: um
  // trecho em negrito colado sem espaço no texto normal seguinte).
  const tokens: RichTok[] = [];
  segs.forEach((seg) => {
    seg.text
      .split(/(\s+)/)
      .filter((p) => p.length > 0)
      .forEach((p) => tokens.push({ text: p, bold: seg.bold, mono: seg.mono }));
  });

  doc.setFontSize(size);
  const lines: RichTok[][] = [[]];
  let width = 0;
  for (const tok of tokens) {
    const isSpace = /^\s+$/.test(tok.text);
    doc.setFont(tok.mono ? "courier" : "helvetica", tok.bold ? "bold" : "normal");
    const w = doc.getTextWidth(tok.text);
    if (width + w > maxWidth && lines[lines.length - 1].length > 0) {
      lines.push([]);
      width = 0;
      if (isSpace) continue; // não inicia linha nova com espaço em branco
    }
    lines[lines.length - 1].push(tok);
    width += w;
  }
  return lines;
}

function drawRichLines(
  doc: jsPDF,
  lines: RichTok[][],
  x: number,
  y: number,
  size: number,
  lineHeight: number,
  color: [number, number, number],
): number {
  let cy = y;
  for (const line of lines) {
    let cx = x;
    doc.setFontSize(size);
    for (const tok of line) {
      doc.setFont(tok.mono ? "courier" : "helvetica", tok.bold ? "bold" : "normal");
      doc.setTextColor(...color);
      doc.text(tok.text, cx, cy);
      cx += doc.getTextWidth(tok.text);
    }
    cy += lineHeight;
  }
  return cy;
}

function drawGradientBar(doc: jsPDF, x: number, y: number, w: number, h: number): void {
  if (w <= 0) return;
  const sliceCount = Math.max(1, Math.min(60, Math.round(w / 4)));
  const sliceW = w / sliceCount;
  for (let i = 0; i < sliceCount; i++) {
    const t = sliceCount === 1 ? 0 : i / (sliceCount - 1);
    doc.setFillColor(...lerp(ACCENT_DARK, ACCENT_LIGHT, t));
    doc.rect(x + i * sliceW, y, sliceW + 0.6, h, "F");
  }
}

function pillWidth(doc: jsPDF, text: string, size: number, padX: number): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(size);
  return doc.getTextWidth(text) + padX * 2;
}

function drawPill(
  doc: jsPDF,
  text: string,
  x: number,
  yBaseline: number,
  opts: { bg: [number, number, number]; fg: [number, number, number]; size?: number },
): number {
  const size = opts.size ?? 6.5;
  const padX = 5;
  const h = 12;
  const w = pillWidth(doc, text, size, padX);
  doc.setFillColor(...opts.bg);
  doc.roundedRect(x, yBaseline - h + 2.5, w, h, h / 2, h / 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(size);
  doc.setTextColor(...opts.fg);
  doc.text(text, x + padX, yBaseline - 1.5);
  return w;
}

/**
 * Gera e baixa um PDF (A4 retrato) com o desempenho do cliente no período:
 * capa com resumo + gráfico de investimento por campanha, e uma página de
 * detalhamento por campanha. Roda 100% no navegador.
 */
export function generateClientReportPdf(input: ClientReportInput): void {
  const doc = buildClientReportDoc(input);
  doc.save(`relatorio-${slug(input.clientName)}-${input.since}_a_${input.until}.pdf`);
}

/** Monta o documento (sem salvar) — usado pelo browser e por scripts/preview. */
export function buildClientReportDoc(input: ClientReportInput): jsPDF {
  const { clientName, organizationName, since, until, cplMax, campaigns } = input;

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 46;
  const contentRight = pageWidth - marginX;
  const contentWidth = contentRight - marginX;
  const bottomLimit = pageHeight - 40;

  const ranked = [...campaigns].filter((c) => c.spend > 0).sort((a, b) => b.spend - a.spend);
  const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
  const totalLeads = campaigns.reduce((s, c) => s + c.leads + c.forms, 0);
  const totalImpr = campaigns.reduce((s, c) => s + c.impressions, 0);
  const totalClicks = campaigns.reduce((s, c) => s + c.link_clicks, 0);
  const avgCpl = totalLeads > 0 ? totalSpend / totalLeads : null;
  const avgCtr = totalImpr > 0 ? (totalClicks / totalImpr) * 100 : null;
  const avgCpm = totalImpr > 0 ? (totalSpend / totalImpr) * 1000 : null;
  const maxSpend = ranked.length > 0 ? ranked[0].spend : 0;

  const bestCplId = (() => {
    let best: MetaCampaign | null = null;
    for (const c of campaigns) {
      const conv = c.leads + c.forms;
      if (conv <= 0) continue;
      const cpl = c.spend / conv;
      if (!best || cpl < best.spend / (best.leads + best.forms)) best = c;
    }
    return best?.id ?? null;
  })();

  let y = 0;

  // ── Cabeçalho da marca ───────────────────────────────────────────────────
  const headerBar = () => {
    y = 52;
    drawTracked(doc, `${organizationName.toUpperCase()} · GESTÃO DE TRÁFEGO`, marginX, y, {
      size: 9,
      color: MUTED_DARK,
      bold: true,
      spacing: 0.8,
    });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    const gen = `Relatório gerado em ${new Date().toLocaleDateString("pt-BR")}`;
    doc.text(gen, contentRight, y, { align: "right" });
    y += 13;
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.75);
    doc.line(marginX, y, contentRight, y);
    y += 28;
  };

  headerBar();

  // ── Eyebrow + título ─────────────────────────────────────────────────────
  drawTracked(doc, `RELATÓRIO DE DESEMPENHO — ${periodLabel(since, until, "eyebrow")}`, marginX, y, {
    size: 9.5,
    color: MUTED_DARK,
    bold: true,
    spacing: 0.9,
  });
  y += 28;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(30);
  doc.setTextColor(...INK);
  const titleLines = doc.splitTextToSize(clientName, contentWidth * 0.9) as string[];
  titleLines.forEach((line) => {
    doc.text(line, marginX, y);
    y += 34;
  });
  doc.text("no WhatsApp", marginX, y);
  y += 26;

  const subtitleLines = wrapRich(
    doc,
    [
      { text: "Resultado das campanhas de tráfego pago rodadas de " },
      { text: fmtDate(since), bold: true },
      { text: " a " },
      { text: `${fmtDate(until)}, `, bold: true },
      { text: "direcionando interessados direto pro WhatsApp da loja." },
    ],
    contentWidth * 0.95,
    10.5,
  );
  y = drawRichLines(doc, subtitleLines, marginX, y, 10.5, 15, MUTED_DARK);
  y += 16;

  // ── Cards de resumo ──────────────────────────────────────────────────────
  const cardH = 86;
  doc.setFillColor(...CARD_BG);
  doc.roundedRect(marginX, y, contentWidth, cardH, 10, 10, "F");

  const cardColW = contentWidth / 3;
  const cards: Array<{ label: string; prefix?: string; value: string; caption: string }> = [
    { label: "TOTAL INVESTIDO", prefix: "R$", value: brlWhole(totalSpend), caption: `em ${campaigns.length} campanha${campaigns.length === 1 ? "" : "s"} no período` },
    { label: "LEADS GERADOS", value: int(totalLeads), caption: "conversas iniciadas no WhatsApp" },
    { label: "CUSTO POR LEAD MÉDIO", prefix: "R$", value: avgCpl != null ? brl(avgCpl) : "—", caption: "investido ÷ leads gerados" },
  ];

  cards.forEach((card, i) => {
    const cx = marginX + i * cardColW + 22;
    const topY = y + 24;
    if (i > 0) {
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.75);
      doc.line(marginX + i * cardColW, y + 14, marginX + i * cardColW, y + cardH - 14);
    }
    drawTracked(doc, card.label, cx, topY, { size: 7.5, color: MUTED, bold: true, spacing: 0.6 });

    let vx = cx;
    const valueY = topY + 27;
    if (card.prefix) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(...ACCENT_DARK);
      doc.text(card.prefix, vx, valueY - 9);
      vx += doc.getTextWidth(card.prefix) + 4;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(26);
    doc.setTextColor(...INK);
    doc.text(card.value, vx, valueY);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text(card.caption, cx, valueY + 15, { maxWidth: cardColW - 30 });
  });

  y += cardH + 26;

  // ── Onde a verba foi investida ───────────────────────────────────────────
  drawTracked(doc, "ONDE A VERBA FOI INVESTIDA", marginX, y, { size: 10, color: INK, bold: true, spacing: 0.5 });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text("por campanha, do maior para o menor", contentRight, y, { align: "right" });
  y += 22;

  const barValueW = 90;
  const barMaxW = contentWidth - barValueW;

  const ensureBar = (needed: number) => {
    if (y + needed > bottomLimit) {
      doc.addPage();
      y = 56;
    }
  };

  ranked.forEach((c) => {
    ensureBar(30);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(...INK);
    const nameLine = doc.splitTextToSize(c.name, contentWidth)[0] as string;
    doc.text(nameLine, marginX, y);
    y += 9;

    const barH = 8;
    const w = maxSpend > 0 ? Math.max(4, (c.spend / maxSpend) * barMaxW) : 0;
    drawGradientBar(doc, marginX, y, w, barH);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...MUTED_DARK);
    doc.text(`R$ ${brl(c.spend)}`, contentRight, y + barH - 1, { align: "right" });
    y += barH + 13;
  });

  if (ranked.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    doc.text("Nenhuma campanha com investimento no período.", marginX, y);
  }

  // ── Página 2: detalhamento por campanha ──────────────────────────────────
  doc.addPage();
  y = 56;

  drawTracked(doc, "DETALHAMENTO POR CAMPANHA", marginX, y, { size: 10, color: INK, bold: true, spacing: 0.5 });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text(`${campaigns.length} campanha${campaigns.length === 1 ? "" : "s"} · ${periodLabel(since, until, "short")}`, contentRight, y, { align: "right" });
  y += 22;

  const colName = marginX + 12;
  const colInvestido = marginX + contentWidth * 0.62;
  const colLeads = marginX + contentWidth * 0.78;
  const colCpl = contentRight - 12;

  const drawTableHead = () => {
    doc.setFillColor(...CARD_BG);
    doc.rect(marginX, y - 16, contentWidth, 24, "F");
    const midY = y - 1;
    drawTracked(doc, "CAMPANHA", colName, midY, { size: 7.5, color: MUTED, bold: true, spacing: 0.5 });
    drawTracked(doc, "VALOR INVESTIDO", colInvestido, midY, { size: 7.5, color: MUTED, bold: true, spacing: 0.5, align: "right" });
    drawTracked(doc, "LEADS", colLeads, midY, { size: 7.5, color: MUTED, bold: true, spacing: 0.5, align: "right" });
    drawTracked(doc, "CUSTO POR LEAD", colCpl, midY, { size: 7.5, color: MUTED, bold: true, spacing: 0.5, align: "right" });
    y += 26;
  };

  drawTableHead();

  const ensureRow = (needed: number) => {
    if (y + needed > bottomLimit) {
      doc.addPage();
      y = 56;
      drawTableHead();
    }
  };

  ranked.concat(campaigns.filter((c) => c.spend === 0)).forEach((c) => {
    ensureRow(46);
    const conv = c.leads + c.forms;
    const cpl = conv > 0 ? c.spend / conv : null;
    const rowTop = y;

    // Reserva o espaço exato do valor da coluna "Valor investido" (largura
    // varia muito, ex. "R$ 29,24" x "R$ 1.842,37") e dos selos ANTES de
    // truncar o nome, pra garantir que nome + selos nunca invadam a coluna.
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    const investedTxt = `R$ ${brl(c.spend)}`;
    const investedW = doc.getTextWidth(investedTxt);
    const nameBoundary = colInvestido - investedW - 16;

    type Badge = { text: string; bg: [number, number, number]; fg: [number, number, number] };
    const badges: Badge[] = [];
    if (c.id === bestCplId) badges.push({ text: "MENOR CUSTO", bg: BADGE_BG, fg: BADGE_TEXT });
    if (c.status === "PAUSED") badges.push({ text: "PAUSADA", bg: TAG_BG, fg: TAG_TEXT });
    const badgesW = badges.reduce((sum, b) => sum + pillWidth(doc, b.text, 6.5, 5) + 7, 0);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(...INK);
    const maxNameW = nameBoundary - colName - badgesW;
    const nameSplit = doc.splitTextToSize(c.name, maxNameW) as string[];
    let nameTxt = nameSplit[0];
    if (nameSplit.length > 1) {
      while (nameTxt.length > 1 && doc.getTextWidth(`${nameTxt.trimEnd()}…`) > maxNameW) {
        nameTxt = nameTxt.slice(0, -1);
      }
      nameTxt = `${nameTxt.trimEnd()}…`;
    }
    doc.text(nameTxt, colName, rowTop);

    let badgeX = colName + doc.getTextWidth(nameTxt) + 7;
    badges.forEach((b) => {
      badgeX += drawPill(doc, b.text, badgeX, rowTop, { bg: b.bg, fg: b.fg }) + 7;
    });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(...INK);
    doc.text(investedTxt, colInvestido, rowTop, { align: "right" });
    doc.text(int(conv), colLeads, rowTop, { align: "right" });
    doc.text(cpl != null ? `R$ ${brl(cpl)}` : "—", colCpl, rowTop, { align: "right" });

    y += 15;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(
      `${int(c.impressions)} impr. · ${int(c.link_clicks)} cliques · CTR ${pct(c.ctr)} · CPM ${c.cpm != null ? `R$ ${brl(c.cpm)}` : "—"}`,
      colName,
      y,
    );

    y += 13;
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.5);
    doc.line(marginX, y, contentRight, y);
    y += 17;
  });

  ensureRow(30);
  doc.setDrawColor(...INK);
  doc.setLineWidth(1);
  doc.line(marginX, y - 12, contentRight, y - 12);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...INK);
  doc.text("Total do período", colName, y);
  doc.text(`R$ ${brl(totalSpend)}`, colInvestido, y, { align: "right" });
  doc.text(int(totalLeads), colLeads, y, { align: "right" });
  doc.text(avgCpl != null ? `R$ ${brl(avgCpl)}` : "—", colCpl, y, { align: "right" });
  y += 15;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(`${int(totalImpr)} impr. · ${int(totalClicks)} cliques · CTR ${pct(avgCtr)} · CPM ${avgCpm != null ? `R$ ${brl(avgCpm)}` : "—"}`, colName, y);
  y += 30;

  const cplNote = cplMax != null ? ` A meta de CPL deste cliente é ${`R$ ${brl(cplMax)}`}.` : "";
  const footnoteLines = wrapRich(
    doc,
    [
      { text: '"Leads" considera conversas iniciadas no WhatsApp a partir do anúncio (métrica ' },
      { text: "onsite_conversion.messaging_conversation_started_7d", mono: true },
      { text: " da Meta), somado a leads de formulário quando houver. Custo por lead = valor investido ÷ leads gerados na campanha." + cplNote },
    ],
    contentWidth * 0.6,
    8,
  );
  const footnoteY = drawRichLines(doc, footnoteLines, marginX, y, 8, 11.5, MUTED);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  doc.text(organizationName, contentRight, y, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text("Gestão de Tráfego Pago", contentRight, y + 12, { align: "right" });

  void footnoteY;

  // ── Numeração de página ──────────────────────────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`${p} / ${totalPages}`, contentRight, pageHeight - 22, { align: "right" });
  }

  return doc;
}
