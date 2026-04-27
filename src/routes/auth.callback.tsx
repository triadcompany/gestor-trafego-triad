import { createFileRoute, useNavigate } from "@tanstack/react-router";

// Rota não utilizada — auth via token manual na página /login
export const Route = createFileRoute("/auth/callback")({
  component: () => {
    const navigate = useNavigate();
    navigate({ to: "/login" });
    return null;
  },
});
