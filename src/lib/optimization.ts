import type { OptimizationInsights, OptimizationRow } from "./meta";
import { placementsOnly, placementsWithout, type TargetingChange } from "./optimization-apply";

// Sugestões por regras (sem IA). Três tipos:
// - economia: algo gasta bem acima da média (ou sem conversa) com volume suficiente;
// - oportunidade: algo rende bem abaixo da média e merece mais orçamento;
// - atencao: sinal geral da conta (ex.: CTR baixo).
// "Conversas esperadas" (gasto ÷ custo médio) é a medida de volume/confiança:
// item com poucas conversas esperadas nunca vira sugestão, pra não confundir
// acaso com padrão.

export type Confidence = "alta" | "media";
export type SuggestionKind = "economia" | "oportunidade" | "atencao";

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  dimension: string;
  finding: string;
  action: string;
  impactText: string;
  weight: number; // R$ envolvidos — ordena os cartões
  confidence: Confidence;
  apply?: TargetingChange; // sem isso, a sugestão não tem botão "Aplicar"
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
const MAX_SUGGESTIONS = 9;

export const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const times = (v: number) => `${v.toFixed(1).replace(".", ",")}×`;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const cplOf = (r: { spend: number; leads: number }) => (r.leads > 0 ? r.spend / r.leads : Infinity);
const sum = (rows: OptimizationRow[]) =>
  rows.reduce((a, r) => ({ spend: a.spend + r.spend, leads: a.leads + r.leads }), { spend: 0, leads: 0 });

// ── Economia: item isolado caro ou sem conversa ─────────────────────────────
function costlyItems(
  rows: OptimizationRow[],
  totalSpend: number,
  avg: number,
  dimension: string,
  actionFor: (row: OptimizationRow) => { text: string; apply?: TargetingChange } | null
): Suggestion[] {
  const minSpend = Math.max(MIN_SPEND_BRL, totalSpend * MIN_SPEND_SHARE);
  const out: Suggestion[] = [];
  for (const row of rows) {
    if (row.spend < minSpend) continue;
    const expected = row.spend / avg;
    let finding: string;
    let waste: number;
    let confidence: Confidence;
    if (row.leads === 0) {
      if (expected < 2) continue;
      finding = `${row.label} gastou ${brl(row.spend)} e não trouxe nenhuma conversa.`;
      waste = row.spend;
      confidence = expected >= 4 ? "alta" : "media";
    } else {
      const ratio = cplOf(row) / avg;
      if (ratio < CPL_RATIO_ALERT || expected < 3) continue;
      finding = `${row.label}: ${brl(cplOf(row))} por conversa, ${times(ratio)} a média.`;
      waste = row.spend - row.leads * avg;
      confidence = expected >= 6 ? "alta" : "media";
    }
    const action = actionFor(row);
    if (!action) continue;
    out.push({
      id: `${dimension}:${row.key}`,
      kind: "economia",
      dimension,
      finding,
      action: action.text,
      apply: action.apply,
      impactText: `~${brl(waste)} acima do que custaria na média, no período`,
      weight: waste,
      confidence,
    });
  }
  return out;
}

