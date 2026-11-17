import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const VIBE_BIN = '/Applications/vibe.app/Contents/MacOS';
const VIBE_CFG = path.join(os.homedir(), 'Library/Application Support/github.com.thewh1teagle.vibe/app_config.json');

// Transcreve vídeo/áudio localmente (ffmpeg + vibe-server do Vibe). Rápido (~15% da duração) e sem passar pelo agente.
async function transcribe(file) {
  const cfg = JSON.parse(fs.readFileSync(VIBE_CFG, 'utf8'));
  const model = cfg['model.path'];
  const wav = file + '.16k.wav';
  await run(path.join(VIBE_BIN, 'ffmpeg'), ['-y', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '16000', wav], { timeout: 120000 });
  try {
    const { stdout } = await run(path.join(VIBE_BIN, 'vibe-server'), ['transcribe', model, wav, '-l', 'pt'], { timeout: 600000, maxBuffer: 20 * 1024 * 1024 });
    return stdout.trim();
  } finally { fs.rmSync(wav, { force: true }); }
}
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 3055;
const META = 'mcp__claude_ai_Meta_Ads__';
// só o gestor (e o próprio painel) podem falar com este servidor
const ORIGINS = new Set(['https://gestor.triadcomp4ny.com.br', `http://localhost:${PORT}`, 'http://localhost:3000', 'http://localhost:5173', ...(process.env.PAINEL_ORIGINS || '').split(',').filter(Boolean)]);
const HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);

const agentMd = fs.readFileSync(path.join(ROOT, '.claude/agents/criador-campanhas.md'), 'utf8').replace(/^---[\s\S]*?---\n/, '');
const copyMd = fs.existsSync(path.join(ROOT, 'docs/modelo-copy.md')) ? fs.readFileSync(path.join(ROOT, 'docs/modelo-copy.md'), 'utf8') : '';

