import { buildManualPlacementTargeting, DEFAULT_FB_POSITIONS, DEFAULT_IG_POSITIONS } from "./placements";

// Mudança de segmentação que uma sugestão da Otimização propõe — o usuário
// ajusta os valores na confirmação antes de aplicar.
export type TargetingChange =
  // null = manter o que cada conjunto já tem
  | { kind: "age"; ageMin: number | null; ageMax: number | null }
  | { kind: "placements"; facebook: boolean; instagram: boolean; fbPositions: string[]; igPositions: string[] }
  | { kind: "gender"; gender: "all" | "male" | "female" };

// Chave do relatório da Meta ("plataforma:platform_position") → valor usado
// no targeting do conjunto. Itens fora da lista (Audience Network, Status do
// WhatsApp…) já ficam de fora quando o conjunto passa a ter posicionamento manual.
const POSITION_KEY_TO_TARGETING: Record<string, { platform: "facebook" | "instagram"; value: string }> = {
  "facebook:feed": { platform: "facebook", value: "feed" },
  "facebook:facebook_profile_feed": { platform: "facebook", value: "profile_feed" },
  "facebook:facebook_stories": { platform: "facebook", value: "story" },
  "facebook:facebook_reels": { platform: "facebook", value: "facebook_reels" },
  "facebook:marketplace": { platform: "facebook", value: "marketplace" },
  "facebook:instream_video": { platform: "facebook", value: "instream_video" },
  "facebook:search": { platform: "facebook", value: "search" },
  "facebook:notification": { platform: "facebook", value: "notification" },
  "facebook:facebook_notification": { platform: "facebook", value: "notification" },
  "instagram:feed": { platform: "instagram", value: "stream" },
  "instagram:stream": { platform: "instagram", value: "stream" },
  "instagram:instagram_profile_feed": { platform: "instagram", value: "profile_feed" },
  "instagram:instagram_stories": { platform: "instagram", value: "story" },
  "instagram:instagram_reels": { platform: "instagram", value: "reels" },
  "instagram:instagram_explore": { platform: "instagram", value: "explore" },
  "instagram:instagram_explore_grid_home": { platform: "instagram", value: "explore_home" },
};

/** Todos os posicionamentos do padrão, menos os indicados. */
export function placementsWithout(positionKeys: string[], platformsOff: string[] = []): TargetingChange {
  const off = positionKeys.map((k) => POSITION_KEY_TO_TARGETING[k]).filter(Boolean);
  const fb = DEFAULT_FB_POSITIONS.filter((v) => !off.some((o) => o.platform === "facebook" && o.value === v));
  const ig = DEFAULT_IG_POSITIONS.filter((v) => !off.some((o) => o.platform === "instagram" && o.value === v));
  return {
    kind: "placements",
    facebook: !platformsOff.includes("facebook") && fb.length > 0,
    instagram: !platformsOff.includes("instagram") && ig.length > 0,
    fbPositions: fb,
    igPositions: ig,
  };
}

/** Só os posicionamentos indicados. */
export function placementsOnly(positionKeys: string[]): TargetingChange {
  const on = positionKeys.map((k) => POSITION_KEY_TO_TARGETING[k]).filter(Boolean);
  const fb = on.filter((o) => o.platform === "facebook").map((o) => o.value);
  const ig = on.filter((o) => o.platform === "instagram").map((o) => o.value);
  return { kind: "placements", facebook: fb.length > 0, instagram: ig.length > 0, fbPositions: fb, igPositions: ig };
}

const PLACEMENT_FIELDS = [
  "publisher_platforms",
  "facebook_positions",
  "instagram_positions",
  "messenger_positions",
  "audience_network_positions",
  "whatsapp_positions",
  "threads_positions",
  "device_platforms",
];

/**
 * Targeting novo a partir do atual do conjunto: muda só o que a sugestão
 * mexe e mantém o resto (local, interesses, públicos...). O targeting da Meta
 * é substituído inteiro numa atualização, então precisa partir do atual.
 */
export function applyTargetingChange(current: Record<string, unknown>, change: TargetingChange): Record<string, unknown> {
  const next: Record<string, unknown> = { ...current };
  // age_range é como a Meta devolve a idade com Público Advantage+; na escrita
  // vale age_min/age_max.
  if (Array.isArray(next.age_range)) {
    const [min, max] = next.age_range as number[];
    if (next.age_min === undefined && typeof min === "number") next.age_min = min;
    if (next.age_max === undefined && typeof max === "number") next.age_max = max;
    delete next.age_range;
  }

  if (change.kind === "age") {
    if (change.ageMin !== null) next.age_min = change.ageMin;
    if (change.ageMax !== null) next.age_max = change.ageMax;
  } else if (change.kind === "placements") {
    for (const f of PLACEMENT_FIELDS) delete next[f];
    Object.assign(next, buildManualPlacementTargeting(change));
  } else if (change.kind === "gender") {
    if (change.gender === "all") delete next.genders;
    else next.genders = [change.gender === "male" ? 1 : 2];
  }
  return next;
}

export function describeChange(change: TargetingChange): string {
  if (change.kind === "age") {
    const min = change.ageMin ?? "atual";
    const max = change.ageMax ?? "atual";
    return `Idade: ${min} a ${max === 65 ? "65+" : max}`;
  }
  if (change.kind === "gender") return `Gênero: ${{ all: "todos", male: "masculino", female: "feminino" }[change.gender]}`;
  const plats = [change.facebook && "Facebook", change.instagram && "Instagram"].filter(Boolean).join(" + ");
  return `Posicionamentos: ${plats} (${(change.facebook ? change.fbPositions.length : 0) + (change.instagram ? change.igPositions.length : 0)} posições)`;
}
