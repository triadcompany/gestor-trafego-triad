import { createFileRoute, redirect } from "@tanstack/react-router";

// Endereço antigo: Saldos agora é uma aba de /financeiro.
export const Route = createFileRoute("/saldos")({
  beforeLoad: () => {
    throw redirect({ to: "/financeiro", search: { aba: "saldos" }, replace: true });
  },
});
