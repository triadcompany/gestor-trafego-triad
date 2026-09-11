import { jsPDF } from "jspdf";
import type { MetaCampaign } from "./meta";

export interface ClientReportInput {
  clientName: string;
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
  cplMax: number | null;
  campaigns: MetaCampaign[];
}

const ACCENT: [number, number, number] = [217, 119, 6]; // laranja da marca
const INK: [number, number, number] = [30, 30, 30];
const MUTED: [number, number, number] = [120, 120, 120];
const LINE: [number, number, number] = [224, 224, 224];

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const int = (v: number) => Math.round(v).toLocaleString("pt-BR");
const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(2)}%`);

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function statusLabel(s: string): string {
  if (s === "ACTIVE") return "Ativa";
  if (s === "PAUSED") return "Pausada";
  if (s === "ARCHIVED") return "Arquivada";
  return s;
}

function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "cliente";
}

/**
 * Gera e baixa um PDF (paisagem A4) com o resumo do período e a tabela de
 * campanhas do cliente. Roda 100% no navegador.
 */
export function generateClientReportPdf(input: ClientReportInput): void {
  const doc = buildClientReportDoc(input);
  doc.save(`relatorio-${slug(input.clientName)}-${input.since}_a_${input.until}.pdf`);
}

/** Monta o documento (sem salvar) — usado pelo browser e por scripts/preview. */
export function buildClientReportDoc(input: ClientReportInput): jsPDF {
  const { clientName, since, until, cplMax, campaigns } = input;

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 40;
  const contentRight = pageWidth - marginX;
  const bottomLimit = pageHeight - 46;

  // ── Totais do período ────────────────────────────────────────────────
  const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
  const totalLeads = campaigns.reduce((s, c) => s + c.leads + c.forms, 0);
  const totalImpr = campaigns.reduce((s, c) => s + c.impressions, 0);
  const totalClicks = campaigns.reduce((s, c) => s + c.link_clicks, 0);
  const avgCpl = totalLeads > 0 ? totalSpend / totalLeads : null;
  const avgCtr = totalImpr > 0 ? (totalClicks / totalImpr) * 100 : null;
  const avgCpm = totalImpr > 0 ? (totalSpend / totalImpr) * 1000 : null;

  let y = 46;
  let pageNum = 1;

  const footer = () => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    const gen = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
    doc.text(`Gerado em ${gen}`, marginX, pageHeight - 26);
    doc.text(String(pageNum), contentRight, pageHeight - 26, { align: "right" });
  };

  // ── Cabeçalho ────────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...INK);
  doc.text(clientName, marginX, y);
  y += 20;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(...MUTED);
  doc.text(`Relatório de campanhas · ${fmtDate(since)} a ${fmtDate(until)}`, marginX, y);
  y += 14;

  doc.setDrawColor(...ACCENT);
  doc.setLineWidth(2);
  doc.line(marginX, y, marginX + 64, y);
  y += 26;

  // ── Resumo do período ────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...INK);
  doc.text("Resumo do período", marginX, y);
  y += 16;

  const metaTxt =
    cplMax != null
      ? avgCpl != null
        ? `  (meta: até ${brl(cplMax)} — ${avgCpl <= cplMax ? "dentro" : "acima"})`
        : `  (meta: até ${brl(cplMax)})`
      : "";

  const summary: Array<[string, string]> = [
    ["Investimento total", brl(totalSpend)],
    ["Leads", int(totalLeads)],
    ["CPL médio", (avgCpl != null ? brl(avgCpl) : "—") + metaTxt],
    ["Impressões", int(totalImpr)],
    ["Cliques no link", int(totalClicks)],
    ["CTR médio", pct(avgCtr)],
    ["CPM médio", avgCpm != null ? brl(avgCpm) : "—"],
    ["Campanhas no período", int(campaigns.length)],
  ];

  doc.setFontSize(10);
  const colW = (contentRight - marginX) / 2;
  summary.forEach(([label, value], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = marginX + col * colW;
    const cy = y + row * 18;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    doc.text(label, cx, cy);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...INK);
    doc.text(value, cx + 130, cy);
  });
  y += Math.ceil(summary.length / 2) * 18 + 18;

  // ── Tabela de campanhas ──────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...INK);
  doc.text("Campanhas", marginX, y);
  y += 14;

  type Col = { title: string; x: number; align: "left" | "right"; nameCol?: boolean };
  const cols: Col[] = [
    { title: "Campanha", x: marginX, align: "left", nameCol: true },
    { title: "Status", x: 300, align: "left" },
    { title: "Investido", x: 400, align: "right" },
    { title: "Leads", x: 452, align: "right" },
    { title: "CPL", x: 520, align: "right" },
    { title: "Impressões", x: 600, align: "right" },
    { title: "Cliques", x: 665, align: "right" },
    { title: "CTR", x: 715, align: "right" },
    { title: "CPM", x: contentRight, align: "right" },
  ];
  const nameMaxW = 300 - marginX - 8;

  const drawHead = () => {
    doc.setFillColor(245, 245, 245);
    doc.rect(marginX, y - 10, contentRight - marginX, 18, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    cols.forEach((c) => doc.text(c.title, c.x, y + 2, { align: c.align }));
    y += 16;
  };

  const ensure = (needed: number) => {
    if (y + needed > bottomLimit) {
      footer();
      doc.addPage();
      pageNum += 1;
      y = 46;
      drawHead();
    }
  };

  drawHead();

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);

  const cell = (c: Col, text: string) => {
    if (c.nameCol) {
      const lines = doc.splitTextToSize(text, nameMaxW) as string[];
      doc.text(lines[0] ?? text, c.x, y, { align: c.align });
    } else {
      doc.text(text, c.x, y, { align: c.align });
    }
  };

  campaigns.forEach((c, idx) => {
    ensure(16);
    const conv = c.leads + c.forms;
    doc.setTextColor(...INK);
    cell(cols[0], c.name);
    doc.setTextColor(...MUTED);
    cell(cols[1], statusLabel(c.status));
    doc.setTextColor(...INK);
    cell(cols[2], brl(c.spend));
    cell(cols[3], int(conv));
    cell(cols[4], conv > 0 ? brl(c.spend / conv) : "—");
    cell(cols[5], int(c.impressions));
    cell(cols[6], int(c.link_clicks));
    cell(cols[7], pct(c.ctr));
    cell(cols[8], c.cpm != null ? brl(c.cpm) : "—");
    y += 15;

    if (idx < campaigns.length - 1) {
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.5);
      doc.line(marginX, y - 5, contentRight, y - 5);
    }
  });

  if (campaigns.length === 0) {
    doc.setTextColor(...MUTED);
    doc.text("Nenhuma campanha com dados no período.", marginX, y);
    y += 15;
  } else {
    // Linha de total
    ensure(20);
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.8);
    doc.line(marginX, y - 5, contentRight, y - 5);
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...INK);
    doc.text("TOTAL", cols[0].x, y, { align: "left" });
    doc.text(brl(totalSpend), cols[2].x, y, { align: "right" });
    doc.text(int(totalLeads), cols[3].x, y, { align: "right" });
    doc.text(avgCpl != null ? brl(avgCpl) : "—", cols[4].x, y, { align: "right" });
    doc.text(int(totalImpr), cols[5].x, y, { align: "right" });
    doc.text(int(totalClicks), cols[6].x, y, { align: "right" });
    doc.text(pct(avgCtr), cols[7].x, y, { align: "right" });
    doc.text(avgCpm != null ? brl(avgCpm) : "—", cols[8].x, y, { align: "right" });
  }

  footer();
  return doc;
}
