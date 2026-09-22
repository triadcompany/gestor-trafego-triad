import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeft, Zap, MessageSquare, GitBranch, Plus, X, Save } from "lucide-react";
import { toast } from "sonner";
import { fetchFunnelGraph, saveFunnelGraph, fetchFunnels } from "@/server/instagram-funnel";

export const Route = createFileRoute("/admin/instagram-funil-editor/$funnelId")({
  head: () => ({ meta: [{ title: "Editor de Funil — Admin" }] }),
  component: FunnelEditorPage,
});

interface MessageData extends Record<string, unknown> {
  message: string;
}
interface ConditionData extends Record<string, unknown> {
  keywords: { id: string; keyword: string }[];
}

function TriggerNodeCard() {
  return (
    <div className="rounded-xl border-2 border-amber-500/60 bg-amber-500/10 px-4 py-3 min-w-[180px] shadow-sm">
      <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-semibold text-[10px] uppercase tracking-wide">
        <Zap className="h-3.5 w-3.5" /> Gatilho
      </div>
      <p className="text-sm font-medium mt-1">Lead capturado</p>
      <Handle type="source" position={Position.Right} className="!bg-amber-500 !w-3 !h-3" />
    </div>
  );
}

function MessageNodeCard({ data }: NodeProps<Node<MessageData>>) {
  return (
    <div className="rounded-xl border-2 border-border bg-card px-4 py-3 min-w-[200px] max-w-[240px] shadow-sm">
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground !w-3 !h-3" />
      <div className="flex items-center gap-1.5 text-muted-foreground font-semibold text-[10px] uppercase tracking-wide">
        <MessageSquare className="h-3.5 w-3.5" /> Enviar mensagem
      </div>
      <p className="text-sm mt-1 line-clamp-3 whitespace-pre-wrap">{data.message || "Clique 2x pra escrever a mensagem..."}</p>
      <Handle type="source" position={Position.Right} className="!bg-primary !w-3 !h-3" />
    </div>
  );
}

