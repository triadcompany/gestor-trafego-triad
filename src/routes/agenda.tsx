import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Calendar, dateFnsLocalizer, View, Views } from "react-big-calendar";
import { format, parse, startOfWeek, getDay, startOfMonth, endOfMonth, startOfWeek as startOfW, endOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale/pt-BR";
import "react-big-calendar/lib/css/react-big-calendar.css";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalendarDays, Link2, Link2Off, Loader2 } from "lucide-react";
import {
  getGoogleAuthUrl,
  isGoogleCalendarConnected,
  disconnectGoogleCalendar,
  fetchCalendarEvents,
} from "@/lib/google-calendar";

const locales = { "pt-BR": ptBR };

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales,
});

export const Route = createFileRoute("/agenda")({
  head: () => ({
    meta: [{ title: "Agenda — Gestor de Tráfego" }],
  }),
  component: AgendaPage,
});

function getVisibleRange(date: Date, view: View): { min: Date; max: Date } {
  if (view === Views.MONTH) {
    const start = startOfW(startOfMonth(date), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(date), { weekStartsOn: 1 });
    return { min: start, max: end };
  }
  if (view === Views.WEEK) {
    return {
      min: startOfWeek(date, { weekStartsOn: 1 }),
      max: endOfWeek(date, { weekStartsOn: 1 }),
    };
  }
  // day / agenda
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { min: start, max: end };
}

function AgendaPage() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>(Views.WEEK);
  const [date, setDate] = useState(new Date());

  const { min, max } = getVisibleRange(date, view);

  const { data: connected, isLoading: checkingConnection } = useQuery({
    queryKey: ["google-calendar-connected"],
    queryFn: isGoogleCalendarConnected,
  });

  const { data: events = [], isLoading: loadingEvents } = useQuery({
    queryKey: ["google-calendar-events", min.toISOString(), max.toISOString()],
    queryFn: () => fetchCalendarEvents(min, max),
    enabled: !!connected,
  });

  const disconnectMutation = useMutation({
    mutationFn: disconnectGoogleCalendar,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["google-calendar-connected"] });
      queryClient.invalidateQueries({ queryKey: ["google-calendar-events"] });
    },
  });

  const handleConnect = () => {
    window.location.href = getGoogleAuthUrl();
  };

  return (
    <AppShell>
      <div className="flex flex-col h-[calc(100vh-60px)] md:h-screen bg-background overflow-hidden">
        {/* Header */}
        <div className="px-4 md:px-6 py-4 border-b border-border flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-muted-foreground" />
            <h1 className="text-xl font-semibold tracking-tight">Agenda</h1>
          </div>

          <div className="flex items-center gap-2">
            {checkingConnection ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : connected ? (
              <>
                <span className="text-xs text-green-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                  Google Agenda conectado
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 h-8 text-xs"
                  onClick={() => disconnectMutation.mutate()}
                  disabled={disconnectMutation.isPending}
                >
                  <Link2Off className="h-3.5 w-3.5" />
                  Desconectar
                </Button>
              </>
            ) : (
              <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={handleConnect}>
                <Link2 className="h-3.5 w-3.5" />
                Conectar Google Agenda
              </Button>
            )}
          </div>
        </div>

        {/* Banner quando não conectado */}
        {!checkingConnection && !connected && (
          <div className="mx-4 md:mx-6 mt-4 rounded-lg border border-border bg-muted/30 px-4 py-3 flex items-center justify-between gap-4 shrink-0">
            <p className="text-sm text-muted-foreground">
              Conecte seu Google Agenda para visualizar seus eventos aqui.
            </p>
            <Button size="sm" onClick={handleConnect} className="gap-1.5 shrink-0">
              <Link2 className="h-3.5 w-3.5" />
              Conectar
            </Button>
          </div>
        )}

        {/* Calendário */}
        <div className="flex-1 p-4 md:p-6 overflow-hidden flex flex-col min-h-0">
          <Card className="flex-1 p-2 md:p-4 border-border flex flex-col overflow-hidden bg-card relative min-h-0">
            {loadingEvents && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/60 z-10 rounded-lg">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            <style dangerouslySetInnerHTML={{__html: `
              .rbc-calendar { font-family: inherit; height: 100%; }
              .rbc-header { padding: 8px 0; font-weight: 600; font-size: 13px; text-transform: uppercase; color: hsl(var(--muted-foreground)); border-bottom: 1px solid hsl(var(--border)); }
              .rbc-time-header-content { border-left: 1px solid hsl(var(--border)); }
              .rbc-time-view, .rbc-month-view { border: 1px solid hsl(var(--border)); border-radius: 8px; overflow: hidden; flex: 1; }
              .rbc-day-bg + .rbc-day-bg { border-left: 1px solid hsl(var(--border)); }
              .rbc-timeslot-group { border-bottom: 1px solid hsl(var(--border)); }
              .rbc-time-content { border-top: 1px solid hsl(var(--border)); overflow-y: auto; }
              .rbc-today { background-color: hsl(var(--muted)/0.3); }
              .rbc-event { padding: 2px 5px; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
              .rbc-toolbar button { color: hsl(var(--foreground)); border-color: hsl(var(--border)); border-radius: 6px; }
              .rbc-toolbar button:active, .rbc-toolbar button.rbc-active { background-color: hsl(var(--muted)); box-shadow: none; }
              .rbc-toolbar button:hover { background-color: hsl(var(--muted)/0.5); }
              .rbc-off-range-bg { background-color: hsl(var(--muted)/0.15); }
              .rbc-show-more { color: hsl(var(--primary)); font-size: 12px; }
            `}} />
            <Calendar
              localizer={localizer}
              events={events}
              startAccessor="start"
              endAccessor="end"
              view={view}
              onView={setView}
              date={date}
              onNavigate={setDate}
              culture="pt-BR"
              style={{ flex: 1, minHeight: 0 }}
              messages={{
                next: "Próximo",
                previous: "Anterior",
                today: "Hoje",
                month: "Mês",
                week: "Semana",
                day: "Dia",
                agenda: "Lista",
                date: "Data",
                time: "Hora",
                event: "Evento",
                noEventsInRange: connected ? "Nenhum evento neste período." : "Conecte o Google Agenda para ver seus eventos.",
                showMore: (total) => `+ ${total} mais`,
              }}
              eventPropGetter={(event) => ({
                style: {
                  backgroundColor: event.color,
                  borderColor: "rgba(0,0,0,0.1)",
                  borderWidth: "1px",
                  borderStyle: "solid",
                  color: "white",
                  borderRadius: "6px",
                  opacity: 0.95,
                  fontSize: "12px",
                  fontWeight: 500,
                },
              })}
            />
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
