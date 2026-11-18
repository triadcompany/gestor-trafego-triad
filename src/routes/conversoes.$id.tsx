import { createFileRoute, redirect } from "@tanstack/react-router";

// Endereço antigo: Conversões agora é uma aba da página do cliente.
export const Route = createFileRoute("/conversoes/$id")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/clients/$id", params: { id: params.id }, search: { openCampaignId: undefined, aba: "conversoes" }, replace: true });
  },
});
