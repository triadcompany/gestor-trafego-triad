import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Instagram, Plus, Pencil, Trash2, ExternalLink, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import {
  fetchFunnelRules,
  createFunnelRule,
  updateFunnelRule,
  toggleFunnelRule,
  deleteFunnelRule,
  fetchRecentInstagramPosts,
  fetchFunnelLeads,
  type InstagramPostRow,
  type FunnelRuleRow,
} from "@/server/instagram-funnel";

export const Route = createFileRoute("/admin/instagram-funil")({
  head: () => ({ meta: [{ title: "Funil Instagram — Admin" }] }),
  component: InstagramFunilPage,
});

function InstagramFunilPage() {
  return (
    <AppShell>
      <div className="px-4 md:px-8 py-6 max-w-4xl mx-auto space-y-4">
        <div className="flex items-center gap-2">
          <Instagram className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Funil Instagram</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Comentário com a palavra-chave num post dispara uma resposta privada automática no Direct.{" "}
          <Link to="/admin/instagram-conexao" className="underline underline-offset-2 hover:text-foreground">
            Conexão do Instagram
          </Link>
          .
        </p>

        <Tabs defaultValue="regras">
          <TabsList>
            <TabsTrigger value="regras">Regras</TabsTrigger>
            <TabsTrigger value="leads">Leads</TabsTrigger>
          </TabsList>
          <TabsContent value="regras" className="mt-4">
            <RulesTab />
          </TabsContent>
          <TabsContent value="leads" className="mt-4">
            <LeadsTab />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function RulesTab() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<FunnelRuleRow | null>(null);

  const { data: rules = [], isLoading } = useQuery({ queryKey: ["instagram-funnel-rules"], queryFn: fetchFunnelRules });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => toggleFunnelRule(id, active),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["instagram-funnel-rules"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteFunnelRule(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["instagram-funnel-rules"] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2">
              <Plus className="h-4 w-4" /> Nova regra
            </Button>
          </DialogTrigger>
          <NewRuleDialog onCreated={() => setDialogOpen(false)} />
        </Dialog>
      </div>

      <Dialog open={!!editingRule} onOpenChange={(o) => !o && setEditingRule(null)}>
        {editingRule && <EditRuleDialog rule={editingRule} onSaved={() => setEditingRule(null)} />}
      </Dialog>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
        </div>
      ) : rules.length === 0 ? (
        <div className="text-center py-16 rounded-xl border border-dashed border-border">
          <p className="text-sm text-muted-foreground">Nenhuma regra ainda.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((r) => (
            <Card key={r.id} className="p-3 flex items-center gap-3">
              {r.post_thumbnail_url ? (
                <img src={r.post_thumbnail_url} alt="" className="h-14 w-14 rounded-md object-cover shrink-0" />
              ) : (
                <div className="h-14 w-14 rounded-md bg-muted flex items-center justify-center shrink-0">
                  <Instagram className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="font-mono">{r.keyword}</Badge>
                  {r.public_reply && <Badge variant="outline" className="text-muted-foreground">+ resposta pública</Badge>}
                  {!r.active && <Badge variant="outline" className="text-muted-foreground">Pausada</Badge>}
                  {r.post_permalink && (
                    <a href={r.post_permalink} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                      Ver post <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate mt-1">{r.message}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Switch checked={r.active} onCheckedChange={(v) => toggleMutation.mutate({ id: r.id, active: v })} />
                <Button size="icon" variant="ghost" onClick={() => setEditingRule(r)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => { if (confirm("Excluir essa regra?")) deleteMutation.mutate(r.id); }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function NewRuleDialog({ onCreated }: { onCreated: () => void }) {
  const queryClient = useQueryClient();
  const [selectedPost, setSelectedPost] = useState<InstagramPostRow | null>(null);
  const [keyword, setKeyword] = useState("");
  const [message, setMessage] = useState("");
  const [publicReply, setPublicReply] = useState("");

  const { data: posts = [], isLoading, isError, error } = useQuery({ queryKey: ["instagram-recent-posts"], queryFn: fetchRecentInstagramPosts });

  const createMutation = useMutation({
    mutationFn: () =>
      createFunnelRule({
        post_id: selectedPost!.id,
        post_thumbnail_url: selectedPost!.thumbnail_url,
        post_permalink: selectedPost!.permalink,
        keyword: keyword.trim(),
        message: message.trim(),
        public_reply: publicReply.trim() || null,
      }),
    onSuccess: () => {
      toast.success("Regra criada.");
      queryClient.invalidateQueries({ queryKey: ["instagram-funnel-rules"] });
      onCreated();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao criar regra"),
  });

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>Nova regra</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 py-2">
        <div className="space-y-1.5">
          <Label>Post</Label>
          {isLoading ? (
            <div className="grid grid-cols-4 gap-2">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="aspect-square rounded-md" />)}
            </div>
          ) : isError ? (
            <p className="text-sm text-destructive">
              {error instanceof Error ? error.message : "Erro ao buscar posts."} Confira a{" "}
              <Link to="/admin/instagram-conexao" className="underline underline-offset-2">conexão do Instagram</Link>.
            </p>
          ) : posts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum post encontrado.</p>
          ) : (
            <div className="grid grid-cols-4 gap-2 max-h-64 overflow-y-auto">
              {posts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedPost(p)}
                  className={`aspect-square rounded-md overflow-hidden border-2 transition-colors ${selectedPost?.id === p.id ? "border-primary" : "border-transparent hover:border-border"}`}
                  title={p.caption ?? undefined}
                >
                  {p.thumbnail_url ? (
                    <img src={p.thumbnail_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full bg-muted flex items-center justify-center">
                      <Instagram className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <Label>Palavra-chave</Label>
          <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Ex: QUERO" />
          <p className="text-[11px] text-muted-foreground">Bate se o comentário contiver essa palavra (sem diferenciar maiúsculas).</p>
        </div>
        <div className="space-y-1.5">
          <Label>Mensagem do DM</Label>
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Oi! Vi que você comentou..." className="min-h-[90px]" />
        </div>
        <div className="space-y-1.5">
          <Label>Resposta pública no comentário (opcional)</Label>
          <Input value={publicReply} onChange={(e) => setPublicReply(e.target.value)} placeholder="Ex: Te mandei no Direct!" />
          <p className="text-[11px] text-muted-foreground">
            Responde o comentário publicamente, além do DM. Exige permissão extra no token
            (<code className="text-[11px] bg-muted px-1 py-0.5 rounded">instagram_business_manage_comments</code>) —
            deixe em branco se o token atual não tiver essa permissão.
          </p>
        </div>
      </div>
      <DialogFooter>
        <Button
          onClick={() => createMutation.mutate()}
          disabled={!selectedPost || !keyword.trim() || !message.trim() || createMutation.isPending}
        >
          {createMutation.isPending ? "Criando..." : "Criar regra"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// Edita palavra-chave/mensagens de uma regra existente — o post fica fixo
// (mudar de post é raro o bastante pra não valer a complexidade de reabrir o
// seletor de posts aqui; nesse caso é mais simples excluir e criar de novo).
function EditRuleDialog({ rule, onSaved }: { rule: FunnelRuleRow; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState(rule.keyword);
  const [message, setMessage] = useState(rule.message);
  const [publicReply, setPublicReply] = useState(rule.public_reply ?? "");

  const updateMutation = useMutation({
    mutationFn: () =>
      updateFunnelRule({
        id: rule.id,
        keyword: keyword.trim(),
        message: message.trim(),
        public_reply: publicReply.trim() || null,
      }),
    onSuccess: () => {
      toast.success("Regra atualizada.");
      queryClient.invalidateQueries({ queryKey: ["instagram-funnel-rules"] });
      onSaved();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar regra"),
  });

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>Editar regra</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 py-2">
        <div className="flex items-center gap-3">
          {rule.post_thumbnail_url ? (
            <img src={rule.post_thumbnail_url} alt="" className="h-14 w-14 rounded-md object-cover shrink-0" />
          ) : (
            <div className="h-14 w-14 rounded-md bg-muted flex items-center justify-center shrink-0">
              <Instagram className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
          {rule.post_permalink && (
            <a href={rule.post_permalink} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              Ver post <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        <div className="space-y-1.5">
          <Label>Palavra-chave</Label>
          <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Ex: QUERO" />
          <p className="text-[11px] text-muted-foreground">Bate se o comentário contiver essa palavra (sem diferenciar maiúsculas).</p>
        </div>
        <div className="space-y-1.5">
          <Label>Mensagem do DM</Label>
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Oi! Vi que você comentou..." className="min-h-[90px]" />
        </div>
        <div className="space-y-1.5">
          <Label>Resposta pública no comentário (opcional)</Label>
          <Input value={publicReply} onChange={(e) => setPublicReply(e.target.value)} placeholder="Ex: Te mandei no Direct!" />
        </div>
      </div>
      <DialogFooter>
        <Button
          onClick={() => updateMutation.mutate()}
          disabled={!keyword.trim() || !message.trim() || updateMutation.isPending}
        >
          {updateMutation.isPending ? "Salvando..." : "Salvar"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function LeadsTab() {
  const { data: leads = [], isLoading } = useQuery({ queryKey: ["instagram-funnel-leads"], queryFn: fetchFunnelLeads });

  if (isLoading) {
    return <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  }
  if (leads.length === 0) {
    return (
      <div className="text-center py-16 rounded-xl border border-dashed border-border">
        <MessageCircle className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Nenhum lead capturado ainda.</p>
      </div>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Instagram</TableHead>
              <TableHead>Regra</TableHead>
              <TableHead>Comentário</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(l.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </TableCell>
                <TableCell className="text-sm">
                  {l.ig_username ? `@${l.ig_username}` : l.ig_user_id}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="font-mono">{l.rule_keyword}</Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-[280px] truncate">{l.comment_text}</TableCell>
                <TableCell>
                  {l.status === "sent" ? (
                    <Badge variant="outline" className="border-status-on-target/40 text-status-on-target">Enviado</Badge>
                  ) : (
                    <Badge variant="outline" className="border-destructive/40 text-destructive" title={l.error_message ?? undefined}>Falhou</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
