import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Download, RefreshCw, CheckCircle2, CheckCheck, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { fetchImportCandidates, importAccountsAsClients, type ImportCandidate } from "@/server/import-accounts";
import { searchFacebookPages, fetchWhatsappNumbersForPage, type FacebookPageOption } from "@/server/facebook-directory";

export const Route = createFileRoute("/clients/importar")({
  head: () => ({ meta: [{ title: "Importar contas do Facebook — Clientes" }] }),
  component: ImportClientsPage,
});

interface Row extends ImportCandidate {
  selected: boolean;
  name: string;
  page: string;
  pageStatus: "auto" | "manual" | "missing";
  whatsapp: string;
  whatsappStatus: "auto" | "manual" | "missing";
  imported: boolean;
}

function toRow(c: ImportCandidate): Row {
  return {
    ...c,
    // Pré-marca só quem veio com página E WhatsApp detectados — o resto
    // fica desmarcado de propósito, pra forçar conferência antes de importar.
    selected: c.pageDetected && c.whatsappDetected,
    name: c.suggestedName,
    page: c.pageName ?? "",
    pageStatus: c.pageDetected ? "auto" : "missing",
    whatsapp: c.whatsappNumber ?? "",
    whatsappStatus: c.whatsappDetected ? "auto" : "missing",
    imported: false,
  };
}