const SYSTEM = `${agentMd}

## Regras do painel (prioridade máxima)
- Você está num painel local. Responda curto, em português do Brasil, em texto simples (sem tabelas).
- Em toda chamada das ferramentas Meta, envie client_conversation_id "painel-triad-local", client_model "claude-sonnet-5-5", advertiser_job e advertiser_request.
- GRAVAÇÕES NA META: use SEMPRE a ferramenta escrever_meta (n8n) para criar ou alterar qualquer coisa (campanha, conjunto, criativo, anúncio, vídeo, status, orçamento). As ferramentas ads_create_*/ads_update_*/upload do conector Meta estão bloqueadas; o conector serve só para LER (ads_get_*, insights). Ao criar em sequência, use "{{op:N.id}}" para referenciar o id da gravação anterior na mesma chamada (ex.: campaign_id do conjunto = "{{op:0.id}}"). Se uma chamada voltar ok:false, leia "results" (o que já foi criado) e continue de onde parou, sem recriar. O token é aplicado pelo painel: nunca peça nem escreva token.
- Vídeo: publique o arquivo por link temporário e crie com escrever_meta em act_<ID>/advideos com params {file_url: "<link>"}; espere ficar "ready" lendo com ads_get. Imagem: act_<ID>/adimages com params {bytes: "@arquivo:<caminho em uploads>"} (o painel troca pelo conteúdo em base64).
- Tudo é criado como rascunho. NUNCA ative sem o usuário pedir; a ativação abre um cartão de aprovação no painel.
- Para vídeo enviado pelo painel (pasta ${path.join(__dirname, 'uploads')}), publique por link temporário (cloudflared quick tunnel + python3 -m http.server) e apague o link depois do upload.
- Quando a mensagem trouxer "CLIENTES DO GESTOR", essa é a fonte de verdade de quem é cliente e qual a conta de anúncio (act_), página e WhatsApp dele. Resolva o nome citado pelo usuário nessa lista (aceite grafia aproximada, ex.: "devetim" = DV Team). Se houver dúvida entre dois clientes, pergunte antes de criar ou alterar qualquer coisa. Se a conta do cliente não aparecer no conector (ads_get_ad_accounts), avise que o conector não enxerga essa conta e não tente outra.
- PADRÃO DAS ARTES (siga sempre): arte quadrada de anúncio de loja de carros, com hierarquia assim, de cima pra baixo: (a) marca do carro pequena e o MODELO enorme em letras grossas, com o ano em destaque na cor de acento; (b) 2 a 3 especificações curtas com ícones de linha (câmbio, km, combustível/4x4, etc.) em coluna à esquerda; (c) o carro grande, centralizado, em ângulo 3/4, com reflexo suave no piso e iluminação de estúdio; (d) o preço bem grande, com a palavra VALOR acima; (e) uma faixa de 3 benefícios com ícones embaixo (ex.: "Financiamento em até 60x", "Parcelamento no cartão", "Aceitamos troca"); (f) a logo da loja no canto superior direito, e se a placa do carro aparecer, troque pela logo da loja (placa-logo). Há três estilos: PREMIUM (parede de concreto cinza de showroom, logo grande centralizada no topo com brilho suave, modelo em preto enorme com halo branco, subtítulo e linha "ano | km", uma linha de 5 ícones de especificação separados por filetes na cor de acento, uma linha de pilares espaçados tipo "Tecnologia | Conforto | Segurança | Design", o preço numa pílula preta com borda na cor de acento, um selo circular opcional (ex.: "IPVA 2026 PAGO", só se o usuário informar), o carro grande embaixo e, no rodapé, o nome da loja e um slogan curto — use para carros premium/novos); ESCURO (fundo preto/grafite, brilhos e linhas na cor da marca, marca-d'água grande da logo ao fundo, textos brancos, preço na cor de acento) e CLARO (fundo branco de estúdio, textos pretos, etiquetas cinza inclinadas, faixa preta com chamada tipo "FINANCIAMENTO EM TODOS OS BANCOS" e um botão "Clique no botão abaixo"). Use o escuro por padrão; o claro se o usuário pedir ou se a logo for escura; o premium se o usuário pedir ou o carro for de alto valor. AS CORES de acento, brilhos e faixas vêm das "cores da marca" do cliente (lista CLIENTES DO GESTOR); mande sempre a logo do cliente (caminho em "logo:") junto das fotos do carro em "fotos", e cite no prompt, em hexadecimal, as cores da marca e que a logo deve ser reproduzida fiel, sem redesenhar. Se o cliente estiver sem logo cadastrada, avise e pergunte se segue sem logo. NUNCA coloque número de telefone/WhatsApp nem ícone de WhatsApp na arte (o contato vai na cópia do anúncio, não na imagem). Dados que o usuário não informou (preço, km, ano, selos) NÃO invente: deixe de fora ou pergunte. O texto "Clique no botão abaixo" só no estilo claro.
- ARTES: quando o usuário pedir uma arte/criativo/imagem pro anúncio com fotos do carro, use a ferramenta gerar_arte (OpenAI). Antes, abra cada foto com Read pra ver o carro. Passe em "fotos" os caminhos em uploads. Escreva o "prompt" em inglês, detalhado, sem citar formato nem tamanho (a ferramenta gera sempre o feed 1080x1080 e o story 1080x1920): (1) o carro das fotos de referência deve aparecer IDÊNTICO (mesma cor, modelo, rodas, placa, riscos e detalhes), sem inventar, trocar ou deformar nada; (2) o cenário/estilo pedido; (3) textos curtos em português do Brasil, entre aspas, exatamente como o usuário pediu (nome do carro, preço, faixa de destaque), sem criar texto extra, logos ou placas; (4) deixe o conteúdo principal no centro com margem de segurança. Depois de gerar, descreva em uma frase o resultado e pergunte se quer ajuste. Para ajustar, chame de novo com o prompt corrigido e a arte anterior (caminho em artes/) como foto de referência extra. Nunca diga que a arte está perfeita: avise se notar defeito no carro ou no texto.
- Modelo de copy:\n${copyMd}`;

