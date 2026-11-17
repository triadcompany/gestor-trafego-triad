// Baixa, pelo servidor, a imagem de um criativo da Meta e devolve em base64 — o
// navegador não consegue (CORS do CDN da Meta) e o relatório precisa da imagem
// embutida pra sair no PDF.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOrgContext } from "@/server/session";

const ALLOWED_HOSTS = [/\.fbcdn\.net$/, /\.facebook\.com$/, /\.fbsbx\.com$/, /\.cdninstagram\.com$/, /\.akamaihd\.net$/];
const MAX_BYTES = 6 * 1024 * 1024;

const _fetchRemoteImage = createServerFn({ method: "POST" })
  .inputValidator(z.object({ url: z.string().url().max(2000) }))
  .handler(async ({ data }): Promise<{ base64: string; mimetype: string }> => {
    await requireOrgContext();
    const u = new URL(data.url);
    if (u.protocol !== "https:" || !ALLOWED_HOSTS.some((re) => re.test(u.hostname))) throw new Error("Endereço de imagem não permitido.");
    const res = await fetch(u, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`Não consegui baixar a imagem (${res.status}).`);
    const mimetype = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0];
    if (!mimetype.startsWith("image/")) throw new Error("O endereço não é uma imagem.");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error("Imagem grande demais.");
    return { base64: buf.toString("base64"), mimetype };
  });

export async function fetchRemoteImage(url: string): Promise<{ base64: string; mimetype: string }> {
  return _fetchRemoteImage({ data: { url } });
}
