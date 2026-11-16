// Prepara a logo enviada pelo gestor: reduz pra no máximo 600px (PNG, mantém
// transparência) e extrai as cores de destaque da marca.

export async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Não consegui abrir essa imagem."));
    img.src = src;
  });
}

export async function shrinkLogo(file: File, maxSide = 600): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

const hex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

// Cores mais presentes e "de marca": ignora transparência, branco, preto e cinzas
// (a não ser que a logo só tenha isso). Devolve até 3 em hex.
export async function extractLogoColors(dataUri: string): Promise<string[]> {
  const img = await loadImage(dataUri);
  const size = 96;
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, size / Math.max(img.width, img.height));
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  type Bucket = { n: number; r: number; g: number; b: number };
  const colorful = new Map<number, Bucket>();
  const neutral = new Map<number, Bucket>();
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a < 200) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const target = sat > 0.28 && max > 50 ? colorful : neutral;
    const cur = target.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    cur.n++;
    cur.r += r;
    cur.g += g;
    cur.b += b;
    target.set(key, cur);
  }
  const pool = colorful.size > 0 ? colorful : neutral;
  const sorted = [...pool.values()].sort((a, b) => b.n - a.n).map((b) => [Math.round(b.r / b.n), Math.round(b.g / b.n), Math.round(b.b / b.n)] as const);
  const picked: Array<readonly [number, number, number]> = [];
  for (const c of sorted) {
    if (picked.every((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) > 70)) picked.push(c);
    if (picked.length === 3) break;
  }
  return picked.map((c) => hex(c[0], c[1], c[2]));
}