// Toda gravação na Meta passa pelo n8n (workflow "Agente: Escrever na Meta"); o conector Meta Ads só lê.
const N8N_URL = process.env.AGENTE_N8N_URL || 'https://triadcompany-n8n.upw28y.easypanel.host/webhook/agente-escrever-meta';
const N8N_TOOL = 'mcp__gestor-n8n__escrever_meta';
const UPLOADS = path.join(__dirname, 'uploads');
const META_READ = /__ads_(get|insights|library|account_get)|offer_report$/;

// "@arquivo:/caminho" (só dentro de uploads/) vira o conteúdo em base64 — usado no campo "bytes" de /adimages.
function resolveFileRefs(params) {
  const out = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (typeof v === 'string' && v.startsWith('@arquivo:')) {
      const f = path.resolve(v.slice('@arquivo:'.length));
      if (!f.startsWith(UPLOADS + path.sep)) throw new Error('arquivo fora da pasta de uploads do painel: ' + f);
      out[k] = fs.readFileSync(f).toString('base64');
    } else out[k] = v;
  }
  return out;
}

function n8nServer(tokens) {
  return createSdkMcpServer({
    name: 'gestor-n8n',
    version: '1.0.0',
    tools: [
      tool(
        'escrever_meta',
        'ÚNICA forma de criar/alterar algo na Meta (campanha, conjunto, criativo, anúncio, vídeo, status, orçamento). Executa em sequência via n8n e devolve os resultados (ids) de cada gravação. Em um param, "{{op:N.id}}" vira o campo "id" do resultado da gravação N (0 = a primeira) desta mesma chamada. O token da Meta é aplicado automaticamente pelo painel.',
        {
          conta: z.string().describe('Conta de anúncio do cliente, ex.: act_123456 (a mesma da lista CLIENTES DO GESTOR)'),
          ops: z.array(z.object({
            path: z.string().describe('act_<ID>/campaigns | act_<ID>/adsets | act_<ID>/ads | act_<ID>/adcreatives | act_<ID>/advideos | act_<ID>/adimages para CRIAR; o id numérico do objeto para ALTERAR'),
            params: z.record(z.string(), z.any()).describe('campos do Graph API v21.0; objetos/listas podem ir como JSON'),
            label: z.string().optional(),
          })).min(1).max(20),
        },
        async ({ conta, ops }) => {
          const token = tokens[conta];
          if (!token) return { isError: true, content: [{ type: 'text', text: `Não tenho o token da Meta para a conta ${conta}. Confirme a conta na lista CLIENTES DO GESTOR.` }] };
          try {
            const body = { token, conta, ops: ops.map((o) => ({ ...o, params: resolveFileRefs(o.params) })) };
            const r = await fetch(N8N_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(110000) });
            const text = await r.text();
            let j; try { j = JSON.parse(text); } catch { j = { ok: false, error: `n8n respondeu ${r.status}: ${text.slice(0, 300)}` }; }
            return { isError: !j.ok, content: [{ type: 'text', text: JSON.stringify(j) }] };
          } catch (e) {
            return { isError: true, content: [{ type: 'text', text: 'Falha ao falar com o n8n: ' + String(e.message || e) }] };
          }
        },
      ),
    ],
  });
}

// ── Artes (geração de imagem com fotos do carro como referência) ─────────────
const ARTES = path.join(__dirname, 'artes');
fs.mkdirSync(ARTES, { recursive: true });
// Logos e cores das marcas dos clientes (o app do gestor manda pra cá: ver /api/brand).
const BRANDS = path.join(__dirname, 'brands');
fs.mkdirSync(BRANDS, { recursive: true });
function brandOf(id) {
  if (!/^[\w-]{8,64}$/.test(String(id || ''))) return null;
  try { return JSON.parse(fs.readFileSync(path.join(BRANDS, id + '.json'), 'utf8')); } catch { return null; }
}
const ARTE_MODEL = process.env.ARTE_MODEL || 'gpt-image-1';
const IMG_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

