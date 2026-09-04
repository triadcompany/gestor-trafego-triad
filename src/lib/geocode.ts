"use server";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export interface GeoPoint {
  lat: number;
  lon: number;
}

// Cache em memória do processo — evita regeocodificar a mesma cidade toda vez
// (Manaus, São Paulo etc. se repetem entre vários conjuntos/clientes).
const cache = new Map<string, GeoPoint | null>();

async function geocodeOne(query: string): Promise<GeoPoint | null> {
  if (cache.has(query)) return cache.get(query)!;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "GestorTrafegoTriad/1.0 (uso interno - mapa de segmentacao de anuncios)" },
    });
    if (!res.ok) {
      // Erro do serviço (rate limit, instabilidade etc.) — não guarda em cache,
      // senão essa cidade fica "não encontrada" pra sempre até o servidor reiniciar.
      console.error(`[geocode] Nominatim retornou ${res.status} para "${query}"`);
      return null;
    }
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    const point = data[0] ? { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) } : null;
    // Só guarda em cache resultado de verdade — uma falha/vazio não deve "grudar".
    if (point) cache.set(query, point);
    else console.error(`[geocode] Nenhum resultado do Nominatim para "${query}"`);
    return point;
  } catch (e) {
    console.error(`[geocode] Falha ao geocodificar "${query}":`, e);
    return null;
  }
}

const geocodeSchema = z.object({
  queries: z.array(z.object({ key: z.string(), query: z.string() })),
});

const _geocodeLocations = createServerFn({ method: "POST" })
  .inputValidator(geocodeSchema)
  .handler(async ({ data }): Promise<Record<string, GeoPoint | null>> => {
    const result: Record<string, GeoPoint | null> = {};
    for (const { key, query } of data.queries) {
      result[key] = await geocodeOne(query);
      // Nominatim pede no máximo ~1 requisição por segundo — só espera pras que não vieram do cache
      if (!cache.has(query)) await new Promise((r) => setTimeout(r, 300));
    }
    return result;
  });

export async function geocodeLocations(
  queries: Array<{ key: string; query: string }>
): Promise<Record<string, GeoPoint | null>> {
  if (queries.length === 0) return {};
  return _geocodeLocations({ data: { queries } });
}
