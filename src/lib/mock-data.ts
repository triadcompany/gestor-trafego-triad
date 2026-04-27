export type ClientStatus = "on-target" | "attention" | "critical" | "no-data";

export interface Campaign {
  id: string;
  name: string;
  status: "active" | "paused";
  dailyBudget: number;
  leads: number;
  cpl: number;
}

export interface Client {
  id: string;
  name: string;
  adAccountId: string;
  segment: "Popular" | "Premium";
  cplMin: number;
  cplMax: number;
  active: boolean;
  status: ClientStatus;
  cplToday: number | null;
  spendToday: number;
  leadsToday: number;
  cplHistory: { date: string; cpl: number }[];
  campaigns: Campaign[];
}

function genHistory(base: number, jitter: number) {
  const out: { date: string; cpl: number }[] = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const cpl = Math.max(1, base + (Math.random() - 0.5) * jitter * 2);
    out.push({ date: d.toISOString().slice(5, 10), cpl: Number(cpl.toFixed(2)) });
  }
  return out;
}

export const mockClients: Client[] = [
  {
    id: "1",
    name: "Auto Center Silva",
    adAccountId: "act_1029384756",
    segment: "Popular",
    cplMin: 6,
    cplMax: 12,
    active: true,
    status: "on-target",
    cplToday: 8.4,
    spendToday: 252,
    leadsToday: 30,
    cplHistory: genHistory(8.5, 2),
    campaigns: [
      { id: "c1", name: "Honda Civic 2024 - Azul", status: "active", dailyBudget: 80, leads: 12, cpl: 7.2 },
      { id: "c2", name: "Toyota Corolla Promo", status: "active", dailyBudget: 100, leads: 14, cpl: 8.9 },
      { id: "c3", name: "Black Friday Geral", status: "paused", dailyBudget: 150, leads: 0, cpl: 0 },
    ],
  },
  {
    id: "2",
    name: "Imobiliária Horizonte",
    adAccountId: "act_5647382910",
    segment: "Premium",
    cplMin: 12,
    cplMax: 25,
    active: true,
    status: "attention",
    cplToday: 22.8,
    spendToday: 684,
    leadsToday: 30,
    cplHistory: genHistory(20, 4),
    campaigns: [
      { id: "c4", name: "Apartamentos Zona Sul", status: "active", dailyBudget: 200, leads: 9, cpl: 22.2 },
      { id: "c5", name: "Casas Alphaville", status: "active", dailyBudget: 250, leads: 12, cpl: 20.8 },
    ],
  },
  {
    id: "3",
    name: "Clínica Bem Estar",
    adAccountId: "act_9182736450",
    segment: "Popular",
    cplMin: 6,
    cplMax: 12,
    active: true,
    status: "critical",
    cplToday: 18.3,
    spendToday: 549,
    leadsToday: 30,
    cplHistory: genHistory(15, 5),
    campaigns: [
      { id: "c6", name: "Harmonização Facial", status: "active", dailyBudget: 120, leads: 6, cpl: 20 },
      { id: "c7", name: "Limpeza de Pele", status: "active", dailyBudget: 80, leads: 5, cpl: 16 },
    ],
  },
  {
    id: "4",
    name: "Escola de Idiomas Global",
    adAccountId: "act_3344556677",
    segment: "Popular",
    cplMin: 6,
    cplMax: 12,
    active: true,
    status: "no-data",
    cplToday: null,
    spendToday: 0,
    leadsToday: 0,
    cplHistory: genHistory(9, 2),
    campaigns: [
      { id: "c8", name: "Inglês Conversação", status: "paused", dailyBudget: 60, leads: 0, cpl: 0 },
    ],
  },
];

export const statusLabels: Record<ClientStatus, string> = {
  "on-target": "No alvo",
  attention: "Atenção",
  critical: "Crítico",
  "no-data": "Sem dados",
};

export const statusColorClass: Record<ClientStatus, string> = {
  "on-target": "bg-status-on-target",
  attention: "bg-status-attention",
  critical: "bg-status-critical",
  "no-data": "bg-status-no-data",
};

export function brl(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: n % 1 === 0 ? 0 : 2 });
}

export function getClient(id: string): Client | undefined {
  return mockClients.find((c) => c.id === id);
}
