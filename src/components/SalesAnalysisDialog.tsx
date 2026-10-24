import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { jsPDF } from "jspdf";
import { toast } from "sonner";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { generateSalesAnalysis, type SalesAnalysisResult } from "@/server/sales-analysis";

type AnalysisPeriod = "last_7d" | "last_30d" | "this_month" | "last_month" | "maximum";

const PERIOD_OPTIONS: { value: AnalysisPeriod; label: string }[] = [
  { value: "last_7d", label: "Últimos 7 dias" },
  { value: "last_30d", label: "Últimos 30 dias" },
  { value: "this_month", label: "Este mês" },
  { value: "last_month", label: "Mês passado" },
  { value: "maximum", label: "Máximo" },
];

interface SalesAnalysisDialogProps {
  clientId: string;
  clientName: string;
}

export function SalesAnalysisDialog({ clientId, clientName }: SalesAnalysisDialogProps) {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<AnalysisPeriod>("last_30d");

  const mutation = useMutation({
    mutationFn: () => generateSalesAnalysis(clientId, period),
    onSuccess: (result) => {
      buildPdf(result, PERIOD_OPTIONS.find((p) => p.value === period)?.label ?? period);
      toast.success("Análise gerada! PDF baixado.");
      setOpen(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao gerar análise."),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !mutation.isPending && setOpen(v)}>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <Sparkles className="h-3.5 w-3.5" />
        Gerar análise comercial
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Análise comercial — {clientName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <Label>Período</Label>
          <Select value={period} onValueChange={(v) => setPeriod(v as AnalysisPeriod)} disabled={mutation.isPending}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map((p) => (
                <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Lê as conversas de WhatsApp dos leads desse período (até 40 leads, até 60 mensagens recentes de cada) e
            gera um PDF com números, recomendações e exemplos concretos. Pode levar até um minuto.
          </p>
        </div>

        <DialogFooter>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="gap-2">
            {mutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Gerando análise...
              </>
            ) : (
              "Gerar e baixar PDF"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function buildPdf(result: SalesAnalysisResult, periodLabel: string) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const marginX = 48;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const usableWidth = pageWidth - marginX * 2;
  const topMargin = 56;
  const bottomMargin = 60;

  const ACCENT: [number, number, number] = [45, 150, 140];
  const INK: [number, number, number] = [30, 30, 30];
  const MUTED: [number, number, number] = [130, 130, 130];
  const SHADE: [number, number, number] = [243, 243, 243];

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

  const heading = (text: string) => {
    ensureSpace(40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...ACCENT);
    doc.text(text, marginX, y);
    y += 10;
    doc.setDrawColor(...ACCENT);
    doc.setLineWidth(1.5);
    doc.line(marginX, y, marginX + 40, y);
    y += 22;
  };

  const paragraph = (text: string, size = 11) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(...INK);
    const wrapped = doc.splitTextToSize(text, usableWidth);
    ensureSpace(wrapped.length * 15 + 8);
    doc.text(wrapped, marginX, y);
    y += wrapped.length * 15 + 8;
  };

  // Capa
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...INK);
  doc.text("Análise Comercial", marginX, y);
  y += 26;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.setTextColor(...MUTED);
  doc.text(`${result.clientName} · ${periodLabel} · gerado em ${new Date(result.generatedAt).toLocaleDateString("pt-BR")}`, marginX, y);
  y += 34;

  // Números
  const statRows: [string, string][] = [
    ["Leads no período", String(result.stats.totalLeads)],
    ["Qualificados", String(result.stats.qualifiedLeads)],
    ["Converteram (venda)", String(result.stats.convertedLeads)],
    ["Taxa de conversão", `${(result.stats.conversionRate * 100).toFixed(1)}%`],
    ["Tempo médio até 1ª resposta", result.stats.avgFirstReplyMinutes !== null ? `${result.stats.avgFirstReplyMinutes.toFixed(1)} min` : "—"],
    ["Conversas lidas", `${result.stats.leadsAnalyzed}${result.stats.leadsSkipped > 0 ? ` (${result.stats.leadsSkipped} não lidas)` : ""}`],
  ];
  const colWidth = usableWidth / 2;
  doc.setFillColor(...SHADE);
  const statsBoxHeight = Math.ceil(statRows.length / 2) * 34 + 20;
  doc.roundedRect(marginX, y, usableWidth, statsBoxHeight, 6, 6, "F");
  let statY = y + 26;
  statRows.forEach(([label, value], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = marginX + 18 + col * colWidth;
    const rowY = y + 26 + row * 34;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...MUTED);
    doc.text(label, x, rowY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...INK);
    doc.text(value, x, rowY + 16);
    statY = Math.max(statY, rowY + 16);
  });
  y += statsBoxHeight + 28;

  // Resumo
  heading("Resumo");
  paragraph(result.summary);
  y += 10;

  // Recomendações
  if (result.recommendations.length > 0) {
    heading("Recomendações");
    result.recommendations.forEach((rec, i) => {
      ensureSpace(20);
      doc.setFillColor(...ACCENT);
      doc.circle(marginX + 6, y - 4, 7, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.text(String(i + 1), marginX + 6, y - 1, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.setTextColor(...INK);
      const wrapped = doc.splitTextToSize(rec, usableWidth - 24);
      doc.text(wrapped, marginX + 22, y);
      y += wrapped.length * 15 + 12;
    });
    y += 8;
  }

  // Exemplos
  if (result.examples.length > 0) {
    heading("Exemplos");
    result.examples.forEach((ex) => {
      ensureSpace(60);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11.5);
      doc.setTextColor(...INK);
      doc.text(ex.leadName, marginX, y);
      y += 16;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(...ACCENT);
      doc.text("O que travou", marginX, y);
      y += 13;
      paragraph(ex.issue, 10.5);

      if (ex.excerpt) {
        ensureSpace(30);
        const excerptLines = doc.splitTextToSize(`"${ex.excerpt}"`, usableWidth - 24);
        const boxHeight = excerptLines.length * 14 + 16;
        ensureSpace(boxHeight);
        doc.setFillColor(...SHADE);
        doc.roundedRect(marginX, y - 12, usableWidth, boxHeight, 4, 4, "F");
        doc.setFont("helvetica", "italic");
        doc.setFontSize(10);
        doc.setTextColor(80, 80, 80);
        doc.text(excerptLines, marginX + 12, y);
        y += boxHeight + 10;
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(...ACCENT);
      doc.text("Sugestão", marginX, y);
      y += 13;
      paragraph(ex.suggestion, 10.5);
      y += 10;

      ensureSpace(14);
      doc.setDrawColor(225, 225, 225);
      doc.setLineWidth(0.75);
      doc.line(marginX, y, pageWidth - marginX, y);
      y += 22;
    });
  }

  addFooter();
  doc.save(`analise-comercial-${result.clientName.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}.pdf`);
}