// ── Economia: melhor corte de idade (mínima ou máxima) ───────────────────────
// Compara "abaixo do corte" × "do corte pra cima" (e o inverso pra idade
// máxima) e fica com o corte que mais economiza, se a diferença for clara.
function ageCutoff(ages: OptimizationRow[], totalSpend: number): Suggestion | null {
  const bands = ages.filter((a) => /^\d/.test(a.key));
  if (bands.length < 3) return null;
  let best: Suggestion | null = null;

  const consider = (cut: OptimizationRow[], keep: OptimizationRow[], side: "min" | "max", edgeLabel: string, actionAge: number) => {
    const c = sum(cut);
    const k = sum(keep);
    if (c.spend < totalSpend * 0.15 || k.leads < 10 || c.spend / cplOf(k) < 3) return;
    // Nada de cortar a maior parte do público: o corte tira no máximo metade do
    // gasto e o público que fica mantém pelo menos 40% das conversas.
    if (c.spend > totalSpend * 0.5 || k.leads < (c.leads + k.leads) * 0.4) return;
    const cplCut = cplOf(c);
    const cplKeep = cplOf(k);
    if (cplCut < cplKeep * 1.3) return;
    const saving = c.spend - c.leads * cplKeep;
    if (best && saving <= best.weight) return;
    const cheaper = 1 - cplKeep / cplCut;
    best = {
      id: `idade:${side}:${actionAge}`,
      kind: "economia",
      dimension: "Faixa etária",
      finding:
        side === "min"
          ? `Abaixo de ${actionAge} anos: ${brl(cplCut)} por conversa. De ${actionAge} pra cima: ${brl(cplKeep)} (${pct(cheaper)} mais barato).`
          : `Acima de ${edgeLabel} anos: ${brl(cplCut)} por conversa. Até ${edgeLabel}: ${brl(cplKeep)} (${pct(cheaper)} mais barato).`,
      action: side === "min" ? `Subir a idade mínima para ${actionAge} anos` : `Baixar a idade máxima para ${actionAge} anos`,
      apply: side === "min" ? { kind: "age", ageMin: actionAge, ageMax: null } : { kind: "age", ageMin: null, ageMax: actionAge },
      impactText: `~${brl(saving)} no período se esse gasto rendesse como o resto do público`,
      weight: saving,
      confidence: c.leads >= 20 && k.leads >= 20 ? "alta" : "media",
    };
  };

  for (let i = 1; i < bands.length; i++) {
    const minAge = parseInt(bands[i].key, 10);
    consider(bands.slice(0, i), bands.slice(i), "min", String(minAge), minAge);
    const prevMax = parseInt(bands[i - 1].key.split("-")[1] ?? "", 10);
    if (!Number.isNaN(prevMax)) consider(bands.slice(i), bands.slice(0, i), "max", String(prevMax), prevMax);
  }
  return best;
}

// ── Oportunidade: plataforma bem mais barata que outra ───────────────────────
function platformGap(platforms: OptimizationRow[], totalSpend: number): Suggestion | null {
  const solid = platforms.filter((p) => p.leads >= 10);
  if (solid.length < 2) return null;
  const cheap = solid.reduce((a, b) => (cplOf(a) <= cplOf(b) ? a : b));
  const pricey = solid
    .filter((p) => p !== cheap && p.spend >= totalSpend * 0.15)
    .reduce<OptimizationRow | null>((a, b) => (!a || cplOf(b) > cplOf(a) ? b : a), null);
  if (!pricey || cplOf(pricey) < cplOf(cheap) * 1.4) return null;
  const half = pricey.spend / 2;
  const extra = half / cplOf(cheap) - half / cplOf(pricey);
  return {
    id: `plataforma:${cheap.key}`,
    kind: "oportunidade",
    dimension: "Plataforma",
    finding: `${cheap.label}: ${brl(cplOf(cheap))} por conversa. ${pricey.label}: ${brl(cplOf(pricey))} (${pct(cplOf(pricey) / cplOf(cheap) - 1)} mais caro).`,
    action: `Testar uma campanha só no ${cheap.label} com parte do orçamento do ${pricey.label}`,
    apply: placementsWithout([], [pricey.key]),
    impactText: `~${Math.round(extra)} conversas a mais se metade do gasto do ${pricey.label} rendesse como no ${cheap.label}`,
    weight: extra * cplOf(cheap),
    confidence: cheap.leads >= 20 && pricey.leads >= 20 ? "alta" : "media",
  };
}

