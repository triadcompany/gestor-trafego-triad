const PALETTE = [
  { border: "#4f7fff", badgeBg: "bg-blue-950", badgeText: "text-blue-400" },
  { border: "#a855f7", badgeBg: "bg-purple-950", badgeText: "text-purple-400" },
  { border: "#10b981", badgeBg: "bg-emerald-950", badgeText: "text-emerald-400" },
  { border: "#f59e0b", badgeBg: "bg-amber-950", badgeText: "text-amber-400" },
  { border: "#f472b6", badgeBg: "bg-pink-950", badgeText: "text-pink-400" },
];

// Deterministic color per client based on a simple hash of the id string
function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

export function clientColor(clientId: string) {
  return PALETTE[hashId(clientId) % PALETTE.length];
}
