import type { OptimizationInsights, OptimizationRow } from "./meta";

// Sugestões por regras (sem IA): um item vira sugestão quando gastou um valor
// relevante E, comparado à média da conta, rende bem menos — com volume
// suficiente pra não ser acaso. "Conversas esperadas" = quantas o item teria
// trazido se custasse a média; é a medida de confiança.

export type Confidence = "alta" | "media";

export interface Suggestion {
  id: string;
  dimension: string;
  finding: string;
  action: string;
  impact: number; // R$ que o item gastou acima do que custaria na média
  confidence: Confidence;
}

export interface OptimizationReport {
  avgCpl: number | null;
  enoughData: boolean;
  suggestions: Suggestion[];
}

export const MIN_TOTAL_LEADS = 10;
const MIN_SPEND_SHARE = 0.08;
const MIN_SPEND_BRL = 30;
const CPL_RATIO_ALERT = 1.5;

export const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const times = (v: number) => `${v.toFixed(1).replace(".", ",")}×`;

function evaluate(
  rows: OptimizationRow[],
  totalSpend: number,
  avg: number,
  dimension: string,
  actionFor: (row: OptimizationRow) => string | null
): Suggestion[] {
  const minSpend = Math.max(MIN_SPEND_BRL, totalSpend * MIN_SPEND_SHARE);
  const out: Suggestion[] = [];
  for (const row of rows) {
    if (row.spend < minSpend) continue;
    const expected = row.spend / avg;
    let finding: string;
    let impact: number;
    let confidence: Confidence;
    if (row.leads === 0) {
      if (expected < 2) continue;
      finding = `${row.label} gastou ${brl(row.spend)} e não trouxe nenhuma conversa.`;
      impact = row.spend;
      confidence = expected >= 4 ? "alta" : "media";
    } else {
      const cpl = row.spend / row.leads;
      const ratio = cpl / avg;
      if (ratio < CPL_RATIO_ALERT || expected < 3) continue;
      finding = `${row.label}: ${brl(cpl)} por conversa, ${times(ratio)} a média da conta.`;
      impact = row.spend - row.leads * avg;
      confidence = expected >= 6 ? "alta" : "media";
    }
    const action = actionFor(row);
    if (!action) continue;
    out.push({ id: `${dimension}:${row.key}`, dimension, finding, action, impact, confidence });
  }
  return out;
}

function ageAction(row: OptimizationRow, ages: OptimizationRow[]): string {
  const keys = ages.map((a) => a.key);
  const idx = keys.indexOf(row.key);
  if (idx === 0 && keys[1]) return `Subir a idade mínima para ${parseInt(keys[1], 10)} anos`;
  if (idx === keys.length - 1 && idx > 0) {
    const prevMax = keys[idx - 1].split("-")[1];
    return prevMax ? `Baixar a idade máxima para ${prevMax} anos` : `Avaliar tirar a faixa ${row.label}`;
  }
  return `Faixa do meio: separar em outro conjunto pra testar (a Meta só corta idade nas pontas)`;
}

export function buildOptimizationReport(data: OptimizationInsights): OptimizationReport {
  const { spend, leads } = data.totals;
  const avg = leads > 0 ? spend / leads : null;
  if (!avg || leads < MIN_TOTAL_LEADS) return { avgCpl: avg, enoughData: false, suggestions: [] };

  const suggestions = [
    ...evaluate(data.byPosition, spend, avg, "Posicionamento", (r) => `Tirar ${r.label} dos posicionamentos`),
    ...evaluate(data.byPlatform, spend, avg, "Plataforma", (r) =>
      data.byPlatform.length > 1 ? `Tirar o ${r.label} e concentrar nas outras plataformas` : null
    ),
    ...evaluate(data.byAge, spend, avg, "Faixa etária", (r) => ageAction(r, data.byAge)),
    ...evaluate(data.byGender.filter((g) => g.key !== "unknown"), spend, avg, "Gênero", (r) => {
      const other = data.byGender.find((g) => g.key !== r.key && g.key !== "unknown");
      return other ? `Testar um conjunto só com o público ${other.label.toLowerCase()}` : null;
    }),
  ];

  // Madrugada (0h–6h): gasto relevante com retorno bem abaixo da proporção.
  const sumBlocks = (m: number[][]) => m.reduce((s, day) => s + day[0] + day[1] + day[2], 0);
  const nightSpend = sumBlocks(data.heatSpend);
  const nightLeads = sumBlocks(data.heatLeads);
  const spendShare = spend > 0 ? nightSpend / spend : 0;
  const leadShare = nightLeads / leads;
  if (spendShare >= 0.1 && leadShare <= spendShare / 3 && nightSpend / avg >= 3) {
    suggestions.push({
      id: "horario:madrugada",
      dimension: "Horário",
      finding: `Madrugada (0h–6h): ${Math.round(spendShare * 100)}% do gasto e ${nightLeads} conversa${nightLeads === 1 ? "" : "s"}.`,
      action: "Programar horário dos anúncios (só funciona com orçamento total da campanha)",
      impact: Math.max(0, nightSpend - nightLeads * avg),
      confidence: "media",
    });
  }

  suggestions.sort((a, b) => b.impact - a.impact);
  return { avgCpl: avg, enoughData: true, suggestions: suggestions.slice(0, 6) };
}
