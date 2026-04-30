import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, Users, PlusSquare, Settings, Stethoscope, Wallet, ClipboardList, QrCode, LogOut, Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useQuery } from "@tanstack/react-query";
import { fetchCurrentProfile } from "@/lib/queries";

const navItems = [
  { to: "/", label: "Dashboard", shortLabel: "Início", icon: LayoutDashboard, exact: true },
  { to: "/clients", label: "Clientes", shortLabel: "Clientes", icon: Users, exact: false },
  { to: "/saldos", label: "Saldos", shortLabel: "Saldos", icon: Wallet, exact: false },
  { to: "/pix", label: "PIX", shortLabel: "PIX", icon: QrCode, exact: false },
  { to: "/tarefas", label: "Tarefas", shortLabel: "Tarefas", icon: ClipboardList, exact: false },
  { to: "/agente", label: "Agente IA", shortLabel: "Agente", icon: Bot, exact: false },
  { to: "/campaigns/new", label: "Nova Campanha", shortLabel: "Campanha", icon: PlusSquare, exact: false },
  { to: "/diagnostico-meta", label: "Diagnóstico", shortLabel: "Diagnóst.", icon: Stethoscope, exact: false },
  { to: "/settings", label: "Configurações", shortLabel: "Config.", icon: Settings, exact: false },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const path = location.pathname;

  const { data: profile } = useQuery({
    queryKey: ["current-profile"],
    queryFn: fetchCurrentProfile,
    staleTime: Infinity,
  });

  const isActive = (to: string, exact: boolean) =>
    exact ? path === to : path === to || path.startsWith(to + "/") || path.startsWith(to);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-60 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="px-5 py-5 border-b border-sidebar-border">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center text-primary-foreground font-bold">
              G
            </div>
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
            <span className="text-xs text-muted-foreground truncate">
              {profile?.full_name ?? "—"}
            </span>
            <button
              onClick={handleLogout}
              className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
              title="Sair"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <main className="md:pl-60 pb-20 md:pb-0">{children}</main>

      {/* Botão flutuante do agente (visível em todas as páginas exceto /agente) */}
      {!isActive("/agente", false) && (
        <Link
          to="/agente"
          className="fixed bottom-24 right-4 md:bottom-6 md:right-6 z-50 flex items-center gap-2 bg-primary text-primary-foreground px-3 py-2 md:px-4 rounded-full shadow-lg hover:bg-primary/90 transition-colors text-sm font-medium"
        >
          <Bot className="h-4 w-4" />
          <span className="hidden md:inline">Agente IA</span>
        </Link>
      )}

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-sidebar border-t border-sidebar-border flex">
        {navItems.map((item) => {
          const active = isActive(item.to, item.exact);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex-1 flex flex-col items-center gap-1 py-2.5 text-[10px] leading-tight",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              <Icon className="h-5 w-5" />
              {item.shortLabel}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
