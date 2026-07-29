import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, Users, PlusSquare, Settings, Stethoscope, Wallet, ClipboardList, QrCode, LogOut, Bot, CalendarDays, TrendingUp, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { logout } from "@/server/session";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { fetchCurrentProfile } from "@/lib/queries";

const navItems = [
  { to: "/", label: "Dashboard", shortLabel: "Início", icon: LayoutDashboard, exact: true },
  { to: "/clients", label: "Clientes", shortLabel: "Clientes", icon: Users, exact: false },
  { to: "/saldos", label: "Saldos", shortLabel: "Saldos", icon: Wallet, exact: false },
  { to: "/pix", label: "PIX", shortLabel: "PIX", icon: QrCode, exact: false },
  { to: "/tarefas", label: "Tarefas", shortLabel: "Tarefas", icon: ClipboardList, exact: false },
  { to: "/vendas", label: "Vendas", shortLabel: "Vendas", icon: TrendingUp, exact: false },
  { to: "/agente", label: "Agente IA", shortLabel: "Agente", icon: Bot, exact: false },
  { to: "/campaigns/new", label: "Nova Campanha", shortLabel: "Campanha", icon: PlusSquare, exact: false },
  { to: "/agenda", label: "Agenda", shortLabel: "Agenda", icon: CalendarDays, exact: false },
  { to: "/diagnostico-meta", label: "Diagnóstico", shortLabel: "Diagnóst.", icon: Stethoscope, exact: false },
  { to: "/settings", label: "Configurações", shortLabel: "Config.", icon: Settings, exact: false },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const path = location.pathname;
  const [drawerOpen, setDrawerOpen] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ["current-profile"],
    queryFn: fetchCurrentProfile,
    staleTime: Infinity,
  });

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
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-60 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="px-5 py-5 border-b border-sidebar-border">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center text-primary-foreground font-bold">G</div>
            <div>
              <div className="text-sm font-semibold leading-tight">Gestor de</div>
              <div className="text-sm font-semibold leading-tight">Tráfego</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => {
            const active = isActive(item.to, item.exact);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground truncate">{profile?.full_name ?? "—"}</span>
            <button onClick={handleLogout} className="text-muted-foreground hover:text-foreground transition-colors shrink-0" title="Sair">
              <LogOut className="h-4 w-4" />
            </button>
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
            <nav className="flex-1 overflow-y-auto p-3 space-y-1">
              {navItems.map((item) => {
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
            </nav>

            {/* Rodapé com usuário e logout */}
            <div className="p-4 border-t border-sidebar-border">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{profile?.full_name ?? "—"}</p>
                </div>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  <LogOut className="h-4 w-4" />
                  Sair
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      <main className="md:pl-60 pt-14 md:pt-0">{children}</main>

      {/* Botão flutuante do agente */}
      {!isActive("/agente", false) && (
        <Link
          to="/agente"
          className="fixed bottom-6 right-4 md:right-6 z-40 flex items-center gap-2 bg-primary text-primary-foreground px-3 py-2 md:px-4 rounded-full shadow-lg hover:bg-primary/90 transition-colors text-sm font-medium"
        >
          <Bot className="h-4 w-4" />
          <span className="hidden md:inline">Agente IA</span>
        </Link>
      )}
    </div>
  );
}
