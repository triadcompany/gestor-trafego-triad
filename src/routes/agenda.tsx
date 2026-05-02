import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useState } from "react";
import { Calendar, dateFnsLocalizer, View, Views } from "react-big-calendar";
import { format, parse, startOfWeek, getDay } from "date-fns";
import ptBR from "date-fns/locale/pt-BR";
import "react-big-calendar/lib/css/react-big-calendar.css";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { CalendarDays, Users } from "lucide-react";

const locales = {
  "pt-BR": ptBR,
};

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }), // Segunda-feira
  getDay,
  locales,
});

export const Route = createFileRoute("/agenda")({
  head: () => ({
    meta: [{ title: "Agenda — Gestor de Tráfego" }],
  }),
  component: AgendaPage,
});

// Mock data para visualização inicial (Frontend-only)
const mockEvents = [
  {
    id: 1,
    title: "Reunião de Alinhamento",
    start: new Date(new Date().setHours(10, 0, 0, 0)),
    end: new Date(new Date().setHours(11, 0, 0, 0)),
    user: "Thiago",
    color: "#3b82f6", // blue
  },
  {
    id: 2,
    title: "Review de Campanhas",
    start: new Date(new Date().setHours(14, 0, 0, 0)),
    end: new Date(new Date().setHours(15, 30, 0, 0)),
    user: "João",
    color: "#10b981", // green
  },
  {
    id: 3,
    title: "Onboarding Novo Cliente",
    start: new Date(new Date().setDate(new Date().getDate() + 1)),
    end: new Date(new Date().setDate(new Date().getDate() + 1)),
    user: "Thiago",
    color: "#3b82f6",
  },
];

const teamMembers = [
  { id: "1", name: "Thiago", color: "#3b82f6" },
  { id: "2", name: "João", color: "#10b981" },
  { id: "3", name: "Maria", color: "#f59e0b" },
];

function AgendaPage() {
  const [selectedUsers, setSelectedUsers] = useState<string[]>(["Thiago", "João"]);
  const [view, setView] = useState<View>(Views.WEEK);
  const [date, setDate] = useState(new Date());

  const filteredEvents = mockEvents.filter((event) => selectedUsers.includes(event.user));

  const toggleUser = (name: string) => {
    setSelectedUsers((prev) =>
      prev.includes(name) ? prev.filter((u) => u !== name) : [...prev, name]
    );
  };

  return (
    <AppShell>
      <div className="flex h-[calc(100vh-60px)] md:h-screen bg-background overflow-hidden pt-4 md:pt-0">
        {/* Sidebar com Membros */}
        <div className="w-64 border-r border-border bg-muted/20 flex-col hidden lg:flex">
          <div className="p-5 border-b border-border">
            <h2 className="font-semibold flex items-center gap-2">
              <Users className="w-4 h-4 text-muted-foreground" />
              Equipe
            </h2>
          </div>
          <div className="p-5 space-y-4">
            {teamMembers.map((member) => (
              <div key={member.id} className="flex items-center space-x-3">
                <Checkbox
                  id={`user-${member.id}`}
                  checked={selectedUsers.includes(member.name)}
                  onCheckedChange={() => toggleUser(member.name)}
                />
                <label
                  htmlFor={`user-${member.id}`}
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex items-center gap-2 cursor-pointer select-none"
                >
                  <div
                    className="w-3 h-3 rounded-full shadow-sm"
                    style={{ backgroundColor: member.color }}
                  />
                  {member.name}
                </label>
              </div>
            ))}
          </div>
        </div>

        {/* Conteúdo Principal do Calendário */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="p-4 md:p-6 flex-1 flex flex-col h-full">
            <div className="mb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <CalendarDays className="w-6 h-6 text-muted-foreground" />
                <h1 className="text-2xl font-semibold tracking-tight">Agenda Unificada</h1>
              </div>
            </div>

            <Card className="flex-1 p-2 md:p-4 shadow-sm border-border flex flex-col min-h-[500px] overflow-hidden bg-card">
              <style dangerouslySetInnerHTML={{__html: `
                .rbc-calendar { font-family: inherit; }
                .rbc-header { padding: 8px 0; font-weight: 600; font-size: 13px; text-transform: uppercase; color: hsl(var(--muted-foreground)); border-bottom: 1px solid hsl(var(--border)); }
                .rbc-time-header-content { border-left: 1px solid hsl(var(--border)); }
                .rbc-time-view, .rbc-month-view { border: 1px solid hsl(var(--border)); border-radius: 8px; overflow: hidden; }
                .rbc-day-bg + .rbc-day-bg { border-left: 1px solid hsl(var(--border)); }
                .rbc-timeslot-group { border-bottom: 1px solid hsl(var(--border)); }
                .rbc-time-content { border-top: 1px solid hsl(var(--border)); }
                .rbc-today { background-color: hsl(var(--muted)/0.3); }
                .rbc-event { padding: 2px 5px; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
                .rbc-toolbar button { color: hsl(var(--foreground)); border-color: hsl(var(--border)); border-radius: 6px; }
                .rbc-toolbar button:active, .rbc-toolbar button.rbc-active { background-color: hsl(var(--muted)); box-shadow: none; }
                .rbc-toolbar button:hover { background-color: hsl(var(--muted)/0.5); }
              `}} />
              <Calendar
                localizer={localizer}
                events={filteredEvents}
                startAccessor="start"
                endAccessor="end"
                view={view}
                onView={setView}
                date={date}
                onNavigate={setDate}
                culture="pt-BR"
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
                  noEventsInRange: "Nenhum evento neste período.",
                  showMore: (total) => `+ ${total} mais`,
                }}
                eventPropGetter={(event) => ({
                  style: {
                    backgroundColor: event.color,
                    borderColor: 'rgba(0,0,0,0.1)',
                    borderWidth: '1px',
                    borderStyle: 'solid',
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
      </div>
    </AppShell>
  );
}