function ImportClientsPage() {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [justImportedCount, setJustImportedCount] = useState(0);

  const { refetch, isFetching, data } = useQuery({
    queryKey: ["import-candidates"],
    queryFn: fetchImportCandidates,
    enabled: false,
  });

  const search = async () => {
    setJustImportedCount(0);
    const result = await refetch();
    if (result.data) {
      setRows(result.data.candidates.map(toRow));
      setHasSearched(true);
    }
  };

  const updateRow = (accountId: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.accountId === accountId ? { ...r, ...patch } : r)));
  };

  const importMutation = useMutation({
    mutationFn: (items: Row[]) =>
      importAccountsAsClients(
        items.map((r) => ({ accountId: r.accountId, name: r.name, pageId: r.pageStatus === "missing" ? null : r.pageId, whatsappNumber: r.whatsapp.trim() || null }))
      ),
    onSuccess: (results, items) => {
      const okIds = new Set(results.filter((r) => r.ok).map((r) => r.accountId));
      const failed = results.filter((r) => !r.ok);
      setRows((prev) => prev.map((r) => (okIds.has(r.accountId) ? { ...r, selected: false, imported: true } : r)));
      setJustImportedCount(okIds.size);
      queryClient.invalidateQueries({ queryKey: ["clients-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["clients-all"] });
      if (failed.length > 0) {
        toast.error(`${failed.length} conta(s) não importaram: ${failed.map((f) => f.error).join("; ")}`, { duration: 10000 });
      } else {
        toast.success(`${items.length} cliente${items.length === 1 ? "" : "s"} importado${items.length === 1 ? "" : "s"}!`);
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao importar"),
  });

  const importableRows = rows.filter((r) => !r.imported);
  const selectedRows = importableRows.filter((r) => r.selected);

  return (
    <AppShell>
      <div className="px-4 md:px-8 py-6 max-w-3xl mx-auto pb-28">
        <Link to="/clients" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar pra Clientes
        </Link>

        <div className="flex items-start gap-3 mb-6">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
            <Download className="h-4.5 w-4.5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Importar contas do Facebook</h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-lg">
              Busca as contas de anúncio que esse login gerencia na Meta. Pra cada uma, sugere um cliente novo já com
              página e WhatsApp preenchidos — você só confere e importa.
            </p>
          </div>
        </div>

        {!hasSearched ? (
          <Card className="border-dashed p-12 text-center">
            <Button onClick={search} disabled={isFetching} className="gap-2">
              {isFetching ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {isFetching ? "Buscando contas..." : "Buscar contas no Facebook"}
            </Button>
          </Card>
        ) : (
          <div>
            {justImportedCount > 0 && (
              <div className="flex items-center gap-2 rounded-lg border border-status-on-target/30 bg-status-on-target/10 px-4 py-3 mb-4">
                <CheckCircle2 className="h-4 w-4 text-status-on-target shrink-0" />
                <p className="text-sm text-status-on-target">
                  {justImportedCount} cliente{justImportedCount === 1 ? "" : "s"} importado{justImportedCount === 1 ? "" : "s"} com sucesso. Já{" "}
                  {justImportedCount === 1 ? "aparece" : "aparecem"} na lista de Clientes.
                </p>
              </div>
            )}

            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{data?.totalManaged ?? 0} contas</span> encontradas no Facebook —{" "}
                {rows.length} nova{rows.length === 1 ? "" : "s"}, {data?.alreadyCount ?? 0} já cadastrada{(data?.alreadyCount ?? 0) === 1 ? "" : "s"}
              </p>
              <Button variant="outline" size="sm" onClick={search} disabled={isFetching} className="gap-1.5">
                <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} /> Buscar de novo
              </Button>
            </div>

            {rows.length === 0 ? (
              <Card className="p-6 text-sm text-muted-foreground text-center">
                Nenhuma conta nova encontrada — todas as contas desse login já estão cadastradas.
              </Card>
            ) : (
              <div className="space-y-2.5">
                {importableRows.map((row) => (
                  <ImportRow key={row.accountId} row={row} onChange={(patch) => updateRow(row.accountId, patch)} />
                ))}
                {rows.filter((r) => r.imported).map((row) => (
                  <div key={row.accountId} className="rounded-xl border border-status-on-target/20 bg-status-on-target/5 px-4 py-3 flex items-center gap-3">
                    <CheckCheck className="h-4 w-4 text-status-on-target shrink-0" />
                    <p className="text-sm text-muted-foreground flex-1 truncate">{row.name}</p>
                    <Badge variant="outline" className="border-status-on-target/30 text-status-on-target text-[11px]">importado</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {hasSearched && rows.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-card/95 backdrop-blur px-4 md:px-8 py-3.5 z-10">
          <div className="max-w-3xl mx-auto flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-muted-foreground">
              {selectedRows.length} selecionada{selectedRows.length === 1 ? "" : "s"} pra importar
            </p>
            <Button
              onClick={() => importMutation.mutate(selectedRows)}
              disabled={selectedRows.length === 0 || importMutation.isPending}
              className="gap-2"
            >
              {importMutation.isPending && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
              Importar {selectedRows.length} cliente{selectedRows.length === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function ImportRow({ row, onChange }: { row: Row; onChange: (patch: Partial<Row>) => void }) {
  const initials = row.name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3.5">
        <Checkbox
          checked={row.selected}
          onCheckedChange={(v) => onChange({ selected: v === true })}
          className="mt-3 shrink-0"
          aria-label={`Selecionar ${row.name} pra importar`}
        />
        <div className="h-8.5 w-8.5 rounded-md bg-muted flex items-center justify-center text-[11px] font-bold font-mono shrink-0 mt-0.5">
          {initials}
        </div>
        <div className="flex-1 min-w-0 grid sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2 space-y-1">
            <Label className="text-[10.5px] uppercase tracking-wide text-muted-foreground">Nome do cliente</Label>
            <Input value={row.name} onChange={(e) => onChange({ name: e.target.value })} className="h-8 text-sm" />
            <p className="text-[10.5px] font-mono text-muted-foreground">{row.accountId}</p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-[10.5px] uppercase tracking-wide text-muted-foreground">Página do Facebook</Label>
              <StatusBadge status={row.pageStatus} />
            </div>
            <PagePicker
              accountId={row.accountId}
              pageId={row.pageId}
              pageName={row.page}
              onSelect={(page) =>
                page
                  ? onChange({ page: page.name, pageId: page.id, pageStatus: "manual" })
                  : onChange({ page: "", pageId: null, pageStatus: "missing" })
              }
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-[10.5px] uppercase tracking-wide text-muted-foreground">WhatsApp</Label>
              <StatusBadge status={row.whatsappStatus} />
            </div>
            <WhatsappNumberField
              accountId={row.accountId}
              pageId={row.pageId}
              value={row.whatsapp}
              onChange={(v) => onChange({ whatsapp: v, whatsappStatus: "manual" })}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

// Busca-enquanto-digita nas Páginas da Business Manager dessa conta
// específica — abre a lista já no foco (mesmo sem digitar nada), porque a
// maioria dos clientes só tem 1-2 páginas mesmo.
function PagePicker({
  accountId,
  pageId,
  pageName,
  onSelect,
}: {
  accountId: string;
  pageId: string | null;
  pageName: string;
  onSelect: (page: { id: string; name: string } | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FacebookPageOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = (q: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        setResults(await searchFacebookPages(accountId, q));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  };

  if (pageId) {
    return (
      <div className="h-8 flex items-center gap-1.5 bg-muted/60 rounded-md px-2.5 text-sm">
        <span className="flex-1 truncate">{pageName}</span>
        <button type="button" onClick={() => onSelect(null)}>
          <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Input
        value={query}
        onChange={(e) => { setQuery(e.target.value); runSearch(e.target.value); }}
        onFocus={() => { setOpen(true); if (results.length === 0) runSearch(query); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Buscar página..."
        className="h-8 text-sm"
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full border border-border rounded-md bg-popover shadow-md max-h-48 overflow-y-auto">
          {searching ? (
            <div className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" /> Buscando...
            </div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">Nenhuma página encontrada</div>
          ) : (
            results.map((p) => (
              <button
                key={p.id}
                type="button"
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted truncate"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onSelect(p); setOpen(false); }}
              >
                {p.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// Junta números da Business Manager (precisa whatsapp_business_management)
// com números já usados em anúncios dessa página específica (não precisa de
// permissão nenhuma extra) e o telefone de contato da própria Página — se
// nada disso achar nada, cai pro campo de texto livre.
function WhatsappNumberField({
  accountId,
  pageId,
  value,
  onChange,
}: {
  accountId: string;
  pageId: string | null;
  value: string;
  onChange: (v: string) => void;
}) {
  const { data: numbers = [], isLoading, isFetched } = useQuery({
    queryKey: ["fb-whatsapp-numbers", accountId, pageId],
    queryFn: () => fetchWhatsappNumbersForPage(accountId, pageId!),
    enabled: !!pageId,
  });

  if (pageId && (isLoading || numbers.length > 0)) {
    const knownValue = numbers.some((n) => n.number === value) ? value : undefined;
    return (
      <Select value={knownValue} onValueChange={onChange} disabled={isLoading}>
        <SelectTrigger className="h-8 text-sm">
          <SelectValue placeholder={isLoading ? "Carregando números..." : "Selecionar número"} />
        </SelectTrigger>
        <SelectContent>
          {numbers.map((n) => (
            <SelectItem key={n.id} value={n.number}>{n.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={pageId && isFetched ? "Nenhum número encontrado — digite manualmente" : "Nenhuma campanha ativa encontrada"}
      className="h-8 text-sm"
    />
  );
}

function StatusBadge({ status }: { status: "auto" | "manual" | "missing" }) {
  if (status === "auto") {
    return <Badge variant="outline" className="border-status-on-target/30 text-status-on-target text-[10px] px-1.5 py-0 font-normal">detectado</Badge>;
  }
  if (status === "missing") {
    return <Badge variant="outline" className="border-status-attention/30 text-status-attention text-[10px] px-1.5 py-0 font-normal">confirme</Badge>;
  }
  return null;
}
