import { createFileRoute, redirect } from "@tanstack/react-router";

// Endereço antigo: Cobranças PIX agora é uma aba de /financeiro.
export const Route = createFileRoute("/pix")({
  beforeLoad: () => {
    throw redirect({ to: "/financeiro", search: { aba: "pix" }, replace: true });
  },
});
