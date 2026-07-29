const PALETTE = [
  { border: "#4f7fff", badgeBg: "bg-blue-100 dark:bg-blue-950", badgeText: "text-blue-700 dark:text-blue-400" },
  { border: "#a855f7", badgeBg: "bg-purple-100 dark:bg-purple-950", badgeText: "text-purple-700 dark:text-purple-400" },
  { border: "#10b981", badgeBg: "bg-emerald-100 dark:bg-emerald-950", badgeText: "text-emerald-700 dark:text-emerald-400" },
  { border: "#f59e0b", badgeBg: "bg-amber-100 dark:bg-amber-950", badgeText: "text-amber-800 dark:text-amber-400" },
  { border: "#f472b6", badgeBg: "bg-pink-100 dark:bg-pink-950", badgeText: "text-pink-700 dark:text-pink-400" },
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