function ConditionNodeCard({ data }: NodeProps<Node<ConditionData>>) {
  const rows = [...data.keywords, { id: "default", keyword: "Nenhuma bateu" }];
  return (
    <div className="rounded-xl border-2 border-sky-500/60 bg-sky-500/10 px-4 py-3 min-w-[220px] shadow-sm">
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground !w-3 !h-3" />
      <div className="flex items-center gap-1.5 text-sky-600 dark:text-sky-400 font-semibold text-[10px] uppercase tracking-wide">
        <GitBranch className="h-3.5 w-3.5" /> Condição
      </div>
      <div className="mt-2 space-y-1.5">
        {rows.map((r) => (
          <div key={r.id} className="relative flex items-center bg-background/70 rounded px-2 py-1 pr-4">
            <span className={`text-xs truncate ${r.id === "default" ? "text-muted-foreground italic" : "font-mono"}`}>{r.keyword}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={r.id}
              style={{ position: "absolute", right: -18, top: "50%", transform: "translateY(-50%)" }}
              className="!bg-sky-500 !w-3 !h-3"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

const nodeTypes = { trigger: TriggerNodeCard, message: MessageNodeCard, condition: ConditionNodeCard };

function FunnelEditorPage() {
  const { funnelId } = useParams({ from: "/admin/instagram-funil-editor/$funnelId" });
  const queryClient = useQueryClient();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loaded, setLoaded] = useState(false);
  const [editingNode, setEditingNode] = useState<Node | null>(null);

  const { data: funnels = [] } = useQuery({ queryKey: ["instagram-funnels"], queryFn: fetchFunnels });
  const funnelName = funnels.find((f) => f.id === funnelId)?.name ?? "Funil";

  const { data: graph } = useQuery({ queryKey: ["instagram-funnel-graph", funnelId], queryFn: () => fetchFunnelGraph(funnelId) });

  useEffect(() => {
    if (!graph || loaded) return;
    setNodes(
      graph.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: { x: n.position_x, y: n.position_y },
        deletable: n.type !== "trigger",
        data: n.type === "message" ? { message: n.message ?? "" } : n.type === "condition" ? { keywords: n.condition_keywords } : {},
      }))
    );
    setEdges(graph.edges.map((e) => ({ id: e.id, source: e.source_node_id, sourceHandle: e.source_handle, target: e.target_node_id })));
    setLoaded(true);
  }, [graph, loaded, setNodes, setEdges]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge(connection, eds.filter((e) => !(e.source === connection.source && e.sourceHandle === connection.sourceHandle))));
    },
    [setEdges]
  );

  const addNode = (type: "message" | "condition") => {
    const id = crypto.randomUUID();
    const offset = nodes.length * 40;
    setNodes((nds) => [
      ...nds,
      {
        id,
        type,
        position: { x: 380 + offset, y: 120 + offset },
        deletable: true,
        data: type === "message" ? { message: "" } : { keywords: [] },
      },
    ]);
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      saveFunnelGraph(
        funnelId,
        nodes.map((n) => ({
          id: n.id,
          type: n.type as "trigger" | "message" | "condition",
          position_x: n.position.x,
          position_y: n.position.y,
          message: n.type === "message" ? ((n.data as MessageData).message ?? null) : null,
          condition_keywords: n.type === "condition" ? (n.data as ConditionData).keywords : [],
        })),
        edges.map((e) => ({ source_node_id: e.source, source_handle: e.sourceHandle ?? null, target_node_id: e.target }))
      ),
    onSuccess: () => {
      toast.success("Funil salvo.");
      queryClient.invalidateQueries({ queryKey: ["instagram-funnel-graph", funnelId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar funil"),
  });

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
        <Link to="/admin/instagram-funil" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-base font-semibold flex-1 min-w-0 truncate">{funnelName}</h1>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => addNode("message")}>
          <Plus className="h-3.5 w-3.5" /> Mensagem
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => addNode("condition")}>
          <Plus className="h-3.5 w-3.5" /> Condição
        </Button>
        <Button size="sm" className="gap-1.5" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          <Save className="h-3.5 w-3.5" /> {saveMutation.isPending ? "Salvando..." : "Salvar"}
        </Button>
      </header>

      <div className="flex-1 min-h-0">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDoubleClick={(_, node) => { if (node.type !== "trigger") setEditingNode(node); }}
          nodeTypes={nodeTypes}
          fitView
          colorMode="system"
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>

      <Dialog open={!!editingNode} onOpenChange={(o) => !o && setEditingNode(null)}>
        {editingNode?.type === "message" && (
          <MessageNodeEditor
            data={editingNode.data as MessageData}
            onSave={(message) => {
              setNodes((nds) => nds.map((n) => (n.id === editingNode.id ? { ...n, data: { ...n.data, message } } : n)));
              setEditingNode(null);
            }}
          />
        )}
        {editingNode?.type === "condition" && (
          <ConditionNodeEditor
            data={editingNode.data as ConditionData}
            onSave={(keywords) => {
              setNodes((nds) => nds.map((n) => (n.id === editingNode.id ? { ...n, data: { ...n.data, keywords } } : n)));
              setEditingNode(null);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

function MessageNodeEditor({ data, onSave }: { data: MessageData; onSave: (message: string) => void }) {
  const [message, setMessage] = useState(data.message);
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Enviar mensagem</DialogTitle>
      </DialogHeader>
      <div className="py-2 space-y-1.5">
        <Label>Texto do DM</Label>
        <Textarea value={message} onChange={(e) => setMessage(e.target.value)} className="min-h-[100px]" autoFocus />
      </div>
      <DialogFooter>
        <Button onClick={() => onSave(message)}>Salvar bloco</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function ConditionNodeEditor({ data, onSave }: { data: ConditionData; onSave: (keywords: { id: string; keyword: string }[]) => void }) {
  const [keywords, setKeywords] = useState(data.keywords);

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Condição</DialogTitle>
      </DialogHeader>
      <div className="py-2 space-y-2">
        <Label>Palavras-chave (cada uma vira uma saída no bloco)</Label>
        {keywords.map((k, i) => (
          <div key={k.id} className="flex items-center gap-2">
            <Input
              value={k.keyword}
              onChange={(e) => setKeywords((ks) => ks.map((kk, ii) => (ii === i ? { ...kk, keyword: e.target.value } : kk)))}
              placeholder="Ex: sim"
            />
            <Button size="icon" variant="ghost" className="shrink-0 text-destructive hover:text-destructive" onClick={() => setKeywords((ks) => ks.filter((_, ii) => ii !== i))}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => setKeywords((ks) => [...ks, { id: crypto.randomUUID(), keyword: "" }])}
        >
          <Plus className="h-3.5 w-3.5" /> Adicionar palavra-chave
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Sempre tem também uma saída fixa "Nenhuma bateu", pra quando a resposta não bater com nenhuma acima.
        </p>
      </div>
      <DialogFooter>
        <Button onClick={() => onSave(keywords.filter((k) => k.keyword.trim()))}>Salvar bloco</Button>
      </DialogFooter>
    </DialogContent>
  );
}
