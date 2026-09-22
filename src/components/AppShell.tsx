import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, Users, PlusSquare, Settings, Stethoscope, Wallet, ClipboardList, QrCode, LogOut, Bot, CalendarDays, TrendingUp, Menu, X, Sun, Moon, MessageCircle, Target, ChevronsLeft, Instagram } from "lucide-react";
import { cn } from "@/lib/utils";
import { logout, getCurrentUser } from "@/server/session";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { fetchCurrentProfile } from "@/lib/queries";
import { useTheme } from "@/components/ThemeProvider";
import { AgentChatWidget } from "@/components/AgentChatWidget";

const navGroups = [
  {
    label: "Visão",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
    ],
  },
  {
    label: "Clientes",
    items: [
      { to: "/clients", label: "Clientes", icon: Users, exact: false },
      { to: "/saldos", label: "Saldos", icon: Wallet, exact: false },
      { to: "/pix", label: "PIX", icon: QrCode, exact: false },
    ],
  },
  {
    label: "Operação",
    items: [
      { to: "/tarefas", label: "Tarefas", icon: ClipboardList, exact: false },
      { to: "/vendas", label: "Vendas", icon: TrendingUp, exact: false },
      { to: "/rastreamento", label: "Rastreamento", icon: Target, exact: false },
      { to: "/agenda", label: "Agenda", icon: CalendarDays, exact: false },
    ],
  },
  {
    label: "Ferramentas",
    items: [
      { to: "/mensagens", label: "Automações", icon: MessageCircle, exact: false },
      { to: "/agente", label: "Agente IA", icon: Bot, exact: false },
      { to: "/campaigns/new", label: "Nova Campanha", icon: PlusSquare, exact: false },
      { to: "/diagnostico-meta", label: "Diagnóstico", icon: Stethoscope, exact: false },
      { to: "/settings", label: "Configurações", icon: Settings, exact: false },
    ],
  },
] as const;

