import { Fragment, useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Circle, Tooltip as LeafletTooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Loader2 } from "lucide-react";
import { geocodeLocations, type GeoPoint } from "@/lib/geocode";
import type { SelectedLocation } from "@/lib/meta";

function FitBounds({ points }: { points: GeoPoint[] }) {
  const map = useMap();
  const key = points.map((p) => `${p.lat},${p.lon}`).join("|");
  useEffect(() => {
    if (points.length === 0) return;
    // O mapa nasce dentro de um painel que aparece condicionalmente ("Ver no
    // mapa") — no momento em que o Leaflet mede o container pela primeira vez,
    // a altura pode ainda não ter sido aplicada, e os pinos saem posicionados
    // fora do lugar (parece que "sumiram"). invalidateSize força remedir.
    map.invalidateSize();
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lon], 10);
    } else {
      map.fitBounds(
        L.latLngBounds(points.map((p) => [p.lat, p.lon] as [number, number])),
        { padding: [30, 30] }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

/** Mapa com pino por cidade selecionada e círculo do raio (quando configurado) — igual ao do Meta Ads Manager. */
export function LocationsMap({ locations }: { locations: SelectedLocation[] }) {
  const [points, setPoints] = useState<Record<string, GeoPoint | null>>({});
  const [loading, setLoading] = useState(false);

  const pinIcon = useMemo(
    () =>
      L.divIcon({
        className: "",
        html: `<div style="background:#d97706;width:14px;height:14px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 14],
      }),
    []
  );

  const cityKeys = locations.filter((l) => l.type === "city").map((l) => l.key).join(",");

  useEffect(() => {
    const cities = locations.filter((l) => l.type === "city");
    if (cities.length === 0) {
      setPoints({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    const queries = cities.map((l) => ({
      key: l.key,
      query: l.region ? `${l.name}, ${l.region}, Brasil` : `${l.name}, Brasil`,
    }));
    geocodeLocations(queries)
      .then((res) => {
        if (!cancelled) setPoints(res);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityKeys]);

  const resolved = locations
    .filter((l) => l.type === "city")
    .map((l) => ({ loc: l, point: points[l.key] }))
    .filter((r): r is { loc: SelectedLocation; point: GeoPoint } => !!r.point);

  if (locations.filter((l) => l.type === "city").length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-3 text-center">
        Adicione uma cidade pra ver no mapa.
      </p>
    );
  }

  return (
    <div className="relative rounded-lg overflow-hidden border border-border" style={{ height: 260 }}>
      {loading && (
        <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-background/60">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
      <MapContainer center={[-14.2, -51.9]} zoom={4} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        {resolved.map(({ loc, point }) => (
          <Fragment key={loc.key}>
            <Marker position={[point.lat, point.lon]} icon={pinIcon}>
              <LeafletTooltip>{loc.name}{loc.radius ? ` — +${loc.radius}km` : ""}</LeafletTooltip>
            </Marker>
            {loc.radius && (
              <Circle
                center={[point.lat, point.lon]}
                radius={loc.radius * 1000}
                pathOptions={{ color: "#d97706", fillColor: "#d97706", fillOpacity: 0.12, weight: 1.5 }}
              />
            )}
          </Fragment>
        ))}
        <FitBounds points={resolved.map((r) => r.point)} />
      </MapContainer>
    </div>
  );
}
