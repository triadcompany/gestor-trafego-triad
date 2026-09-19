// Utilitário único de datas em horário de Brasília (America/Sao_Paulo, UTC-3
// fixo — o Brasil não observa horário de verão desde 2019). Usado em todo
// cálculo de "hoje"/"ontem"/período do sistema, tanto client quanto server:
// função pura, sem tocar em `db` nem sessão, então é segura de importar dos
// dois lados sem vazar nada pro bundle do navegador.
//
// Por quê isso existe: "hoje" calculado com `new Date().toISOString()` usa o
// calendário UTC. Como Brasília é UTC-3, qualquer evento entre 21h e 23h59
// (horário de Brasília) já caiu no dia seguinte em UTC — um lead que chegou
// sexta às 23h aparecia como "de hoje" (sábado) nos filtros de período, mas
// como "sexta" em qualquer lugar que já convertia pra horário de Brasília
// (como o mapa de calor). Esse arquivo padroniza tudo pro calendário de
// Brasília, eliminando essa divergência de ~3h.

const TZ = "America/Sao_Paulo";

function ymdInBrasilia(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

// Ancora um Y-M-D (calendário puro, sem hora) em UTC-meio-dia só pra
// serializar como "YYYY-MM-DD" sem depender do fuso do processo Node.
function ymdToIso(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" de um Date (padrão: agora) no calendário de Brasília. */
export function isoDateInBrasilia(date: Date = new Date()): string {
  const { year, month, day } = ymdInBrasilia(date);
  return ymdToIso(year, month, day);
}

/** "YYYY-MM-DD" de N dias corridos atrás (24h × n), no calendário de Brasília. */
export function daysAgoInBrasilia(n: number, from: Date = new Date()): string {
  return isoDateInBrasilia(new Date(from.getTime() - n * 86400000));
}

/** Dia da semana (0=domingo) no calendário de Brasília. */
export function weekdayInBrasilia(date: Date = new Date()): number {
  const weekdayStr = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(date);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[weekdayStr] ?? 0;
}

/**
 * Primeiro e último dia de um mês relativo ao mês atual em Brasília.
 * offset: 0 = este mês, -1 = mês passado, -2 = dois meses atrás, etc.
 */
export function monthRangeInBrasilia(offset: number, from: Date = new Date()): { start: string; end: string } {
  const { year, month } = ymdInBrasilia(from);
  const first = new Date(Date.UTC(year, month - 1 + offset, 1));
  const last = new Date(Date.UTC(year, month - 1 + offset + 1, 0));
  return { start: first.toISOString().slice(0, 10), end: last.toISOString().slice(0, 10) };
}

/**
 * Timestamp UTC exato da meia-noite de Brasília de uma data "YYYY-MM-DD" —
 * pra filtrar colunas que são timestamp de verdade (ex: first_message_at),
 * não colunas de data pura. Meia-noite em Brasília (UTC-3) é 03:00 em UTC —
 * usar "T00:00:00.000Z" direto (achando que já é meia-noite) empurra o
 * início/fim do período 3h pra trás, vazando dado do dia anterior.
 */
export function brasiliaMidnightUTC(dateStr: string): string {
  return new Date(`${dateStr}T03:00:00.000Z`).toISOString();
}