// Só aparece pra platform admin (Triad Company) — ferramenta interna, não é
// recurso multi-tenant. Ver docs/superpowers/specs/2026-09-21-funil-instagram-design.md.
const adminNavGroup = {
  label: "Admin",
  items: [
    { to: "/admin/instagram-funil", label: "Funil Instagram", icon: Instagram, exact: false },
  ],
} as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const path = location.pathname;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [autoCollapsed, setAutoCollapsed] = useState(false);

  // Lê a preferência salva só depois de montar, pra não dar mismatch com o SSR.
  useEffect(() => {
    try {
      if (localStorage.getItem("sidebar-collapsed") === "1") setCollapsed(true);
    } catch { /* ignore */ }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem("sidebar-collapsed", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  // Reseta o auto-colapso sempre que a preferência manual muda, senão um
  // auto-colapso antigo pode ficar "grudado" mesmo depois de reabrir manual.
  useEffect(() => { setAutoCollapsed(false); }, [collapsed]);

  // Menu some sozinho depois de 10s parado (mesmo com o mouse em cima, sem
  // clicar em nada) quando a preferência manual é "aberto"; volta ao passar
  // o mouse de novo (onMouseEnter no <aside> abaixo).
  useEffect(() => {
    if (collapsed || autoCollapsed) return;
    const timer = setTimeout(() => setAutoCollapsed(true), 10000);
    return () => clearTimeout(timer);
  }, [collapsed, autoCollapsed]);

  const effectiveCollapsed = collapsed || autoCollapsed;

  const { data: profile } = useQuery({
    queryKey: ["current-profile"],
    queryFn: fetchCurrentProfile,
    staleTime: Infinity,
  });

  const { data: currentUser } = useQuery({
    queryKey: ["current-user"],
    queryFn: getCurrentUser,
    staleTime: 1000 * 60,
  });
  const visibleNavGroups = currentUser?.isPlatformAdmin ? [...navGroups, adminNavGroup] : navGroups;

  const { theme, toggleTheme } = useTheme();

  const isActive = (to: string, exact: boolean) =>
    exact ? path === to : path === to || path.startsWith(to + "/") || path.startsWith(to);

  const handleLogout = async () => {
    await logout();
    navigate({ to: "/login" });
  };

  // Fecha gaveta ao mudar de rota
  useEffect(() => { setDrawerOpen(false); }, [path]);

  // Trava scroll do body quando gaveta está aberta
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [drawerOpen]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Desktop sidebar ─────────────────────────────── */}
      <aside
        onMouseEnter={() => setAutoCollapsed(false)}
        className={cn(
          "hidden md:flex fixed inset-y-0 left-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 motion-reduce:transition-none",
          effectiveCollapsed ? "w-[68px]" : "w-60"
        )}
      >
        <div className={cn("py-5 border-b border-sidebar-border", effectiveCollapsed ? "px-3" : "px-5")}>
          <div className={cn("flex items-center", effectiveCollapsed ? "flex-col gap-2" : "gap-2")}>
            <div className={cn("flex items-center min-w-0", effectiveCollapsed ? "" : "gap-2 flex-1")}>
              <div className="h-8 w-8 shrink-0 rounded-md bg-gradient-to-br from-primary to-primary-2 shadow-brand flex items-center justify-center text-primary-foreground font-bold">G</div>
              {!effectiveCollapsed && (
                <div className="min-w-0">
                  <div className="text-sm font-semibold leading-tight">Gestor de</div>
                  <div className="text-sm font-semibold leading-tight">Tráfego</div>
                </div>
              )}
            </div>
            <button
              onClick={toggleCollapsed}
              className={cn(
                "shrink-0 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-[background-color,color,transform] duration-200 motion-reduce:transition-none rounded-md p-1",
                effectiveCollapsed && "rotate-180"
              )}
              title={effectiveCollapsed ? "Expandir menu" : "Recolher menu"}
              aria-label={effectiveCollapsed ? "Expandir menu" : "Recolher menu"}
              aria-expanded={!effectiveCollapsed}
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-4 overflow-y-auto overflow-x-hidden">
          {visibleNavGroups.map((group) => (
            <div key={group.label}>
              {!effectiveCollapsed && (
                <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 whitespace-nowrap">
                  {group.label}
                </div>
              )}
              <div className="space-y-1">
                {group.items.map((item) => {
                  const active = isActive(item.to, item.exact);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      title={effectiveCollapsed ? item.label : undefined}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                        effectiveCollapsed && "justify-center px-0",
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                          : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {!effectiveCollapsed && <span className="truncate">{item.label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className={cn("p-3 border-t border-sidebar-border", effectiveCollapsed && "px-2")}>
          <div className={cn("flex items-center gap-2", effectiveCollapsed ? "flex-col" : "justify-between")}>
            {!effectiveCollapsed && <span className="text-xs text-muted-foreground truncate">{profile?.full_name ?? "—"}</span>}
            <div className={cn("flex items-center gap-1 shrink-0", effectiveCollapsed && "flex-col")}>
              <button
                onClick={toggleTheme}
                className="text-muted-foreground hover:text-foreground transition-colors p-1"
                title={theme === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro"}
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
              <button onClick={handleLogout} className="text-muted-foreground hover:text-foreground transition-colors p-1" title="Sair">
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Mobile top header ────────────────────────────── */}
      <header className="md:hidden fixed top-0 inset-x-0 z-40 h-14 bg-sidebar border-b border-sidebar-border flex items-center justify-between px-4">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm">G</div>
          <span className="font-semibold text-sm">Gestor de Tráfego</span>
        </div>
        <button
          onClick={() => setDrawerOpen(true)}
          className="p-2 -mr-2 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Abrir menu"
        >
          <Menu className="h-5 w-5" />
        </button>
      </header>

      {/* ── Mobile drawer ────────────────────────────────── */}
      {drawerOpen && (
        <>
          {/* Backdrop */}
          <div
            className="md:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          {/* Gaveta */}
          <div className="md:hidden fixed inset-y-0 left-0 z-50 w-72 bg-sidebar flex flex-col shadow-2xl">
            {/* Cabeçalho da gaveta */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-sidebar-border">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center text-primary-foreground font-bold">G</div>
                <div>
                  <div className="text-sm font-semibold leading-tight">Gestor de</div>
                  <div className="text-sm font-semibold leading-tight">Tráfego</div>
                </div>
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Fechar menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Itens de navegação */}
            <nav className="flex-1 overflow-y-auto p-3 space-y-4">
              {visibleNavGroups.map((group) => (
                <div key={group.label}>
                  <div className="px-4 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    {group.label}
                  </div>
                  <div className="space-y-1">
                    {group.items.map((item) => {
                      const active = isActive(item.to, item.exact);
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.to}
                          to={item.to}
                          className={cn(
                            "flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-colors",
                            active
                              ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                              : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
                          )}
                        >
                          <Icon className="h-5 w-5 shrink-0" />
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>

            {/* Rodapé com usuário e logout */}
            <div className="p-4 border-t border-sidebar-border">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{profile?.full_name ?? "—"}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={toggleTheme}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title={theme === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro"}
                  >
                    {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  </button>
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <LogOut className="h-4 w-4" />
                    Sair
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      <main className={cn("pt-14 md:pt-0 transition-[padding] duration-200 motion-reduce:transition-none", effectiveCollapsed ? "md:pl-[68px]" : "md:pl-60")}>{children}</main>

      {/* Botão flutuante do agente */}
      {!isActive("/agente", false) && (
        <button
          onClick={() => setAgentOpen((v) => !v)}
          className="fixed bottom-6 right-4 md:right-6 z-40 flex items-center gap-2 bg-primary text-primary-foreground px-3 py-2 md:px-4 rounded-full shadow-lg hover:bg-primary/90 transition-colors text-sm font-medium"
        >
          {agentOpen ? <X className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
          <span className="hidden md:inline">Agente IA</span>
        </button>
      )}

      {agentOpen && !isActive("/agente", false) && <AgentChatWidget onClose={() => setAgentOpen(false)} />}
    </div>
  );
}
