import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, LogIn, LogOut, Building2 } from "lucide-react";
import { toast } from "sonner";
import { fetchOrganizations, createOrganization, setOrganizationActive } from "@/server/admin";
import { getCurrentUser, enterOrganization, exitOrganization } from "@/server/session";

export const Route = createFileRoute("/admin/organizations")({
  head: () => ({ meta: [{ title: "Organizações — Admin" }] }),
  component: AdminOrganizationsPage,
});

function AdminOrganizationsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [adminFullName, setAdminFullName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  const { data: currentUser } = useQuery({ queryKey: ["current-user"], queryFn: getCurrentUser });
  const { data: orgs = [], isLoading } = useQuery({ queryKey: ["admin-organizations"], queryFn: fetchOrganizations });

  const createMutation = useMutation({
    mutationFn: () =>
      createOrganization({
        name: name.trim(),
        adminFullName: adminFullName.trim(),
        adminEmail: adminEmail.trim(),
        adminPassword,
      }),
    onSuccess: () => {
      toast.success("Organização criada!");
      setOpen(false);
      setName("");
      setAdminFullName("");
      setAdminEmail("");
      setAdminPassword("");
      queryClient.invalidateQueries({ queryKey: ["admin-organizations"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao criar organização"),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => setOrganizationActive(id, active),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-organizations"] }),
  });

  const enterMutation = useMutation({
    mutationFn: (organizationId: string) => enterOrganization({ data: { organizationId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["current-user"] });
      navigate({ to: "/" });
    },
  });

  const exitMutation = useMutation({
    mutationFn: () => exitOrganization(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["current-user"] });
      navigate({ to: "/admin/organizations" });
    },
  });

  return (
    <AppShell>
      <div className="px-4 md:px-8 py-6 max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Organizações</h1>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2">
                <Plus className="h-4 w-4" /> Nova organização
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nova organização</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="space-y-1.5">
                  <Label>Nome da organização</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da agência" />
                </div>
                <div className="space-y-1.5">
                  <Label>Nome do admin</Label>
                  <Input value={adminFullName} onChange={(e) => setAdminFullName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Email do admin</Label>
                  <Input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Senha inicial</Label>
                  <Input type="text" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} placeholder="mín. 8 caracteres" />
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={() => createMutation.mutate()}
                  disabled={!name.trim() || !adminFullName.trim() || !adminEmail.trim() || adminPassword.length < 8 || createMutation.isPending}
                >
                  Criar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {currentUser?.actingOrganizationId && (
          <div className="mb-4 flex items-center justify-between rounded-md border border-status-attention/30 bg-status-attention/10 px-4 py-2.5">
            <p className="text-sm">
              Você está atuando dentro de <strong>{currentUser.actingOrganizationName}</strong> (modo suporte).
            </p>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => exitMutation.mutate()}>
              <LogOut className="h-3.5 w-3.5" /> Sair
            </Button>
          </div>
        )}

        <Card className="divide-y divide-border">
          {isLoading ? (
            <div className="px-5 py-4 text-sm text-muted-foreground">Carregando...</div>
          ) : orgs.length === 0 ? (
            <div className="px-5 py-4 text-sm text-muted-foreground">Nenhuma organização ainda.</div>
          ) : (
            orgs.map((o) => (
              <div key={o.id} className="px-5 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{o.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {o.memberCount} usuário{o.memberCount === 1 ? "" : "s"} · criada em {new Date(o.createdAt).toLocaleDateString("pt-BR")}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={o.active ? "border-status-on-target/40 text-status-on-target" : "border-muted-foreground/30 text-muted-foreground"}
                >
                  {o.active ? "Ativa" : "Inativa"}
                </Badge>
                <Button size="sm" variant="ghost" onClick={() => toggleActiveMutation.mutate({ id: o.id, active: !o.active })}>
                  {o.active ? "Desativar" : "Ativar"}
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => enterMutation.mutate(o.id)}>
                  <LogIn className="h-3.5 w-3.5" /> Entrar
                </Button>
              </div>
            ))
          )}
        </Card>
      </div>
    </AppShell>
  );
}