// ── Oportunidade: posicionamentos bem abaixo da média ────────────────────────
function cheapPositions(positions: OptimizationRow[], avg: number): Suggestion | null {
  const winners = positions.filter((p) => p.leads >= 10 && cplOf(p) <= avg * 0.7).sort((a, b) => cplOf(a) - cplOf(b)).slice(0, 3);
  if (winners.length === 0) return null;
  const list = winners.map((w) => `${w.label} (${brl(cplOf(w))})`).join(", ");
  const gain = winners.reduce((s, w) => s + w.leads * (avg - cplOf(w)), 0);
  return {
    id: "posicionamento:baratos",
    kind: "oportunidade",
    dimension: "Posicionamento",
    finding: `${winners.length > 1 ? "Os mais baratos" : "O mais barato"}: ${list}. Média: ${brl(avg)}.`,
    action: `Testar um conjunto só com ${winners.length > 1 ? "esses posicionamentos" : "esse posicionamento"} e dar mais orçamento a ele`,
    apply: placementsOnly(winners.map((w) => w.key)),
    impactText: `Economizaram ~${brl(gain)} em relação à média, no período`,
    weight: gain,
    confidence: winners.every((w) => w.leads >= 20) ? "alta" : "media",
  };
}

// ── Oportunidade: um gênero bem mais barato ──────────────────────────────────
function genderGap(genders: OptimizationRow[]): Suggestion | null {
  const g = genders.filter((x) => x.key !== "unknown" && x.leads >= 20);
  if (g.length < 2) return null;
  const [a, b] = [...g].sort((x, y) => cplOf(x) - cplOf(y));
  if (cplOf(b) < cplOf(a) * 1.2) return null;
  return {
    id: `genero:${a.key}`,
    kind: "oportunidade",
    dimension: "Gênero",
    finding: `${a.label}: ${brl(cplOf(a))} por conversa. ${b.label}: ${brl(cplOf(b))} (${pct(cplOf(b) / cplOf(a) - 1)} mais caro).`,
    action: `Testar um conjunto só com o público ${a.label.toLowerCase()}`,
    apply: { kind: "gender", gender: a.key === "female" ? "female" : "male" },
    impactText: `${b.label} gastou ${brl(b.spend)} no período`,
    weight: b.spend - b.leads * cplOf(a),
    confidence: "media",
  };
}

// ── Horário: períodos do dia ─────────────────────────────────────────────────
const PERIODS = [
  { label: "madrugada (0h–6h)", blocks: [0, 1, 2] },
  { label: "manhã (6h–12h)", blocks: [3, 4, 5] },
  { label: "tarde (12h–18h)", blocks: [6, 7, 8] },
  { label: "noite (18h–24h)", blocks: [9, 10, 11] },
];
function periodTotals(data: OptimizationInsights) {
  return PERIODS.map((p) => ({
    label: p.label,
    spend: data.heatSpend.reduce((s, day) => s + p.blocks.reduce((t, b) => t + day[b], 0), 0),
    leads: data.heatLeads.reduce((s, day) => s + p.blocks.reduce((t, b) => t + day[b], 0), 0),
  }));
}

function nightWaste(data: OptimizationInsights, avg: number): Suggestion | null {
  const night = periodTotals(data)[0];
  const spendShare = night.spend / data.totals.spend;
  const leadShare = night.leads / data.totals.leads;
  if (spendShare < 0.1 || leadShare > spendShare / 3 || night.spend / avg < 3) return null;
  const waste = Math.max(0, night.spend - night.leads * avg);
  return {
    id: "horario:madrugada",
    kind: "economia",
    dimension: "Horário",
    finding: `Madrugada (0h–6h): ${pct(spendShare)} do gasto e ${night.leads} conversa${night.leads === 1 ? "" : "s"}.`,
    action: "Programar horário dos anúncios (só funciona com orçamento total da campanha)",
    impactText: `~${brl(waste)} acima do que custaria na média, no período`,
    weight: waste,
    confidence: "media",
  };
}

