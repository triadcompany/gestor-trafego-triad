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
      headers: { "User-Agent": "GestorTrafegoTriad/1.0 (uso interno — mapa de segmentação de anúncios)" },
    });
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    const point = data[0] ? { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) } : null;
    cache.set(query, point);
    return point;
  } catch {
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
