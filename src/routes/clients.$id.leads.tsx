import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { LeadsDashboard } from "@/components/LeadsDashboard";
import { ArrowLeft, Target } from "lucide-react";
import { fetchClientDetail } from "@/lib/queries";

export const Route = createFileRoute("/clients/$id/leads")({
  component: LeadsPage,
});

function LeadsPage() {
  const { id } = Route.useParams();
  const { data: client } = useQuery({ queryKey: ["client-detail", id], queryFn: () => fetchClientDetail(id) });

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
        <div>
          <a href={`/clients/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-2">
            <ArrowLeft className="h-3.5 w-3.5" /> Voltar pro cliente
          </a>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Target className="h-5 w-5 text-muted-foreground" />
            Leads do Meta Ads {client ? `— ${client.name}` : ""}
          </h1>
        </div>
        <LeadsDashboard clientId={id} />
      </div>
    </AppShell>
  );
}