function bestPeriod(data: OptimizationInsights, avg: number): Suggestion | null {
  const periods = periodTotals(data).filter((p) => p.leads >= 10);
  if (periods.length < 2) return null;
  const best = periods.reduce((a, b) => (cplOf(a) <= cplOf(b) ? a : b));
  const worst = periods.reduce((a, b) => (cplOf(a) >= cplOf(b) ? a : b));
  if (cplOf(worst) < cplOf(best) * 1.4) return null;
  return {
    id: "horario:periodo",
    kind: "atencao",
    dimension: "Horário",
    finding: `Conversa mais barata de ${best.label}: ${brl(cplOf(best))}. Mais cara de ${worst.label}: ${brl(cplOf(worst))}.`,
    action: `Garantir atendimento rápido no WhatsApp de ${best.label.split(" (")[0]}, quando chega o lead mais barato`,
    impactText: `${best.leads} conversas de ${best.label.split(" (")[0]} no período`,
    weight: Math.min(best.leads * (avg - cplOf(best)), data.totals.spend * 0.05),
    confidence: "media",
  };
}

// ── Atenção: CTR baixo ───────────────────────────────────────────────────────
function lowCtr(data: OptimizationInsights): Suggestion | null {
  const { impressions, clicks, spend } = data.totals;
  if (impressions < 10000) return null;
  const ctr = clicks / impressions;
  if (ctr >= 0.01) return null;
  return {
    id: "criativo:ctr",
    kind: "atencao",
    dimension: "Criativo",
    finding: `CTR de ${(ctr * 100).toFixed(1).replace(".", ",")}%: menos de 1 em cada 100 pessoas que veem o anúncio clica.`,
    action: "Testar criativos novos: gancho forte nos 3 primeiros segundos e o preço do carro na tela",
    impactText: `Com o mesmo gasto, cada ponto a mais de CTR traz mais conversas pelo mesmo CPM`,
    weight: spend * 0.1,
    confidence: "alta",
  };
}

export function buildOptimizationReport(data: OptimizationInsights): OptimizationReport {
  const { spend, leads } = data.totals;
  const avg = leads > 0 ? spend / leads : null;
  if (!avg || leads < MIN_TOTAL_LEADS) return { avgCpl: avg, enoughData: false, suggestions: [] };

  const cutoff = ageCutoff(data.byAge, spend);
  // O corte de idade já cobre as faixas isoladas caras daquele lado.
  const singleAges = costlyItems(data.byAge.filter((a) => /^\d/.test(a.key)), spend, avg, "Faixa etária", (r) => {
    const bands = data.byAge.filter((a) => /^\d/.test(a.key)).map((a) => a.key);
    const idx = bands.indexOf(r.key);
    if (idx === 0 && bands[1]) {
      const min = parseInt(bands[1], 10);
      return { text: `Subir a idade mínima para ${min} anos`, apply: { kind: "age", ageMin: min, ageMax: null } };
    }
    if (idx === bands.length - 1 && idx > 0) {
      const max = parseInt(bands[idx - 1].split("-")[1] ?? "65", 10);
      return { text: `Baixar a idade máxima para ${max} anos`, apply: { kind: "age", ageMin: null, ageMax: max } };
    }
    return null;
  }).filter(() => !cutoff);

  const candidates: Array<Suggestion | null> = [
    ...costlyItems(data.byPosition, spend, avg, "Posicionamento", (r) => ({
      text: `Tirar ${r.label} dos posicionamentos`,
      apply: placementsWithout([r.key]),
    })),
    ...costlyItems(data.byPlatform, spend, avg, "Plataforma", (r) =>
      data.byPlatform.length > 1
        ? { text: `Tirar o ${r.label} e concentrar nas outras plataformas`, apply: placementsWithout([], [r.key]) }
        : null
    ),
    cutoff,
    ...singleAges,
    nightWaste(data, avg),
    platformGap(data.byPlatform, spend),
    cheapPositions(data.byPosition, avg),
    genderGap(data.byGender),
    bestPeriod(data, avg),
    lowCtr(data),
  ];

  const suggestions = candidates.filter((s): s is Suggestion => !!s);
  const order: Record<SuggestionKind, number> = { economia: 0, oportunidade: 1, atencao: 2 };
  suggestions.sort((a, b) => order[a.kind] - order[b.kind] || b.weight - a.weight);
  return { avgCpl: avg, enoughData: true, suggestions: suggestions.slice(0, MAX_SUGGESTIONS) };
}