// Chave da OpenAI: variável OPENAI_API_KEY ou ~/.claude/credentials/openai.json ({"api_key":"..."})
function openaiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try { return JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude/credentials/openai.json'), 'utf8')).api_key || null; } catch { return null; }
}

function artesServer(res) {
  return createSdkMcpServer({
    name: 'gestor-artes',
    version: '1.0.0',
    tools: [
      tool(
        'gerar_arte',
        'Gera a arte de anúncio com IA a partir das fotos do carro (referência) e de um prompt em inglês. Gera SEMPRE os dois formatos: feed 1080x1080 e story 1080x1920 (2 chamadas na OpenAI, custo dobrado). Salva em artes/ e mostra no painel.',
        {
          fotos: z.array(z.string()).min(1).max(8).describe('Caminhos das fotos de referência (dentro de uploads/, artes/ ou brands/ — a logo do cliente)'),
          prompt: z.string().min(20).describe('Instrução da arte, em inglês, detalhada, sem falar de formato/tamanho (o painel acrescenta)'),
          qualidade: z.enum(['low', 'medium', 'high']).default('medium'),
        },
        async ({ fotos, prompt, qualidade }) => {
          const key = openaiKey();
          if (!key) return { isError: true, content: [{ type: 'text', text: 'Chave da OpenAI não configurada no painel. Peça ao usuário para criar ~/.claude/credentials/openai.json com {"api_key":"..."} e reiniciar o painel.' }] };
          try {
            const refs = fotos.map((f) => {
              const abs = path.resolve(f);
              if (!abs.startsWith(UPLOADS + path.sep) && !abs.startsWith(ARTES + path.sep) && !abs.startsWith(BRANDS + path.sep)) throw new Error('foto fora das pastas permitidas: ' + f);
              const mime = IMG_MIME[path.extname(abs).toLowerCase()];
              if (!mime) throw new Error('formato não suportado (use png, jpg ou webp): ' + path.basename(abs));
              return { abs, mime, data: fs.readFileSync(abs) };
            });
            const stamp = Date.now();
            const common = ' Never include any phone number, WhatsApp number, contact number or WhatsApp icon anywhere in the image.';
            const formats = [
              { id: 'feed', size: '1024x1024', out: `arte-${stamp}-feed-1080x1080.png`, extra: ' Square 1:1 composition.', post: (f, o) => run('sips', ['-z', '1080', '1080', f, '--out', o]) },
              {
                id: 'story', size: '1024x1536', out: `arte-${stamp}-story-1080x1920.png`,
                extra: ' Vertical 9:16 Instagram/Facebook story composition. The outer 8% on the left and right edges will be cropped, so keep the logo, every text and the whole car inside the central 84% of the width, and keep critical content away from the top 10% and bottom 10%.',
                // corta o centro (864x1536 = 9:16) e amplia pra 1080x1920
                post: async (f, o) => { const tmp = f + '.crop.png'; await run('sips', ['-c', '1536', '864', f, '--out', tmp]); await run('sips', ['-z', '1920', '1080', tmp, '--out', o]); fs.rmSync(tmp, { force: true }); },
              },
            ];
            const results = await Promise.allSettled(formats.map(async (fm) => {
              const form = new FormData();
              form.append('model', ARTE_MODEL);
              form.append('prompt', prompt + fm.extra + common);
              form.append('size', fm.size);
              form.append('quality', qualidade);
              form.append('n', '1');
              for (const r of refs) form.append('image[]', new Blob([r.data], { type: r.mime }), path.basename(r.abs));
              const resp = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: form, signal: AbortSignal.timeout(280000) });
              const j = await resp.json().catch(() => ({}));
              if (!resp.ok) throw new Error('OpenAI recusou: ' + (j.error?.message || resp.status));
              const b64 = j.data?.[0]?.b64_json;
              if (!b64) throw new Error('a OpenAI não devolveu imagem');
              const raw = path.join(ARTES, `.raw-${stamp}-${fm.id}.png`);
              fs.writeFileSync(raw, Buffer.from(b64, 'base64'));
              const out = path.join(ARTES, fm.out);
              try { await fm.post(raw, out); } finally { fs.rmSync(raw, { force: true }); }
              sse(res, 'image', { url: `/api/arte/${fm.out}`, name: fm.out });
              return out;
            }));
            const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
            const errs = results.filter((r) => r.status === 'rejected').map((r) => String(r.reason?.message || r.reason));
            if (!ok.length) return { isError: true, content: [{ type: 'text', text: 'Falha ao gerar a arte: ' + errs.join(' | ') }] };
            return { content: [{ type: 'text', text: `Geradas ${ok.length} arte(s), já exibidas no painel: ${ok.join(', ')}${errs.length ? '. Falhou: ' + errs.join(' | ') : ''}` }] };
          } catch (e) {
            return { isError: true, content: [{ type: 'text', text: 'Falha ao gerar a arte: ' + String(e.message || e) }] };
          }
        },
      ),
    ],
  });
}

