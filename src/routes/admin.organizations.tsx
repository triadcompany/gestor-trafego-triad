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
import { Plus, LogIn, LogOut, Building2, DollarSign, CheckCircle2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { fetchOrganizations, createOrganization, setOrganizationActive, setOrganizationMonthlyValue, deleteOrganization, type OrganizationRow } from "@/server/admin";
import { getCurrentUser, enterOrganization, exitOrganization } from "@/server/session";

export const Route = createFileRoute("/admin/organizations")({
  head: () => ({ meta: [{ title: "Organizações — Admin" }] }),
  component: AdminOrganizationsPage,
});

function brl(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function AdminOrganizationsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [deletingOrg, setDeletingOrg] = useState<OrganizationRow | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
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

  const monthlyValueMutation = useMutation({
    mutationFn: ({ id, monthlyValue }: { id: string; monthlyValue: number }) => setOrganizationMonthlyValue(id, monthlyValue),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-organizations"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar valor"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteOrganization(id),
    onSuccess: () => {
      toast.success("Organização excluída.");
      setDeletingOrg(null);
      setDeleteConfirmText("");
      queryClient.invalidateQueries({ queryKey: ["admin-organizations"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao excluir organização"),
  });

  const activeOrgs = orgs.filter((o) => o.active);
  const mrr = activeOrgs.reduce((sum, o) => sum + o.monthlyValue, 0);

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

        {!isLoading && orgs.length > 0 && (
          <div className="grid grid-cols-2 gap-3 mb-4">
            <Card className="p-4 flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-status-on-target/10 flex items-center justify-center shrink-0">
                <CheckCircle2 className="h-4.5 w-4.5 text-status-on-target" />
              </div>
              <div>
                <p className="text-xl font-semibold tracking-tight leading-none">{activeOrgs.length}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  organiza{activeOrgs.length === 1 ? "ção ativa" : "ções ativas"} de {orgs.length}
                </p>
              </div>
            </Card>
            <Card className="p-4 flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <DollarSign className="h-4.5 w-4.5 text-primary" />
              </div>
              <div>
                <p className="text-xl font-semibold tracking-tight leading-none">{brl(mrr)}</p>
                <p className="text-xs text-muted-foreground mt-1">MRR (organizações ativas)</p>
              </div>
            </Card>
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
                <MonthlyValueInput
                  value={o.monthlyValue}
                  onSave={(v) => monthlyValueMutation.mutate({ id: o.id, monthlyValue: v })}
                />
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
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => { setDeletingOrg(o); setDeleteConfirmText(""); }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </Card>
      </div>

      <Dialog open={!!deletingOrg} onOpenChange={(v) => !v && setDeletingOrg(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir organização</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Isso apaga <strong>{deletingOrg?.name}</strong> e tudo que pertence a ela — clientes, campanhas
              salvas, vendas, automações, instâncias de WhatsApp. Não pode ser desfeito.
            </p>
            <div className="space-y-1.5">
              <Label>
                Digite <strong>{deletingOrg?.name}</strong> pra confirmar
              </Label>
              <Input value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)} autoFocus />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingOrg(null)} disabled={deleteMutation.isPending}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={deleteConfirmText !== deletingOrg?.name || deleteMutation.isPending}
              onClick={() => deletingOrg && deleteMutation.mutate(deletingOrg.id)}
            >
              {deleteMutation.isPending ? "Excluindo..." : "Excluir organização"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

// Valor mensal da organização — clique pra editar, salva ao sair do campo ou
// apertar Enter. Mostra formatado (R$) em repouso, input numérico ao editar.
function MonthlyValueInput({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  const commit = () => {
    setEditing(false);
    const parsed = Number(draft.replace(",", "."));
    if (!isNaN(parsed) && parsed >= 0 && parsed !== value) onSave(parsed);
    else setDraft(String(value));
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setDraft(String(value)); setEditing(true); }}
        className="text-sm font-mono text-muted-foreground hover:text-foreground hover:underline underline-offset-2 shrink-0 w-24 text-right"
        title="Clique pra editar a mensalidade"
      >
        {brl(value)}
      </button>
    );
  }

  return (
    <Input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setDraft(String(value)); setEditing(false); } }}
      className="h-8 w-24 text-right font-mono text-sm shrink-0"
      inputMode="decimal"
    />
  );
}
