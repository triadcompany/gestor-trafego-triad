import { useState } from "react";
import {
  LayoutDashboard,
  Users,
  Wallet,
  QrCode,
  ClipboardList,
  TrendingUp,
  Target,
  MessageCircle,
  Bot,
  PlusSquare,
  Stethoscope,
  Settings,
  ChevronLeft,
} from "lucide-react";

type SimView =
  | "dashboard"
  | "clients-list"
  | "client-detail"
  | "saldos"
  | "pix"
  | "tarefas"
  | "vendas"
  | "rastreamento"
  | "mensagens"
  | "agente"
  | "nova-campanha"
  | "diagnostico"
  | "configuracoes";

const DEMO_CLIENTS = [
  { id: "studio-fit", name: "Studio Fit", account: "act_2847193056", segment: "Academia", active: true },
  { id: "doce-ponto", name: "Doce Ponto", account: "act_1938475620", segment: "Confeitaria", active: true },
  { id: "horizonte", name: "Construtora Horizonte", account: "act_5729384610", segment: "Imobiliário", active: true },
  { id: "clinica-vitale", name: "Clínica Vitale", account: "act_3847562910", segment: "Saúde", active: false },
] as const;

const DEMO_CAMPAIGNS: Record<string, { name: string; active: boolean; spend: string; leads: number; cpl: string }[]> = {
  "studio-fit": [
    { name: "Plano Anual", active: true, spend: "R$ 1.240", leads: 86, cpl: "R$ 14,42" },
    { name: "Aula Experimental", active: true, spend: "R$ 620", leads: 54, cpl: "R$ 11,48" },
    { name: "Remarketing", active: false, spend: "R$ 180", leads: 12, cpl: "R$ 15,00" },
  ],
  "doce-ponto": [
    { name: "Encomendas de Festa", active: true, spend: "R$ 410", leads: 38, cpl: "R$ 10,79" },
    { name: "Bolo no Pote", active: true, spend: "R$ 260", leads: 29, cpl: "R$ 8,97" },
  ],
  horizonte: [
    { name: "Lançamento Fase 2", active: true, spend: "R$ 2.180", leads: 64, cpl: "R$ 34,06" },
    { name: "Remarketing Visita", active: true, spend: "R$ 390", leads: 21, cpl: "R$ 18,57" },
  ],
  "clinica-vitale": [{ name: "Check-up Completo", active: false, spend: "R$ 0", leads: 0, cpl: "—" }],
};

const DEMO_AUTOMATIONS = [
  { name: "Relatório semanal", schedule: "Segunda, 08:30", destination: "Grupo do cliente" },
  { name: "Resumo de grupo", schedule: "Diário, 12:00 e 17:30", destination: "Operacional" },
  { name: "Lista de campanhas ativas", schedule: "Manual", destination: "Grupo do cliente" },
];

