import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Power } from "lucide-react";
import { mockClients, brl, type Client } from "@/lib/mock-data";

export const Route = createFileRoute("/clients/")({
  head: () => ({
    meta: [{ title: "Clientes — Gestor de Tráfego" }],
  }),
  component: ClientsList,
});

function ClientsList() {
  const [clients, setClients] = useState<Client[]>(mockClients);
  const [editing, setEditing] = useState<Client | null>(null);
  const [open, setOpen] = useState(false);

  const openNew = () => {
    setEditing(null);
    setOpen(true);
  };
  const openEdit = (c: Client) => {
    setEditing(c);
    setOpen(true);
  };
  const toggleActive = (id: string) => {
    setClients((prev) => prev.map((c) => (c.id === id ? { ...c, active: !c.active } : c)));
  };

  return (
    <AppShell>
      <div className="px-4 md:px-8 py-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Clientes</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {clients.length} clientes cadastrados
            </p>
          </div>
          <Button className="gap-2" onClick={openNew}>
            <Plus className="h-4 w-4" />
            Novo Cliente
          </Button>
        </div>

        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Ad Account ID</TableHead>
                <TableHead>Segmento</TableHead>
                <TableHead>Faixa CPL</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    <Link to="/clients/$id" params={{ id: c.id }} className="hover:text-primary">
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {c.adAccountId}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{c.segment}</Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {brl(c.cplMin)} – {brl(c.cplMax)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={c.active ? "default" : "secondary"}>
                      {c.active ? "Ativo" : "Inativo"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(c)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => toggleActive(c.id)}>
                      <Power className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <ClientDialog open={open} onOpenChange={setOpen} client={editing} />
      </div>
    </AppShell>
  );
}

function ClientDialog({
  open,
  onOpenChange,
  client,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  client: Client | null;
}) {
  const [name, setName] = useState(client?.name ?? "");
  const [adId, setAdId] = useState(client?.adAccountId ?? "");
  const [segment, setSegment] = useState<"Popular" | "Premium">(client?.segment ?? "Popular");
  const [cplMin, setCplMin] = useState(client?.cplMin ?? 6);
  const [cplMax, setCplMax] = useState(client?.cplMax ?? 12);

  // Re-init when opening for a different client
  const lastId = client?.id ?? null;
  // simple sync via useEffect
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useState(() => lastId);

  const onSegmentChange = (s: "Popular" | "Premium") => {
    setSegment(s);
    if (s === "Popular") {
      setCplMin(6);
      setCplMax(12);
    } else {
      setCplMin(12);
      setCplMax(25);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{client ? "Editar Cliente" : "Novo Cliente"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Auto Center Silva" />
          </div>
          <div className="space-y-2">
            <Label>Meta Ad Account ID</Label>
            <Input value={adId} onChange={(e) => setAdId(e.target.value)} placeholder="act_..." />
          </div>
          <div className="space-y-2">
            <Label>Segmento</Label>
            <Select value={segment} onValueChange={(v) => onSegmentChange(v as "Popular" | "Premium")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Popular">Popular (R$6–R$12)</SelectItem>
                <SelectItem value="Premium">Premium (R$12–R$25)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>CPL Mín</Label>
              <Input type="number" value={cplMin} onChange={(e) => setCplMin(Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label>CPL Máx</Label>
              <Input type="number" value={cplMax} onChange={(e) => setCplMax(Number(e.target.value))} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => onOpenChange(false)}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Suppress unused import warning for DialogTrigger
void DialogTrigger;