// criar (path act_X/...) é rascunho e roda sozinho; ligar (status ACTIVE) ou mexer em status/orçamento/lance de objeto existente pede aprovação
function n8nWriteSafe(input) {
  const ops = Array.isArray(input?.ops) ? input.ops : [];
  return ops.every((o) => {
    const p = String(o?.path || '');
    const params = o?.params || {};
    if (String(params.status || '').toUpperCase() === 'ACTIVE') return false;
    if (p.includes('/')) return /^act_\d+\/(campaigns|adsets|ads|adcreatives|advideos|adimages)$/.test(p);
    return /^\d+$/.test(p) && !RISKY_INPUT.test(JSON.stringify(params));
  });
}

// ferramentas que rodam sem perguntar (leitura + criação em rascunho)
const SAFE = (n) =>
  n.startsWith(META) && (/__ads_(get|insights|library|account_get)/.test(n) || /__ads_create_(campaign|ad_set|ad|creative)$/.test(n) || /creative_upload_media$/.test(n) || /offer_report$/.test(n));
// Meta: tudo roda sozinho, menos o que põe no ar, apaga, impulsiona ou mexe em status/orçamento.
const RISKY_NAME = /activate|delete|boost|remove|disconnect/i;
const RISKY_INPUT = /status|budget|ACTIVE|ARCHIVED|DELETED|spend_cap|bid/i;
function metaOk(name, input) {
  if (!name.startsWith(META) || RISKY_NAME.test(name)) return false;
  if (/__ads_(update|creative_update)/.test(name) && RISKY_INPUT.test(JSON.stringify(input))) return false;
  return true;
}
const READ_LOCAL = new Set(['Read', 'Glob', 'Grep']);