const NAV_GROUPS: { label: string; items: { view: SimView; label: string; icon: typeof LayoutDashboard }[] }[] = [
  { label: "Visão", items: [{ view: "dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  {
    label: "Clientes",
    items: [
      { view: "clients-list", label: "Clientes", icon: Users },
      { view: "saldos", label: "Saldos", icon: Wallet },
      { view: "pix", label: "PIX", icon: QrCode },
    ],
  },
  {
    label: "Operação",
    items: [
      { view: "tarefas", label: "Tarefas", icon: ClipboardList },
      { view: "vendas", label: "Vendas", icon: TrendingUp },
      { view: "rastreamento", label: "Rastreamento", icon: Target },
    ],
  },
  {
    label: "Ferramentas",
    items: [
      { view: "mensagens", label: "Automações", icon: MessageCircle },
      { view: "agente", label: "Agente IA", icon: Bot },
      { view: "nova-campanha", label: "Nova Campanha", icon: PlusSquare },
      { view: "diagnostico", label: "Diagnóstico", icon: Stethoscope },
      { view: "configuracoes", label: "Configurações", icon: Settings },
    ],
  },
];

const appVars = {
  "--app-bg": "oklch(0.227 0.004 286.1)",
  "--app-fg": "oklch(0.943 0 0)",
  "--app-card": "oklch(0.261 0.004 286.1)",
  "--app-muted-fg": "oklch(0.68 0.006 286.2)",
  "--app-border": "oklch(0.286 0.005 286.1)",
  "--app-primary": "oklch(0.74 0.115 205)",
  "--app-primary-2": "oklch(0.64 0.12 205)",
  "--app-primary-fg": "oklch(0.14 0.02 205)",
  "--app-accent": "oklch(0.74 0.115 205 / 16%)",
  "--app-accent-fg": "oklch(0.82 0.08 205)",
  "--app-sidebar": "oklch(0.192 0.004 286.0)",
  "--app-ok": "oklch(0.767 0.108 163.4)",
  "--app-attn": "oklch(0.788 0.119 81.8)",
  "--app-crit": "oklch(0.725 0.138 21.0)",
} as React.CSSProperties;

function MiniCard({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <div
      className="rounded-xl border-[var(--app-border)] p-4"
      style={{ border: "1px solid var(--app-border)", opacity: muted ? 0.7 : 1 }}
    >
      {children}
    </div>
  );
}

export function AppSimulator() {
  const [view, setView] = useState<SimView>("clients-list");
  const [selectedClientId, setSelectedClientId] = useState<string>(DEMO_CLIENTS[0].id);

  const selectedClient = DEMO_CLIENTS.find((c) => c.id === selectedClientId) ?? DEMO_CLIENTS[0];
  const campaigns = DEMO_CAMPAIGNS[selectedClient.id] ?? [];

  const openClient = (id: string) => {
    setSelectedClientId(id);
    setView("client-detail");
  };

  const navActive = (v: SimView) => view === v || (v === "clients-list" && view === "client-detail");

  return (
    <div className="font-sans">
      <div
        className="rounded-[14px] overflow-hidden"
        style={{ ...appVars, background: "var(--app-bg)", color: "var(--app-fg)", border: "1px solid var(--app-border)" }}
      >
        <div
          className="flex items-center gap-2 px-[18px] py-3.5"
          style={{ borderBottom: "1px solid var(--app-border)", background: "var(--app-sidebar)" }}
        >
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: "#FF5F57" }} />
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: "#FEBC2E" }} />
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: "#28C840" }} />
          <span
            className="ml-3.5 min-w-0 overflow-hidden whitespace-nowrap text-ellipsis text-xs"
            style={{ color: "var(--app-muted-fg)", fontFamily: "'DM Mono',monospace" }}
          >
            gestor.triadcomp4ny.com.br/clients
          </span>
        </div>

        <div className="flex min-h-[480px] flex-wrap">
          <aside
            className="flex w-60 shrink-0 flex-col gap-4 overflow-y-auto p-3"
            style={{ borderRight: "1px solid var(--app-border)", background: "var(--app-sidebar)" }}
          >
            <div className="flex items-center gap-2 px-2 pt-2 pb-1">
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md font-extrabold"
                style={{
                  background: "linear-gradient(135deg,var(--app-primary),var(--app-primary-2))",
                  color: "var(--app-primary-fg)",
                }}
              >
                G
              </div>
              <div className="text-sm font-semibold leading-tight">
                Gestor de<br />Tráfego
              </div>
            </div>

            {NAV_GROUPS.map((group) => (
              <div key={group.label}>
                <p
                  className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--app-muted-fg)" }}
                >
                  {group.label}
                </p>
                <div className="flex flex-col gap-0.5">
                  {group.items.map((item) => {
                    const active = navActive(item.view);
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.view}
                        onClick={() => setView(item.view)}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors"
                        style={{
                          color: active ? "var(--app-accent-fg)" : "var(--app-muted-fg)",
                          background: active ? "var(--app-accent)" : "transparent",
                          fontWeight: active ? 500 : 400,
                        }}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </aside>

          <div className="min-w-[280px] flex-1 p-6">
            {view === "clients-list" && (
              <>
                <h3 className="mb-[18px] text-xl font-semibold">Clientes</h3>
                <div className="overflow-x-auto rounded-[14px]" style={{ border: "1px solid var(--app-border)" }}>
                  <div className="min-w-[480px]">
                    <div
                      className="flex items-center gap-3.5 px-3.5 py-2.5 text-xs font-medium"
                      style={{ borderBottom: "1px solid var(--app-border)", color: "var(--app-muted-fg)" }}
                    >
                      <span className="flex-[1_1_140px]">Nome</span>
                      <span className="flex-[1_1_150px]" style={{ fontFamily: "'DM Mono',monospace" }}>Conta Meta</span>
                      <span className="flex-[0_0_110px]">Segmento</span>
                      <span className="flex-[0_0_90px]">Status</span>
                    </div>
                    {DEMO_CLIENTS.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => openClient(c.id)}
                        className="flex w-full items-center gap-3.5 px-3.5 py-3 text-left text-sm transition-colors hover:bg-white/5"
                        style={{ borderBottom: "1px solid var(--app-border)", color: "var(--app-fg)" }}
                      >
                        <span className="flex-[1_1_140px] font-medium">{c.name}</span>
                        <span
                          className="flex-[1_1_150px] text-[13px]"
                          style={{ color: "var(--app-muted-fg)", fontFamily: "'DM Mono',monospace" }}
                        >
                          {c.account}
                        </span>
                        <span className="flex-[0_0_110px]">
                          <span
                            className="inline-flex rounded-lg px-2.5 py-0.5 text-xs font-semibold"
                            style={{ border: "1px solid var(--app-border)" }}
                          >
                            {c.segment}
                          </span>
                        </span>
                        <span
                          className="flex items-center gap-1.5 flex-[0_0_90px] text-[13px]"
                          style={{ color: "var(--app-muted-fg)" }}
                        >
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ background: c.active ? "var(--app-ok)" : "var(--app-muted-fg)" }}
                          />
                          {c.active ? "Ativo" : "Pausado"}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {view === "client-detail" && (
              <>
                <button
                  onClick={() => setView("clients-list")}
                  className="mb-[18px] inline-flex items-center gap-1.5 text-[13px]"
                  style={{ color: "var(--app-muted-fg)" }}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Clientes
                </button>
                <h3 className="mb-0.5 text-xl font-semibold">{selectedClient.name}</h3>
                <p className="mb-[18px] text-[13px]" style={{ color: "var(--app-muted-fg)", fontFamily: "'DM Mono',monospace" }}>
                  {selectedClient.account}
                </p>
                <div className="overflow-x-auto rounded-[14px]" style={{ border: "1px solid var(--app-border)" }}>
                  <div className="min-w-[460px]">
                    {campaigns.map((cp) => (
                      <div
                        key={cp.name}
                        className="flex items-center gap-3.5 px-3.5 py-3 text-sm"
                        style={{ borderBottom: "1px solid var(--app-border)" }}
                      >
                        <span
                          className="h-[9px] w-[9px] shrink-0 rounded-full"
                          style={{ background: cp.active ? "var(--app-ok)" : "var(--app-muted-fg)" }}
                        />
                        <span className="flex-[1_1_150px] font-medium">{cp.name}</span>
                        <span
                          className="flex-[0_0_80px] text-right text-[13px]"
                          style={{ color: "var(--app-muted-fg)", fontFamily: "'DM Mono',monospace" }}
                        >
                          {cp.spend}
                        </span>
                        <span
                          className="flex-[0_0_100px] text-right text-[13px]"
                          style={{ color: "var(--app-muted-fg)", fontFamily: "'DM Mono',monospace" }}
                        >
                          {cp.leads} conv.
                        </span>
                        <span
                          className="flex-[0_0_80px] text-right text-[13px]"
                          style={{ color: "var(--app-muted-fg)", fontFamily: "'DM Mono',monospace" }}
                        >
                          {cp.cpl}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {view === "mensagens" && (
              <>
                <h3 className="mb-[18px] text-xl font-semibold">Automações</h3>
                <div className="overflow-x-auto rounded-[14px]" style={{ border: "1px solid var(--app-border)" }}>
                  <div className="min-w-[480px]">
                    {DEMO_AUTOMATIONS.map((a) => (
                      <div
                        key={a.name}
                        className="flex items-center gap-3.5 px-3.5 py-3 text-sm"
                        style={{ borderBottom: "1px solid var(--app-border)" }}
                      >
                        <span className="flex-[1_1_170px] font-medium">{a.name}</span>
                        <span className="flex-[1_1_170px] text-[13px]" style={{ color: "var(--app-muted-fg)" }}>
                          {a.schedule}
                        </span>
                        <span
                          className="flex-[0_0_140px] rounded-lg px-2.5 py-0.5 text-center text-xs"
                          style={{ background: "var(--app-accent)", color: "var(--app-accent-fg)" }}
                        >
                          {a.destination}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {view === "dashboard" && (
              <>
                <div className="mb-[18px] flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-xl font-semibold">Dashboard</h3>
                  <span
                    className="rounded-full px-3 py-1 text-xs"
                    style={{ background: "var(--app-accent)", color: "var(--app-accent-fg)" }}
                  >
                    Últimos 7 dias
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { name: "Studio Fit", ok: true, cci: "R$ 18,40", spend: "R$ 412", leads: 22 },
                    { name: "Doce Ponto", ok: false, cci: "R$ 34,90", spend: "R$ 298", leads: 9 },
                    { name: "Construtora Horizonte", ok: true, cci: "R$ 22,10", spend: "R$ 1.180", leads: 53 },
                  ].map((d) => (
                    <MiniCard key={d.name}>
                      <div className="mb-2.5 flex items-center gap-2">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: d.ok ? "var(--app-ok)" : "var(--app-crit)" }}
                        />
                        <span className="text-sm font-semibold">{d.name}</span>
                      </div>
                      <p className="text-2xl font-bold" style={{ color: d.ok ? "var(--app-ok)" : "var(--app-crit)" }}>
                        {d.cci}
                      </p>
                      <p className="mb-2.5 text-xs" style={{ color: "var(--app-muted-fg)" }}>CCI hoje</p>
                      <div className="flex gap-4 text-xs" style={{ color: "var(--app-muted-fg)" }}>
                        <span>Gasto <strong style={{ color: "var(--app-fg)" }}>{d.spend}</strong></span>
                        <span>Conversas <strong style={{ color: "var(--app-fg)" }}>{d.leads}</strong></span>
                      </div>
                    </MiniCard>
                  ))}
                  <MiniCard muted>
                    <div className="mb-2.5 flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--app-muted-fg)" }} />
                      <span className="text-sm font-semibold">Clínica Vitale</span>
                    </div>
                    <p className="text-2xl font-bold" style={{ color: "var(--app-muted-fg)" }}>—</p>
                    <p className="mb-2.5 text-xs" style={{ color: "var(--app-muted-fg)" }}>Pausado</p>
                    <div className="flex gap-4 text-xs" style={{ color: "var(--app-muted-fg)" }}>
                      <span>Gasto <strong style={{ color: "var(--app-fg)" }}>R$ 0</strong></span>
                      <span>Conversas <strong style={{ color: "var(--app-fg)" }}>0</strong></span>
                    </div>
                  </MiniCard>
                </div>
              </>
            )}

            {view === "saldos" && (
              <>
                <h3 className="mb-[18px] text-xl font-semibold">Saldos Meta</h3>
                <div className="mb-[18px] grid grid-cols-2 gap-3">
                  <MiniCard>
                    <p className="text-xs" style={{ color: "var(--app-muted-fg)" }}>Contas críticas</p>
                    <p className="mt-1 text-[22px] font-bold" style={{ color: "var(--app-crit)" }}>1</p>
                  </MiniCard>
                  <MiniCard>
                    <p className="text-xs" style={{ color: "var(--app-muted-fg)" }}>Em atenção</p>
                    <p className="mt-1 text-[22px] font-bold" style={{ color: "var(--app-attn)" }}>1</p>
                  </MiniCard>
                </div>
                <div className="overflow-x-auto rounded-[14px]" style={{ border: "1px solid var(--app-border)" }}>
                  <div className="min-w-[480px]">
                    <div className="flex items-center gap-3.5 px-3.5 py-3" style={{ borderBottom: "1px solid var(--app-border)" }}>
                      <span className="flex-[1_1_150px] font-medium">Construtora Horizonte</span>
                      <span className="flex-[1_1_120px]">
                        <span className="text-[13px]">R$ 1.240</span>
                        <span className="mt-1 block h-1 overflow-hidden rounded-full" style={{ background: "var(--app-border)" }}>
                          <span className="block h-full w-[70%]" style={{ background: "var(--app-ok)" }} />
                        </span>
                      </span>
                      <span className="flex-[0_0_90px] text-[13px]" style={{ color: "var(--app-ok)" }}>6,9 dias</span>
                    </div>
                    <div className="flex items-center gap-3.5 px-3.5 py-3" style={{ borderBottom: "1px solid var(--app-border)" }}>
                      <span className="flex-[1_1_150px] font-medium">Clínica Vitale</span>
                      <span className="flex-[1_1_120px]">
                        <span className="text-[13px]">R$ 85</span>
                        <span className="mt-1 block h-1 overflow-hidden rounded-full" style={{ background: "var(--app-border)" }}>
                          <span className="block h-full w-[8%]" style={{ background: "var(--app-crit)" }} />
                        </span>
                      </span>
                      <span className="flex-[0_0_90px] text-[13px]" style={{ color: "var(--app-crit)" }}>0,5 dia</span>
                    </div>
                    <div className="flex items-center gap-3.5 px-3.5 py-3">
                      <span className="flex-[1_1_150px] font-medium">Studio Fit</span>
                      <span className="flex-[1_1_120px] text-xs" style={{ color: "var(--app-muted-fg)" }}>Pagamento no cartão</span>
                      <span className="flex-[0_0_90px]" />
                    </div>
                  </div>
                </div>
              </>
            )}

            {view === "pix" && (
              <>
                <h3 className="mb-[18px] text-xl font-semibold">Cobranças PIX</h3>
                <div className="mb-[18px] grid grid-cols-3 gap-3">
                  <MiniCard>
                    <p className="text-xs" style={{ color: "var(--app-muted-fg)" }}>A cobrar hoje</p>
                    <p className="mt-1 text-xl font-bold" style={{ color: "var(--app-crit)" }}>R$ 1.500</p>
                  </MiniCard>
                  <MiniCard>
                    <p className="text-xs" style={{ color: "var(--app-muted-fg)" }}>Esta semana</p>
                    <p className="mt-1 text-xl font-bold" style={{ color: "var(--app-attn)" }}>R$ 2.300</p>
                  </MiniCard>
                  <MiniCard>
                    <p className="text-xs" style={{ color: "var(--app-muted-fg)" }}>Clientes PIX</p>
                    <p className="mt-1 text-xl font-bold">3</p>
                  </MiniCard>
                </div>
                <div className="overflow-x-auto rounded-[14px]" style={{ border: "1px solid var(--app-border)" }}>
                  <div className="min-w-[500px]">
                    <div className="flex items-center gap-3.5 px-3.5 py-3" style={{ borderBottom: "1px solid var(--app-border)" }}>
                      <span className="flex-[1_1_140px] font-medium">Studio Fit</span>
                      <span className="flex-[1_1_100px] text-xs" style={{ color: "var(--app-muted-fg)" }}>todo dia 10</span>
                      <span
                        className="flex-[0_0_70px] rounded-full px-2 py-0.5 text-center text-[11px]"
                        style={{ background: "var(--app-accent)", color: "var(--app-accent-fg)" }}
                      >
                        Mensal
                      </span>
                      <span className="flex-[1_1_80px] text-right font-semibold" style={{ fontFamily: "'DM Mono',monospace" }}>R$ 1.500</span>
                      <span className="flex-[0_0_60px] text-right text-xs font-semibold" style={{ color: "var(--app-crit)" }}>Hoje</span>
                    </div>
                    <div className="flex items-center gap-3.5 px-3.5 py-3">
                      <span className="flex-[1_1_140px] font-medium">Doce Ponto</span>
                      <span className="flex-[1_1_100px] text-xs" style={{ color: "var(--app-muted-fg)" }}>toda Segunda</span>
                      <span
                        className="flex-[0_0_70px] rounded-full px-2 py-0.5 text-center text-[11px]"
                        style={{ background: "var(--app-accent)", color: "var(--app-accent-fg)" }}
                      >
                        Semanal
                      </span>
                      <span className="flex-[1_1_80px] text-right font-semibold" style={{ fontFamily: "'DM Mono',monospace" }}>R$ 200</span>
                      <span className="flex-[0_0_60px] text-right text-xs" style={{ color: "var(--app-attn)" }}>3 dias</span>
                    </div>
                  </div>
                </div>
              </>
            )}

            {view === "tarefas" && (
              <>
                <div className="mb-[18px] flex items-center gap-5" style={{ borderBottom: "1px solid var(--app-border)" }}>
                  <span className="pb-2.5 text-sm font-semibold" style={{ borderBottom: "2px solid var(--app-primary)" }}>Tarefas</span>
                  <span className="pb-2.5 text-sm" style={{ color: "var(--app-muted-fg)" }}>Anotações</span>
                  <span className="pb-2.5 text-sm" style={{ color: "var(--app-muted-fg)" }}>Relatórios</span>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-3.5 rounded-[10px] px-3.5 py-3" style={{ border: "1px solid var(--app-border)" }}>
                    <span className="h-[18px] w-[18px] shrink-0 rounded-full" style={{ border: "2px solid var(--app-primary)" }} />
                    <span className="flex-1 text-sm">Revisar criativos da campanha</span>
                    <span
                      className="rounded-full px-2.5 py-1 text-[11px]"
                      style={{ background: "var(--app-accent)", color: "var(--app-accent-fg)" }}
                    >
                      Em andamento
                    </span>
                    <span className="text-xs" style={{ color: "var(--app-muted-fg)" }}>25/10</span>
                  </div>
                  <div className="flex items-center gap-3.5 rounded-[10px] px-3.5 py-3" style={{ border: "1px solid var(--app-border)" }}>
                    <span className="h-[18px] w-[18px] shrink-0 rounded-full" style={{ border: "2px solid var(--app-border)" }} />
                    <span className="flex-1 text-sm">Confirmar nova verba com Construtora Horizonte</span>
                    <span
                      className="rounded-full px-2.5 py-1 text-[11px]"
                      style={{ background: "var(--app-border)", color: "var(--app-muted-fg)" }}
                    >
                      Pendente
                    </span>
                    <span className="text-xs" style={{ color: "var(--app-muted-fg)" }}>28/10</span>
                  </div>
                </div>
              </>
            )}

            {view === "vendas" && (
              <>
                <h3 className="mb-[18px] text-xl font-semibold">Vendas</h3>
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl p-4" style={{ background: "var(--app-accent)" }}>
                    <p className="text-xs" style={{ color: "var(--app-accent-fg)" }}>Total de vendas</p>
                    <p className="mt-1 text-2xl font-bold">
                      47<span className="text-sm font-normal" style={{ color: "var(--app-muted-fg)" }}> / 60</span>
                    </p>
                    <span className="mt-2 block h-[5px] overflow-hidden rounded-full" style={{ background: "var(--app-border)" }}>
                      <span className="block h-full w-[78%]" style={{ background: "var(--app-ok)" }} />
                    </span>
                  </div>
                  <MiniCard>
                    <p className="text-xs" style={{ color: "var(--app-muted-fg)" }}>Faturado estimado</p>
                    <p className="mt-1 text-2xl font-bold">R$ 94.300</p>
                    <p className="mt-2 text-xs" style={{ color: "var(--app-muted-fg)" }}>32 de 47 vendas com valor</p>
                  </MiniCard>
                  <MiniCard>
                    <p className="text-xs" style={{ color: "var(--app-muted-fg)" }}>Clientes no alvo</p>
                    <p className="mt-1 text-2xl font-bold">
                      3<span className="text-sm font-normal" style={{ color: "var(--app-muted-fg)" }}> / 4</span>
                    </p>
                    <p className="mt-2 text-xs" style={{ color: "var(--app-muted-fg)" }}>≥ 80% da meta do mês</p>
                  </MiniCard>
                </div>
              </>
            )}

            {view === "rastreamento" && (
              <>
                <h3 className="mb-[18px] text-xl font-semibold">Rastreamento de leads</h3>
                <div className="overflow-x-auto rounded-[14px]" style={{ border: "1px solid var(--app-border)" }}>
                  <div className="min-w-[500px]">
                    <div className="flex items-center gap-3.5 px-3.5 py-3" style={{ borderBottom: "1px solid var(--app-border)" }}>
                      <span className="flex-[1_1_170px] text-[13px]" style={{ fontFamily: "'DM Mono',monospace" }}>+55 (11) 98765-0009</span>
                      <span className="flex-[1_1_180px] text-[13px]" style={{ color: "var(--app-muted-fg)" }}>Carrossel — Promo Setembro</span>
                      <span
                        className="flex-[0_0_100px] rounded-full px-2.5 py-1 text-center text-[11px]"
                        style={{ background: "var(--app-accent)", color: "var(--app-accent-fg)" }}
                      >
                        Qualificado
                      </span>
                    </div>
                    <div className="flex items-center gap-3.5 px-3.5 py-3">
                      <span className="flex-[1_1_170px] text-[13px]" style={{ fontFamily: "'DM Mono',monospace" }}>+55 (21) 97654-0021</span>
                      <span className="flex-[1_1_180px] text-[13px]" style={{ color: "var(--app-muted-fg)" }}>Vídeo — Institucional</span>
                      <span
                        className="flex-[0_0_100px] rounded-full px-2.5 py-1 text-center text-[11px]"
                        style={{ background: "var(--app-border)", color: "var(--app-muted-fg)" }}
                      >
                        Aguardando
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}

            {view === "agente" && (
              <div className="flex min-h-[360px] gap-4">
                <div className="flex w-[170px] shrink-0 flex-col gap-2">
                  <p className="mb-1 text-[11px] font-semibold uppercase" style={{ color: "var(--app-muted-fg)" }}>Conversas</p>
                  <div className="rounded-lg px-2.5 py-2 text-[13px]" style={{ background: "var(--app-accent)", color: "var(--app-accent-fg)" }}>
                    Assistente de Tráfego
                  </div>
                  <div className="rounded-lg px-2.5 py-2 text-[13px]" style={{ color: "var(--app-muted-fg)" }}>
                    Ideias — Studio Fit
                  </div>
                </div>
                <div className="flex flex-1 flex-col items-center justify-center gap-2.5 text-center">
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-full"
                    style={{ background: "linear-gradient(135deg,var(--app-primary),var(--app-primary-2))", color: "var(--app-primary-fg)" }}
                  >
                    <Bot className="h-[22px] w-[22px]" />
                  </div>
                  <p className="font-semibold">Assistente de Tráfego</p>
                  <p className="max-w-[280px] text-[13px]" style={{ color: "var(--app-muted-fg)" }}>
                    Pergunte sobre o desempenho das campanhas, ou peça pra pausar, ajustar orçamento e analisar resultados.
                  </p>
                  <div className="mt-2 grid max-w-[360px] grid-cols-2 gap-2">
                    <span className="rounded-lg px-2.5 py-2 text-xs" style={{ border: "1px solid var(--app-border)" }}>
                      Como está o CPL do Studio Fit essa semana?
                    </span>
                    <span className="rounded-lg px-2.5 py-2 text-xs" style={{ border: "1px solid var(--app-border)" }}>
                      Pausa a campanha com pior resultado
                    </span>
                  </div>
                </div>
              </div>
            )}

            {view === "nova-campanha" && (
              <>
                <h3 className="mb-1.5 text-xl font-semibold">Nova Campanha</h3>
                <p className="mb-[22px] text-[13px]" style={{ color: "var(--app-muted-fg)" }}>
                  Será criada pausada, pra você revisar antes de ativar.
                </p>
                <div className="mb-6 flex items-center gap-2.5">
                  <span className="flex items-center gap-2 text-[13px]" style={{ color: "var(--app-ok)" }}>
                    <span
                      className="flex h-[22px] w-[22px] items-center justify-center rounded-full text-xs"
                      style={{ background: "var(--app-ok)", color: "var(--app-bg)" }}
                    >
                      ✓
                    </span>
                    Campanha
                  </span>
                  <span className="h-px flex-1" style={{ background: "var(--app-border)" }} />
                  <span className="flex items-center gap-2 text-[13px]">
                    <span
                      className="flex h-[22px] w-[22px] items-center justify-center rounded-full text-xs font-bold"
                      style={{ background: "var(--app-primary)", color: "var(--app-primary-fg)" }}
                    >
                      2
                    </span>
                    Conjunto
                  </span>
                  <span className="h-px flex-1" style={{ background: "var(--app-border)" }} />
                  <span className="flex items-center gap-2 text-[13px]" style={{ color: "var(--app-muted-fg)" }}>
                    <span
                      className="flex h-[22px] w-[22px] items-center justify-center rounded-full text-xs font-bold"
                      style={{ background: "var(--app-border)" }}
                    >
                      3
                    </span>
                    Anúncios
                  </span>
                </div>
                <div className="flex max-w-[420px] flex-col gap-3.5">
                  <div>
                    <p className="mb-1.5 text-xs" style={{ color: "var(--app-muted-fg)" }}>Orçamento diário do conjunto</p>
                    <div className="rounded-lg px-3 py-2.5" style={{ border: "1px solid var(--app-border)", fontFamily: "'DM Mono',monospace" }}>
                      R$ 50,00
                    </div>
                  </div>
                  <div>
                    <p className="mb-1.5 text-xs" style={{ color: "var(--app-muted-fg)" }}>Número que recebe os cliques</p>
                    <div
                      className="rounded-lg px-3 py-2.5"
                      style={{ border: "1px solid var(--app-border)", fontFamily: "'DM Mono',monospace", color: "var(--app-muted-fg)" }}
                    >
                      Selecionar número
                    </div>
                  </div>
                </div>
              </>
            )}

            {view === "diagnostico" && (
              <>
                <h3 className="mb-[18px] text-xl font-semibold">Diagnóstico Meta Ads</h3>
                <div className="flex flex-col gap-2.5">
                  <div className="rounded-xl px-4 py-3.5" style={{ border: "1px solid var(--app-border)" }}>
                    <p className="mb-2 text-[11px] font-semibold uppercase" style={{ color: "var(--app-muted-fg)" }}>Token atual</p>
                    <p className="text-sm">Conectado como <strong>Studio Fit — Admin</strong></p>
                    <p className="mt-1 text-xs" style={{ color: "var(--app-ok)" }}>Expira em 58 dias</p>
                  </div>
                  <div className="rounded-xl px-4 py-3.5" style={{ border: "1px solid var(--app-border)" }}>
                    <p className="mb-2.5 text-[11px] font-semibold uppercase" style={{ color: "var(--app-muted-fg)" }}>Permissões</p>
                    <div className="flex flex-col gap-2">
                      {["ads_read", "ads_management", "business_management"].map((p) => (
                        <div key={p} className="flex items-center justify-between text-[13px]">
                          <span>{p}</span>
                          <span className="text-xs" style={{ color: "var(--app-ok)" }}>✓ concedida</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}

            {view === "configuracoes" && (
              <>
                <h3 className="mb-[18px] text-xl font-semibold">Configurações</h3>
                <div className="mb-[22px] flex flex-wrap gap-5" style={{ borderBottom: "1px solid var(--app-border)" }}>
                  <span className="pb-2.5 text-[13px] font-semibold" style={{ borderBottom: "2px solid var(--app-primary)" }}>Sistema</span>
                  <span className="pb-2.5 text-[13px]" style={{ color: "var(--app-muted-fg)" }}>Token Meta Ads</span>
                  <span className="pb-2.5 text-[13px]" style={{ color: "var(--app-muted-fg)" }}>Conectar WhatsApp</span>
                  <span className="pb-2.5 text-[13px]" style={{ color: "var(--app-muted-fg)" }}>Usuários</span>
                </div>
                <div className="max-w-[420px] rounded-xl" style={{ border: "1px solid var(--app-border)" }}>
                  <div className="flex justify-between px-4 py-3 text-[13px]" style={{ borderBottom: "1px solid var(--app-border)" }}>
                    <span style={{ color: "var(--app-muted-fg)" }}>Versão</span>
                    <span>1.0.22</span>
                  </div>
                  <div className="flex justify-between px-4 py-3 text-[13px]" style={{ borderBottom: "1px solid var(--app-border)" }}>
                    <span style={{ color: "var(--app-muted-fg)" }}>API Meta</span>
                    <span>Graph API v21.0</span>
                  </div>
                  <div className="flex justify-between px-4 py-3 text-[13px]">
                    <span style={{ color: "var(--app-muted-fg)" }}>Sync automático</span>
                    <span>A cada hora</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <p className="mt-3.5 text-center text-xs text-[#8C8B92]">
        Prévia com dados de exemplo — os seus clientes e campanhas de verdade aparecem assim que você conecta sua conta.
      </p>
    </div>
  );
}
