// Texto automático dos slides de Diagnóstico e Plano de Ação do Tráfego, a partir
// dos números reais do período (mesmas regras da aba Otimização).
import type { MetaAd, OptimizationInsights } from "@/lib/meta";
import { brl, buildOptimizationReport, type CciTarget } from "@/lib/optimization";
import { DEFAULT_DIAGNOSTICO, DEFAULT_PLANO_TRAFEGO } from "@/server/report-decks";

export interface AutoLists {
  diagnostico: string[];
  plano: string[];
  contatos: string; // funil: "Contatos" = quantidade de leads do período
}

const TAIL_PLAN = ["Testar 2 criativos novos com o preço do carro na tela.", "Revisar os resultados em 15 dias."];
const endWithDot = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

export function buildAutoLists(opts: {
  cpl: number | null; // custo por conversa do período (gasto / conversas)
  leads: number; // conversas/leads do período
  target: CciTarget | null;
  insights: OptimizationInsights | null;
}): AutoLists {
  const { cpl, leads, target, insights } = opts;
  const diag = [...DEFAULT_DIAGNOSTICO];
  let plano = [...DEFAULT_PLANO_TRAFEGO];

  // 1) Custo por conversa x meta
  if (cpl !== null) {
    diag[0] = target
      ? `Custo por conversa de ${brl(cpl)}, ${cpl <= target.max ? "dentro da" : "acima da"} meta (${brl(target.min)} a ${brl(target.max)}).`
      : `Custo por conversa de ${brl(cpl)} no período.`;
  }

  if (insights) {
    const report = buildOptimizationReport(insights, target);

    // 2) Onde veio o maior volume de conversas
    const total = insights.totals.leads;
    const top = [...insights.byPosition].filter((r) => r.leads > 0 && r.key !== "unknown").sort((a, b) => b.leads - a.leads)[0];
    if (top && total > 0) {
      const share = Math.round((top.leads / total) * 100);
      diag[1] = `Maior volume de conversas: ${top.label} (${share}% das conversas, ${brl(top.spend / top.leads)} por conversa).`;
    }

    // 3) O que ficou caro
    if (report.enoughData) {
      const costly = report.suggestions.filter((s) => s.kind === "economia" || s.kind === "fora_meta").slice(0, 2);
      diag[2] = costly.length > 0 ? costly.map((s) => endWithDot(s.finding)).join(" ") : "Nenhum posicionamento ou público ficou muito acima da média no período.";

      // Plano: as ações das sugestões (economia, fora da meta, oportunidade), sem repetir
      const actions: string[] = [];
      for (const s of report.suggestions) {
        if (s.kind === "atencao") continue;
        const a = endWithDot(s.action);
        if (!actions.includes(a)) actions.push(a);
        if (actions.length === 3) break;
      }
      if (actions.length > 0) plano = [...actions, ...TAIL_PLAN];
    }
  }
  return { diagnostico: diag, plano, contatos: leads > 0 ? leads.toLocaleString("pt-BR") : "" };
}

// Item "não mexido" = ainda é o texto padrão, o último automático, ou (primeiro item do
// diagnóstico) o formato automático antigo. Só esses são recalculados; o que o gestor
// escreveu fica como está.
const OLD_FIRST = /^Custo por conversa de R\$ [\d.,]+/;
export function mergeAuto(current: string[], defaults: string[], lastAuto: string[], auto: string[], isDiagnostico: boolean): string[] {
  const untouched = (i: number) =>
    current[i] === defaults[i] || current[i] === lastAuto[i] || (isDiagnostico && i === 0 && OLD_FIRST.test(current[i] ?? ""));
  if (current.every((_, i) => untouched(i))) return auto;
  return current.map((t, i) => (i < auto.length && untouched(i) ? auto[i] : t));
}

export const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Anúncio com o menor custo por conversa do período. Exige volume mínimo pra não
 * premiar sorte (2+ conversas e R$ 10+ gastos); se ninguém passa, aceita 1 conversa.
 */
export function pickBestAd(ads: MetaAd[]): { ad: MetaAd; conversations: number; cpl: number } | null {
  const scored = ads
    .map((ad) => ({ ad, conversations: (ad.leads ?? 0) + (ad.forms ?? 0), spend: ad.spend ?? 0 }))
    .filter((x) => x.conversations > 0 && x.spend > 0)
    .map((x) => ({ ...x, cpl: x.spend / x.conversations }));
  const strong = scored.filter((x) => x.conversations >= 2 && x.spend >= 10);
  const pool = strong.length > 0 ? strong : scored;
  const best = [...pool].sort((a, b) => a.cpl - b.cpl)[0];
  return best ? { ad: best.ad, conversations: best.conversations, cpl: best.cpl } : null;
}
