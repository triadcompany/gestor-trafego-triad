import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowDown, ArrowUp, Check, CheckCircle2, ExternalLink, GraduationCap, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { fetchCourse, saveCourse, setLessonDone, type CourseData, type CourseLesson, type CourseModule } from "@/server/course";
import { parseVideoUrl } from "@/lib/video-embed";

export const Route = createFileRoute("/aulas")({
  head: () => ({ meta: [{ title: "Aulas — Gestor de Tráfego" }] }),
  component: AulasPage,
});

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function AulasPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["course"], queryFn: fetchCourse, staleTime: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CourseData | null>(null);

  const course = editing && draft ? draft : data?.course ?? { modules: [] };
  const completed = useMemo(() => new Set(data?.completed ?? []), [data]);
  const flat = useMemo(() => course.modules.flatMap((m) => m.lessons.map((l) => ({ ...l, moduleTitle: m.title }))), [course]);
  const selected = flat.find((l) => l.id === selectedId) ?? flat[0] ?? null;
  const total = flat.length;
  const doneCount = flat.filter((l) => completed.has(l.id)).length;

  useEffect(() => {
    if (!selectedId && flat[0]) setSelectedId(flat[0].id);
  }, [flat, selectedId]);

  const doneMutation = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => setLessonDone(id, done),
    onSuccess: (list) => qc.setQueryData(["course"], (old: typeof data) => (old ? { ...old, completed: list } : old)),
    onError: () => toast.error("Não foi possível salvar o progresso."),
  });

  const saveMutation = useMutation({
    mutationFn: (c: CourseData) => saveCourse(c),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["course"] });
      setEditing(false);
      setDraft(null);
      toast.success("Aulas salvas.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar as aulas."),
  });

  const startEditing = () => {
    setDraft(JSON.parse(JSON.stringify(data?.course ?? { modules: [] })) as CourseData);
    setEditing(true);
  };

  const idx = selected ? flat.findIndex((l) => l.id === selected.id) : -1;
  const next = idx >= 0 ? flat[idx + 1] : undefined;

  return (
    <AppShell>
      <div className="px-4 md:px-8 py-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
          <div className="flex items-center gap-3">
            <GraduationCap className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Aulas</h1>
              <p className="text-xs text-muted-foreground">Aprenda a usar o sistema, passo a passo.</p>
            </div>
          </div>
          {data?.canEdit &&
            (editing ? (
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => { setEditing(false); setDraft(null); }}>Cancelar</Button>
                <Button onClick={() => draft && saveMutation.mutate(draft)} disabled={saveMutation.isPending} className="gap-2">
                  {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar aulas
                </Button>
              </div>
            ) : (
              <Button variant="outline" onClick={startEditing} className="gap-2">
                <Pencil className="h-4 w-4" /> Editar aulas
              </Button>
            ))}
        </div>

        {isLoading ? (
          <div className="py-16 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : editing && draft ? (
          <CourseEditor draft={draft} onChange={setDraft} />
        ) : total === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
            Ainda não há aulas por aqui.{data?.canEdit && " Clique em “Editar aulas” pra criar o primeiro módulo."}
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
            {/* Lista de módulos e aulas */}
            <aside className="space-y-4">
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-sm font-medium">{doneCount} de {total} aulas concluídas</p>
                <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-emerald-500 transition-all" style={{ width: `${total ? (doneCount / total) * 100 : 0}%` }} />
                </div>
              </div>
              {course.modules.map((m, mi) => (
                <div key={m.id} className="rounded-xl border border-border bg-card overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-border bg-muted/30">
                    <p className="text-xs text-muted-foreground">Módulo {mi + 1}</p>
                    <p className="text-sm font-semibold">{m.title || "Sem título"}</p>
                  </div>
                  <ul>
                    {m.lessons.map((l) => {
                      const done = completed.has(l.id);
                      const active = selected?.id === l.id;
                      return (
                        <li key={l.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedId(l.id)}
                            className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-sm transition-colors ${active ? "bg-primary/10" : "hover:bg-muted/40"}`}
                          >
                            {done ? (
                              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                            ) : (
                              <span className="h-4 w-4 shrink-0 rounded-full border border-muted-foreground/40" />
                            )}
                            <span className={active ? "font-medium" : ""}>{l.title || "Sem título"}</span>
                          </button>
                        </li>
                      );
                    })}
                    {m.lessons.length === 0 && <li className="px-4 py-2.5 text-xs text-muted-foreground">Sem aulas ainda.</li>}
                  </ul>
                </div>
              ))}
            </aside>

            {/* Player */}
            {selected && (
              <section className="min-w-0 space-y-4">
                <Player url={selected.url} />
                <div>
                  <p className="text-xs text-muted-foreground">{selected.moduleTitle}</p>
                  <h2 className="text-lg font-semibold">{selected.title}</h2>
                </div>
                {selected.description && <p className="text-sm text-muted-foreground whitespace-pre-wrap max-w-prose">{selected.description}</p>}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={completed.has(selected.id) ? "outline" : "default"}
                    className="gap-2"
                    disabled={doneMutation.isPending}
                    onClick={() => doneMutation.mutate({ id: selected.id, done: !completed.has(selected.id) })}
                  >
                    <Check className="h-4 w-4" />
                    {completed.has(selected.id) ? "Concluída (desmarcar)" : "Marcar como concluída"}
                  </Button>
                  {next && (
                    <Button variant="outline" onClick={() => setSelectedId(next.id)}>
                      Próxima aula
                    </Button>
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Player({ url }: { url: string }) {
  const src = parseVideoUrl(url);
  if (!url.trim()) {
    return <div className="aspect-video max-w-full rounded-xl border border-dashed border-border flex items-center justify-center text-sm text-muted-foreground">Vídeo em breve.</div>;
  }
  if (!src) {
    return (
      <div className="aspect-video max-w-full rounded-xl border border-border flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        Não foi possível incorporar este link.
        <Button asChild variant="outline" size="sm" className="gap-2">
          <a href={url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> Abrir o vídeo</a>
        </Button>
      </div>
    );
  }
  return (
    <div className="aspect-video max-w-full overflow-hidden rounded-xl border border-border bg-black">
      {src.kind === "file" ? (
        <video key={src.src} src={src.src} controls className="h-full w-full" />
      ) : (
        <iframe
          key={src.src}
          src={src.src}
          title="Aula"
          className="h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
        />
      )}
    </div>
  );
}

// ── Edição (só o dono) ──────────────────────────────────────────────────────

function CourseEditor({ draft, onChange }: { draft: CourseData; onChange: (c: CourseData) => void }) {
  const setModule = (mi: number, fields: Partial<CourseModule>) =>
    onChange({ modules: draft.modules.map((m, i) => (i === mi ? { ...m, ...fields } : m)) });
  const setLesson = (mi: number, li: number, fields: Partial<CourseLesson>) =>
    setModule(mi, { lessons: draft.modules[mi].lessons.map((l, i) => (i === li ? { ...l, ...fields } : l)) });

  return (
    <div className="space-y-5 max-w-3xl">
      {draft.modules.map((m, mi) => (
        <div key={m.id} className="rounded-xl border border-border bg-card">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <span className="text-xs text-muted-foreground shrink-0">Módulo {mi + 1}</span>
            <Input value={m.title} onChange={(e) => setModule(mi, { title: e.target.value })} placeholder="Nome do módulo" className="h-8" />
            <Button type="button" size="icon" variant="ghost" className="h-8 w-8" disabled={mi === 0} onClick={() => onChange({ modules: move(draft.modules, mi, mi - 1) })} title="Subir módulo"><ArrowUp className="h-4 w-4" /></Button>
            <Button type="button" size="icon" variant="ghost" className="h-8 w-8" disabled={mi === draft.modules.length - 1} onClick={() => onChange({ modules: move(draft.modules, mi, mi + 1) })} title="Descer módulo"><ArrowDown className="h-4 w-4" /></Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-red-400"
              title="Excluir módulo"
              onClick={() => {
                if (m.lessons.length === 0 || confirm(`Excluir o módulo "${m.title || "sem título"}" e as ${m.lessons.length} aula(s) dele?`)) {
                  onChange({ modules: draft.modules.filter((_, i) => i !== mi) });
                }
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="divide-y divide-border">
            {m.lessons.map((l, li) => (
              <div key={l.id} className="p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Input value={l.title} onChange={(e) => setLesson(mi, li, { title: e.target.value })} placeholder="Título da aula" className="h-8" />
                  <Button type="button" size="icon" variant="ghost" className="h-8 w-8" disabled={li === 0} onClick={() => setModule(mi, { lessons: move(m.lessons, li, li - 1) })} title="Subir aula"><ArrowUp className="h-4 w-4" /></Button>
                  <Button type="button" size="icon" variant="ghost" className="h-8 w-8" disabled={li === m.lessons.length - 1} onClick={() => setModule(mi, { lessons: move(m.lessons, li, li + 1) })} title="Descer aula"><ArrowDown className="h-4 w-4" /></Button>
                  <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-red-400" onClick={() => setModule(mi, { lessons: m.lessons.filter((_, i) => i !== li) })} title="Excluir aula"><X className="h-4 w-4" /></Button>
                </div>
                <Input value={l.url} onChange={(e) => setLesson(mi, li, { url: e.target.value })} placeholder="Link do vídeo (YouTube, Vimeo, Google Drive, Loom ou .mp4)" className="h-8 text-xs" />
                {l.url.trim() && !parseVideoUrl(l.url) && <p className="text-xs text-amber-400">Esse link não vai tocar dentro da página (só abrir em outra aba).</p>}
                <Textarea value={l.description} onChange={(e) => setLesson(mi, li, { description: e.target.value })} placeholder="Descrição da aula (opcional)" rows={2} className="text-sm" />
              </div>
            ))}
            <div className="p-3">
              <Button type="button" size="sm" variant="ghost" className="gap-1.5" onClick={() => setModule(mi, { lessons: [...m.lessons, { id: uid(), title: "", url: "", description: "" }] })}>
                <Plus className="h-3.5 w-3.5" /> Adicionar aula
              </Button>
            </div>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" className="gap-2" onClick={() => onChange({ modules: [...draft.modules, { id: uid(), title: "", lessons: [] }] })}>
        <Plus className="h-4 w-4" /> Adicionar módulo
      </Button>
    </div>
  );
}
