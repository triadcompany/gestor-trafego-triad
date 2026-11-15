// Converte o link colado pelo gestor no formato que o player aceita.
export type VideoSource = { kind: "iframe"; src: string } | { kind: "file"; src: string } | null;

export function parseVideoUrl(raw: string): VideoSource {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.replace(/^www\./, "");

  // YouTube
  if (host === "youtu.be") return { kind: "iframe", src: `https://www.youtube-nocookie.com/embed/${u.pathname.slice(1)}?rel=0` };
  if (host === "youtube.com" || host === "m.youtube.com") {
    const id = u.searchParams.get("v") ?? u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]+)/)?.[1];
    if (id) return { kind: "iframe", src: `https://www.youtube-nocookie.com/embed/${id}?rel=0` };
  }
  // Vimeo (vimeo.com/123456 ou vimeo.com/123456/hash)
  if (host === "vimeo.com") {
    const m = u.pathname.match(/^\/(\d+)(?:\/(\w+))?/);
    if (m) return { kind: "iframe", src: `https://player.vimeo.com/video/${m[1]}${m[2] ? `?h=${m[2]}` : ""}` };
  }
  if (host === "player.vimeo.com") return { kind: "iframe", src: u.toString() };
  // Google Drive
  if (host === "drive.google.com") {
    const id = u.pathname.match(/\/file\/d\/([\w-]+)/)?.[1] ?? u.searchParams.get("id");
    if (id) return { kind: "iframe", src: `https://drive.google.com/file/d/${id}/preview` };
  }
  // Loom
  if (host === "loom.com") {
    const id = u.pathname.match(/\/(?:share|embed)\/(\w+)/)?.[1];
    if (id) return { kind: "iframe", src: `https://www.loom.com/embed/${id}` };
  }
  // Arquivo de vídeo direto
  if (/\.(mp4|webm|mov|m4v)$/i.test(u.pathname)) return { kind: "file", src: u.toString() };
  return null;
}
