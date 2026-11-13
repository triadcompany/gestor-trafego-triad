// Posicionamentos manuais oferecidos no app — os mesmos que o Gerenciador da
// Meta usa em conjuntos de WhatsApp (conferido nos conjuntos montados lá).
// Fonte única pros formulários de criar, editar e o editor de segmentação.

export const FB_POSITION_OPTIONS: { value: string; label: string }[] = [
  { value: "feed", label: "Feed" },
  { value: "profile_feed", label: "Feed do perfil" },
  { value: "story", label: "Stories" },
  { value: "facebook_reels", label: "Reels" },
  { value: "marketplace", label: "Marketplace" },
  { value: "instream_video", label: "Vídeo in-stream" },
  { value: "search", label: "Resultados de pesquisa" },
  { value: "notification", label: "Notificações" },
];

export const IG_POSITION_OPTIONS: { value: string; label: string }[] = [
  { value: "stream", label: "Feed" },
  { value: "profile_feed", label: "Feed do perfil" },
  { value: "story", label: "Stories" },
  { value: "reels", label: "Reels" },
  { value: "explore", label: "Explorar" },
  { value: "explore_home", label: "Página inicial do Explorar" },
];

export const DEFAULT_FB_POSITIONS = FB_POSITION_OPTIONS.map((o) => o.value);
export const DEFAULT_IG_POSITIONS = IG_POSITION_OPTIONS.map((o) => o.value);

// Anúncio de WhatsApp no Gerenciador é sempre só celular. Sem isso a Meta
// aceita e veicula, mas a tela do Gerenciador mostra tudo desmarcado.
export const MANUAL_PLACEMENT_DEVICES = ["mobile"];

const unique = (list: string[]) => Array.from(new Set(list));

export function normalizeFbPositions(positions: string[]): string[] {
  return unique(
    positions
      .map((p) => (p === "reels" ? "facebook_reels" : p))
      // coluna direita é só desktop — incompatível com device_platforms mobile
      .filter((p) => p !== "right_hand_column")
  );
}

export function normalizeIgPositions(positions: string[]): string[] {
  const list = positions.filter((p) => p !== "ig_search");
  // regra da Meta: página inicial do Explorar exige o Explorar junto
  if (list.includes("explore_home") && !list.includes("explore")) list.push("explore");
  return unique(list);
}

export interface ManualPlacementInput {
  facebook: boolean;
  instagram: boolean;
  fbPositions: string[];
  igPositions: string[];
}

/** Campos de targeting pro modo manual (publisher_platforms + posições + dispositivo). */
export function buildManualPlacementTargeting(input: ManualPlacementInput): Record<string, unknown> {
  const fb = normalizeFbPositions(input.fbPositions);
  const ig = normalizeIgPositions(input.igPositions);
  const publisher_platforms: string[] = [];
  const out: Record<string, unknown> = { device_platforms: MANUAL_PLACEMENT_DEVICES };
  if (input.facebook) {
    publisher_platforms.push("facebook");
    out.facebook_positions = fb.length ? fb : ["feed", "story"];
  }
  if (input.instagram) {
    publisher_platforms.push("instagram");
    out.instagram_positions = ig.length ? ig : ["stream", "story"];
  }
  out.publisher_platforms = publisher_platforms;
  return out;
}