// Bash que roda sozinho: só o fluxo de envio de vídeo (link temporário) e leituras.
// Qualquer segmento fora desta lista, ou com redirecionamento/substituição suspeita, pede aprovação.
const BASH_OK = [
  /^cd\s+\S+$/, /^(ls|pwd|echo|sleep|mkdir -p|cat|head|tail|grep|wc|file|stat|chmod \+x|which|uname)(\s|$)/,
  /^python3 -m http\.server \d+ --bind 127\.0\.0\.1$/,
  /^python3 -c "import time;\s*time\.sleep\(\d+\)"$/,
  /^\S*cloudflared tunnel --no-autoupdate --url http:\/\/127\.0\.0\.1:\d+$/, /^\S*cloudflared --version$/,
  /^curl -s[IL]?\s+(-o \S+ )?https:\/\/(github\.com\/cloudflare\/cloudflared\/releases\/\S+|[a-z0-9-]+\.trycloudflare\.com\/\S*|\$\{?U\}?\/\S*|"\$U\/\S*")(\s*\|\s*head -\d+)?$/,
  /^curl -s[IL]?\s+(-o \S+ )?https:\/\/github\.com\/cloudflare\/cloudflared\/releases\/latest\/download\/\S+$/,
  /^tar xzf \S+$/, /^kill \d+$/, /^pkill -f (cloudflared|"?http\.server 8\d{3}"?)$/,
  /^[A-Za-z_]+=\S*$/, /^A=\$\(uname -m\)$/, /^\[ .* \]$/,
];
function bashSafe(cmd) {
  if (/[`]|\$\(\s*(rm|mv|dd|sudo)|\brm\b|\bsudo\b|\bmv\b|\bdd\b|\bchmod [0-7]|>\s*\/(?!dev\/null)|\bcurl\b[^|;&]*\s-X\s|\bcurl\b[^|;&]*\s(-d|--data|-F|-T)\b|\beval\b|\bbash\b|\bsh -c\b|\bnode\b|\bnpm\b|\bgit\b|\bssh\b/.test(cmd)) return false;
  // normaliza: sleep em python vira token; $(...) simples vira SUB (o conteúdo também é checado)
  let c = cmd.replace(/python3 -c "import time;\s*time\.sleep\(\d+\)"/g, 'SLEEP');
  const inners = [];
  c = c.replace(/\$\(([^()]*)\)/g, (_, i) => { inners.push(i); return 'SUB'; });
  const split = (t) => t.split(/&&|\|\||;|\n|(?<!\|)\|(?!\|)/).map((x) => x.trim()).filter(Boolean);
  const segs = [...split(c), ...inners.flatMap(split)]
    .map((x) => x.replace(/^(for \S+ in [^;]*|done|do|then|fi|if)(?=\s|$)\s*/, '').trim()).filter(Boolean);
  const EXTRA = [/^SLEEP$/, /^break$/, /^seq \d+ \d+$/, /^U=SUB$/, /^A=SUB$/, /^SUB$/, /^curl -s[IL]?\s+"?\$\{?U\}?\/\S*"?$/];
  return segs.length > 0 && segs.every((x) => [...BASH_OK, ...EXTRA].some((re) => re.test(x)));
}

const CONV_DIR = path.join(__dirname, 'conversas');
fs.mkdirSync(CONV_DIR, { recursive: true });
const okId = (id) => typeof id === 'string' && /^[\w-]{8,64}$/.test(id);
const convPath = (id) => path.join(CONV_DIR, id + '.json');
const readConv = (id) => { try { return JSON.parse(fs.readFileSync(convPath(id), 'utf8')); } catch { return null; } };
const writeConv = (id, patch) => {
  const cur = readConv(id) || { id, title: 'Nova conversa', items: [], sessionId: null, createdAt: Date.now() };
  const next = { ...cur, ...patch, id, updatedAt: Date.now() };
  fs.writeFileSync(convPath(id), JSON.stringify(next));
  return next;
};
const listConvs = () => fs.readdirSync(CONV_DIR).filter((f) => f.endsWith('.json')).map((f) => {
  try { const c = JSON.parse(fs.readFileSync(path.join(CONV_DIR, f), 'utf8')); return { id: c.id, title: c.title, updatedAt: c.updatedAt }; } catch { return null; }
}).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);

const pending = new Map(); // id -> resolve

function sse(res, ev, data) { res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); }

function summarize(name, input) {
  const s = JSON.stringify(input);
  return s.length > 600 ? s.slice(0, 600) + '…' : s;
}

async function runChat(text, res, corsOrigin, convId, tokens = {}) {
  let sessionId = okId(convId) ? readConv(convId)?.sessionId ?? null : null;
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin, 'Vary': 'Origin' } : {}) });
  let n = 0;
  try {
    // O conector Meta conecta 2-4s DEPOIS do início da sessão; se o agente perguntar antes,
    // ele acha que o conector "caiu". Então só enviamos a mensagem quando o Meta estiver conectado.
    let q;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    async function* input() {
      const t0 = Date.now();
      let told = false;
      while (Date.now() - t0 < 30000) {
        try {
          const st = await q.mcpServerStatus();
          const m = st.find((x) => /Meta Ads/i.test(x.name));
          if (m?.status === 'connected') break;
          if (!told && Date.now() - t0 > 1500) { sse(res, 'tool', { name: 'conectando ao Meta Ads…' }); told = true; }
        } catch { /* sessão ainda iniciando */ }
        await sleep(400);
      }
      yield { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: '' };
    }
    q = query({
      prompt: input(),
      options: {
        cwd: ROOT,
        systemPrompt: { type: 'preset', preset: 'claude_code', append: SYSTEM },
        settingSources: ['project'],
        resume: sessionId ?? undefined,
        includePartialMessages: true,
        disallowedTools: ['Write', 'Edit', 'NotebookEdit'],
        mcpServers: { 'gestor-n8n': n8nServer(tokens), 'gestor-artes': artesServer(res) },
        canUseTool: async (name, input) => {
          if (name.startsWith(META) && !META_READ.test(name)) return { behavior: 'deny', message: 'Gravações na Meta só pelo n8n: use a ferramenta escrever_meta (conector Meta é só leitura).' };
          if (name === N8N_TOOL && n8nWriteSafe(input)) return { behavior: 'allow', updatedInput: input };
          if (name === 'mcp__gestor-artes__gerar_arte') return { behavior: 'allow', updatedInput: input };
          if (SAFE(name) || metaOk(name, input) || READ_LOCAL.has(name) || (name === 'Bash' && bashSafe(String(input.command || '')))) return { behavior: 'allow', updatedInput: input };
          const id = 'a' + Date.now() + '_' + n++;
          const label = name.startsWith(META) ? name.slice(META.length) : name === N8N_TOOL ? 'escrever_meta (n8n)' : name;
          sse(res, 'approval', { id, tool: label, detail: name === 'Bash' ? input.command : summarize(name, input), danger: /activate/.test(name) || /"ACTIVE"/.test(JSON.stringify(input)) });
          const ok = await new Promise((r) => pending.set(id, r));
          return ok ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'O usuário negou no painel.' };
        },
      },
    });
    for await (const m of q) {
      if (m.session_id && m.session_id !== sessionId) { sessionId = m.session_id; if (okId(convId)) writeConv(convId, { sessionId }); }
      if (m.type === 'stream_event') {
        const d = m.event?.delta;
        if (m.event?.type === 'content_block_delta' && d?.type === 'text_delta') sse(res, 'text', d.text);
      } else if (m.type === 'assistant') {
        for (const b of m.message.content) if (b.type === 'tool_use') sse(res, 'tool', { name: b.name === N8N_TOOL ? 'gravando na Meta via n8n…' : b.name.endsWith('gerar_arte') ? 'gerando a arte… (pode levar até 1 min)' : b.name.replace(META, '') });
      } else if (m.type === 'result') {
        sse(res, 'done', { error: m.is_error ? (m.result || 'erro') : null });
      }
    }
  } catch (e) {
    sse(res, 'done', { error: String(e.message || e) });
  }
  res.end();
}

const readBody = (req) => new Promise((r) => { let b = []; req.on('data', (c) => b.push(c)); req.on('end', () => r(Buffer.concat(b))); });
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!HOSTS.has(req.headers.host)) { res.statusCode = 403; return res.end('host'); }
  const origin = req.headers.origin;
  if (origin) {
    if (!ORIGINS.has(origin)) { res.statusCode = 403; return res.end('origin'); }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  try {
    if (url.pathname === '/api/ping') return res.end('ok');
    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const { text, clients, conversationId, tokens } = JSON.parse((await readBody(req)).toString());
      const ctx = Array.isArray(clients) && clients.length
        ? `CLIENTES DO GESTOR (nome | conta de anúncio | página | WhatsApp | orçamento mensal | meta de CCI em R$ mín-máx | arquivo da logo | cores da marca):\n` + clients.map((c) => { const b = brandOf(c.id); return `- ${c.name} | ${c.account} | ${c.page || '?'} | ${c.whatsapp || '?'} | ${c.budget ?? '?'} | ${c.cci || '?'} | logo: ${b?.file ? path.join(BRANDS, b.file) : 'sem logo cadastrada'} | cores da marca: ${b?.colors?.length ? b.colors.join(' ') : '?'}`; }).join('\n') + '\n\n'
        : '';
      return runChat(ctx + text, res, origin, conversationId, tokens && typeof tokens === 'object' ? tokens : {});
    }
    if (req.method === 'POST' && url.pathname === '/api/approve') {
      const { id, allow } = JSON.parse((await readBody(req)).toString());
      pending.get(id)?.(!!allow); pending.delete(id);
      return res.end('ok');
    }
    if (req.method === 'POST' && url.pathname === '/api/reset') return res.end('ok');
    const cm = url.pathname.match(/^\/api\/conversations(?:\/([\w-]+))?$/);
    if (cm) {
      res.setHeader('Content-Type', 'application/json');
      const id = cm[1];
      if (!id && req.method === 'GET') return res.end(JSON.stringify(listConvs()));
      if (!okId(id)) { res.statusCode = 400; return res.end('{}'); }
      if (req.method === 'GET') { const c = readConv(id); if (!c) { res.statusCode = 404; return res.end('{}'); } return res.end(JSON.stringify({ id: c.id, title: c.title, items: c.items })); }
      if (req.method === 'POST') { const { title, items } = JSON.parse((await readBody(req)).toString()); writeConv(id, { title: String(title || 'Conversa').slice(0, 80), items: Array.isArray(items) ? items : [] }); return res.end('{"ok":true}'); }
      if (req.method === 'DELETE') { try { fs.unlinkSync(convPath(id)); } catch {} return res.end('{"ok":true}'); }
    }
    const am = url.pathname.match(/^\/api\/arte\/([\w.\-]+\.png)$/);
    if (req.method === 'GET' && am) {
      const f = path.join(ARTES, am[1]);
      if (!fs.existsSync(f)) { res.statusCode = 404; return res.end('404'); }
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `inline; filename="${am[1]}"`);
      return res.end(fs.readFileSync(f));
    }
    if (req.method === 'POST' && url.pathname === '/api/brand') {
      const { id, colors, logo } = JSON.parse((await readBody(req)).toString());
      const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(String(logo || ''));
      if (!okId(id) || !m) { res.statusCode = 400; return res.end('bad'); }
      const file = id + (m[1] === 'jpeg' ? '.jpg' : '.' + m[1]);
      fs.writeFileSync(path.join(BRANDS, file), Buffer.from(m[2], 'base64'));
      fs.writeFileSync(path.join(BRANDS, id + '.json'), JSON.stringify({ file, colors: Array.isArray(colors) ? colors.filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 5) : [] }));
      return res.end('ok');
    }
    if (req.method === 'POST' && url.pathname === '/api/upload') {
      const name = path.basename(url.searchParams.get('name') || 'video.mp4').replace(/[^\w.\-]/g, '_');
      const dest = path.join(__dirname, 'uploads', name);
      fs.writeFileSync(dest, await readBody(req));
      res.setHeader('Content-Type', 'application/json');
      let transcript = null, transcriptError = null;
      if (/\.(mp4|mov|m4v|mkv|webm|mp3|m4a|wav|ogg)$/i.test(name)) {
        try { transcript = await transcribe(dest); fs.writeFileSync(dest + '.txt', transcript); }
        catch (e) { transcriptError = String(e.message || e).slice(0, 300); }
      }
      return res.end(JSON.stringify({ path: dest, transcript, transcriptError }));
    }
    const file = url.pathname === '/' ? '/index.html' : url.pathname;
    const p = path.join(__dirname, 'public', path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
    if (p.startsWith(path.join(__dirname, 'public')) && fs.existsSync(p)) {
      res.setHeader('Content-Type', MIME[path.extname(p)] || 'application/octet-stream');
      return res.end(fs.readFileSync(p));
    }
    res.statusCode = 404; res.end('404');
  } catch (e) { res.statusCode = 500; res.end(String(e)); }
}).listen(PORT, '127.0.0.1', () => console.log(`Painel em http://localhost:${PORT}`));
