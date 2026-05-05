import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { X, Search, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  fetchAdSetTargeting,
  updateAdSetTargeting,
  searchMetaInterests,
  searchMetaLocations,
  type MetaTargeting,
  type MetaInterest,
  type MetaLocationResult,
} from "@/lib/meta";

// ── Facebook & Instagram position options ────────────────────

const FB_POSITIONS: { value: string; label: string }[] = [
  { value: "feed", label: "Feed" },
  { value: "story", label: "Stories" },
  { value: "reels", label: "Reels" },
  { value: "right_hand_column", label: "Coluna direita" },
  { value: "instream_video", label: "Vídeo in-stream" },
];

const IG_POSITIONS: { value: string; label: string }[] = [
  { value: "stream", label: "Feed" },
  { value: "story", label: "Stories" },
  { value: "explore", label: "Explorar" },
  { value: "reels", label: "Reels" },
];

// ── Main component ────────────────────────────────────────────

interface TargetingEditorProps {
  adSetId: string;
  token: string;
}

export function TargetingEditor({ adSetId, token }: TargetingEditorProps) {
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(65);
  const [genderMode, setGenderMode] = useState<"all" | "male" | "female">("all");
  const [interests, setInterests] = useState<MetaInterest[]>([]);
  const [locations, setLocations] = useState<MetaLocationResult[]>([]);
  const [platforms, setPlatforms] = useState({ facebook: true, instagram: true });
  const [fbPositions, setFbPositions] = useState<string[]>(["feed", "story"]);
  const [igPositions, setIgPositions] = useState<string[]>(["stream", "story"]);
  const [dirty, setDirty] = useState(false);

  const { data: targeting, isLoading } = useQuery({
    queryKey: ["targeting", adSetId],
    queryFn: () => fetchAdSetTargeting(adSetId, token),
  });

  useEffect(() => {
    if (!targeting) return;
    setAgeMin(targeting.age_min ?? 18);
    setAgeMax(targeting.age_max ?? 65);
    const g = targeting.genders ?? [];
    setGenderMode(g.length === 1 && g[0] === 1 ? "male" : g.length === 1 && g[0] === 2 ? "female" : "all");
    setInterests(targeting.flexible_spec?.[0]?.interests ?? []);
    const cities = (targeting.geo_locations?.cities ?? []) as MetaLocationResult[];
    setLocations(cities);
    const pp = targeting.publisher_platforms ?? ["facebook", "instagram"];
    setPlatforms({ facebook: pp.includes("facebook"), instagram: pp.includes("instagram") });
    setFbPositions(targeting.facebook_positions ?? ["feed", "story"]);
    setIgPositions(targeting.instagram_positions ?? ["stream", "story"]);
    setDirty(false);
  }, [targeting]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Build clean targeting — never spread original targeting (may include read-only fields Meta rejects)
      const newTargeting: MetaTargeting = {
        geo_locations: locations.length > 0
          ? { cities: locations.map((l) => ({ key: l.key })) }
          : { countries: ["BR"] },
        targeting_automation: { advantage_audience: 0 },
        publisher_platforms: [
          ...(platforms.facebook ? ["facebook"] : []),
          ...(platforms.instagram ? ["instagram"] : []),
        ],
        ...(platforms.facebook ? { facebook_positions: fbPositions } : {}),
        ...(platforms.instagram ? {
          instagram_positions: (() => {
            let pos = igPositions;
            // explore_home requires explore (Meta rule)
            if (pos.includes("explore_home") && !pos.includes("explore")) pos = [...pos, "explore"];
            // ig_search conflicts with other placements
            pos = pos.filter((p) => p !== "ig_search");
            return pos;
          })(),
        } : {}),
        ...(ageMin > 18 ? { age_min: ageMin } : {}),
        ...(ageMax < 65 ? { age_max: ageMax } : {}),
        ...(genderMode !== "all" ? { genders: genderMode === "male" ? [1] : [2] } : {}),
        ...(interests.length > 0 ? { flexible_spec: [{ interests }] } : {}),
      };
      await updateAdSetTargeting(adSetId, newTargeting, token);
    },
    onSuccess: () => { toast.success("Segmentação salva."); setDirty(false); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar"),
  });

  const mark = () => setDirty(true);

  if (isLoading) {
    return (
      <div className="space-y-3 py-3">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-5 py-2">

      {/* Localização */}
      <FieldSection title="Localização">
        <LocationSearch
          selected={locations}
          token={token}
          onChange={(locs) => { setLocations(locs); mark(); }}
        />
      </FieldSection>

      <Separator />

      {/* Idade */}
      <FieldSection title="Faixa etária">
        <div className="flex items-center gap-3">
          <div className="flex-1 space-y-1">
            <Label className="text-xs text-muted-foreground">Mínima</Label>
            <Input
              type="number"
              value={ageMin}
              min={18} max={65}
              onChange={(e) => { setAgeMin(Number(e.target.value)); mark(); }}
              className="h-8 text-sm"
            />
          </div>
          <span className="text-muted-foreground mt-5">–</span>
          <div className="flex-1 space-y-1">
            <Label className="text-xs text-muted-foreground">Máxima</Label>
            <Input
              type="number"
              value={ageMax}
              min={18} max={65}
              onChange={(e) => { setAgeMax(Number(e.target.value)); mark(); }}
              className="h-8 text-sm"
            />
          </div>
        </div>
      </FieldSection>

      <Separator />

      {/* Gênero */}
      <FieldSection title="Gênero">
        <div className="flex gap-3">
          {(["all", "male", "female"] as const).map((g) => (
            <label key={g} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="gender"
                value={g}
                checked={genderMode === g}
                onChange={() => { setGenderMode(g); mark(); }}
                className="accent-primary"
              />
              <span className="text-sm">{g === "all" ? "Todos" : g === "male" ? "Masculino" : "Feminino"}</span>
            </label>
          ))}
        </div>
      </FieldSection>

      <Separator />

      {/* Interesses */}
      <FieldSection title="Interesses">
        <InterestSearch
          selected={interests}
          token={token}
          onChange={(ints) => { setInterests(ints); mark(); }}
        />
      </FieldSection>

      <Separator />

      {/* Posicionamentos */}
      <FieldSection title="Posicionamentos">
        <div className="space-y-4">
          {/* Platforms */}
          <div className="flex gap-4">
            {[
              { key: "facebook" as const, label: "Facebook" },
              { key: "instagram" as const, label: "Instagram" },
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={platforms[key]}
                  onCheckedChange={(v) => { setPlatforms((p) => ({ ...p, [key]: !!v })); mark(); }}
                />
                <span className="text-sm">{label}</span>
              </label>
            ))}
          </div>

          {platforms.facebook && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Posições Facebook</p>
              <div className="grid grid-cols-2 gap-1.5">
                {FB_POSITIONS.map(({ value, label }) => (
                  <PositionToggle
                    key={value}
                    label={label}
                    checked={fbPositions.includes(value)}
                    onChange={(v) => {
                      setFbPositions((p) => v ? [...p, value] : p.filter((x) => x !== value));
                      mark();
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {platforms.instagram && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Posições Instagram</p>
              <div className="grid grid-cols-2 gap-1.5">
                {IG_POSITIONS.map(({ value, label }) => (
                  <PositionToggle
                    key={value}
                    label={label}
                    checked={igPositions.includes(value)}
                    onChange={(v) => {
                      setIgPositions((p) => v ? [...p, value] : p.filter((x) => x !== value));
                      mark();
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </FieldSection>

      <Button
        onClick={() => saveMutation.mutate()}
        disabled={!dirty || saveMutation.isPending}
        className="w-full"
        size="sm"
      >
        {saveMutation.isPending ? (
          <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> Salvando...</>
        ) : dirty ? "Salvar alterações" : "Sem alterações"}
      </Button>
    </div>
  );
}

// ── Location search ───────────────────────────────────────────

function LocationSearch({
  selected,
  token,
  onChange,
}: {
  selected: MetaLocationResult[];
  token: string;
  onChange: (locs: MetaLocationResult[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MetaLocationResult[]>([]);
  const [searching, setSearching] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = (q: string) => {
    setQuery(q);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!q.trim()) { setResults([]); return; }
    timerRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await searchMetaLocations(q, token);
        setResults(data.filter((r) => !selected.some((s) => s.key === r.key)));
      } catch { /* silent */ }
      finally { setSearching(false); }
    }, 400);
  };

  const add = (loc: MetaLocationResult) => {
    onChange([...selected, loc]);
    setResults((r) => r.filter((x) => x.key !== loc.key));
    setQuery("");
  };

  const remove = (key: string) => onChange(selected.filter((s) => s.key !== key));

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border border-border rounded-md bg-background">
        {searching ? <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin shrink-0" /> : <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
        <input
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Buscar cidade ou região..."
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      {results.length > 0 && (
        <div className="border border-border rounded-md overflow-hidden bg-popover shadow-sm">
          {results.slice(0, 6).map((r) => (
            <button
              key={r.key}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 transition-colors flex items-center justify-between gap-2"
              onClick={() => add(r)}
            >
              <span>{r.name}</span>
              <span className="text-xs text-muted-foreground">{r.type === "city" ? "Cidade" : "Estado"}</span>
            </button>
          ))}
        </div>
      )}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((loc) => (
            <Badge key={loc.key} variant="secondary" className="gap-1 text-xs pr-1">
              {loc.name}
              <button onClick={() => remove(loc.key)} className="hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      {selected.length === 0 && (
        <p className="text-xs text-muted-foreground">Nenhuma cidade/região — usando cobertura nacional (Brasil).</p>
      )}
    </div>
  );
}

// ── Interest search ───────────────────────────────────────────

function InterestSearch({
  selected,
  token,
  onChange,
}: {
  selected: MetaInterest[];
  token: string;
  onChange: (ints: MetaInterest[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MetaInterest[]>([]);
  const [searching, setSearching] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = (q: string) => {
    setQuery(q);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!q.trim()) { setResults([]); return; }
    timerRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await searchMetaInterests(q, token);
        setResults(data.filter((r) => !selected.some((s) => s.id === r.id)));
      } catch { /* silent */ }
      finally { setSearching(false); }
    }, 400);
  };

  const add = (int: MetaInterest) => {
    onChange([...selected, int]);
    setResults((r) => r.filter((x) => x.id !== int.id));
    setQuery("");
  };

  const remove = (id: string) => onChange(selected.filter((s) => s.id !== id));

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border border-border rounded-md bg-background">
        {searching ? <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin shrink-0" /> : <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
        <input
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Buscar interesse..."
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      {results.length > 0 && (
        <div className="border border-border rounded-md overflow-hidden bg-popover shadow-sm">
          {results.slice(0, 8).map((r) => (
            <button
              key={r.id}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 transition-colors"
              onClick={() => add(r)}
            >
              {r.name}
            </button>
          ))}
        </div>
      )}
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((int) => (
            <Badge key={int.id} variant="secondary" className="gap-1 text-xs pr-1">
              {int.name}
              <button onClick={() => remove(int.id)} className="hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Nenhum interesse — segmentação ampla.</p>
      )}
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────

function FieldSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

function PositionToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <Checkbox checked={checked} onCheckedChange={onChange} />
      <span className="text-sm">{label}</span>
    </label>
  );
}
