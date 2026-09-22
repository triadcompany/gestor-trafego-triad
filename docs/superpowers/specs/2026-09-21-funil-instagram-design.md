# Funil de vendas via Instagram (comentário → DM) — design

## Motivação

A Triad Company (a própria agência, não um cliente) quer captar leads pelo
Instagram automaticamente: quando alguém comenta uma palavra-chave num post
específico, o sistema manda uma mensagem automática no Direct — o mesmo
mecanismo que ferramentas tipo ManyChat/Chatfuel oferecem, usando a API
oficial de "resposta privada a comentário" da Meta.

É uma ferramenta interna, só pra conta da Triad Company — não é um recurso
multi-tenant nem aparece pros clientes do sistema. Fica atrás do mesmo
`requirePlatformAdmin` já usado em `/admin/organizations`.

Escopo do v1 (decidido no brainstorming): só o gatilho comentário → DM com
uma mensagem fixa por regra, mais uma lista de leads capturados. Continuar a
conversa dentro do Direct com um fluxo de várias mensagens fica pra uma fase
2, depois que o básico estiver validado em uso real.

## Como funciona a API da Meta (contexto técnico)

- Conexão via **"Instagram Login"** (permissões `instagram_business_basic` +
  `instagram_business_manage_messages`) — não precisa vincular Página do
  Facebook, ao contrário do fluxo mais antigo.
- **Resposta privada a comentário**: 1 por comentário (não por pessoa — um
  comentário novo da mesma pessoa gera um novo direito), até 7 dias depois
  do comentário. Limite de 750/hora — irrelevante pro volume de uma conta só.
- Contas em modo "Standard Access" (sem passar pela revisão de app da Meta)
  funcionam contanto que a própria conta do Instagram esteja cadastrada como
  admin/tester do app no Meta for Developers — suficiente pro caso de uso
  (uma conta só, da própria agência).
- Token de longa duração expira a cada ~60 dias e precisa ser renovado
  manualmente (mesmo comportamento que o token do Meta Ads já tem hoje no
  sistema).
- A assinatura do campo `comments` no webhook é feita uma única vez, fora do
  código, no painel do app em Meta for Developers (Webhooks → Instagram →
  assinar campo `comments`, apontando pra URL do endpoint novo) — não é algo
  que o sistema configura sozinho via API.

## Modelo de dados

### Tabela nova `instagram_connections`

| coluna | tipo | notas |
|---|---|---|
| `id` | uuid pk | |
| `organization_id` | uuid, fk `organizations.id` (cascade) | sempre a organização da Triad Company |
| `instagram_business_account_id` | text | ID da conta Instagram (não o @usuário) |
| `access_token` | text | token de longa duração, texto puro — mesmo padrão de `meta_tokens.access_token` hoje |
| `expires_at` | timestamp nullable | pra mostrar aviso de expiração próxima na tela |
| `active` | boolean default true | |
| `created_at` | timestamp default now | |

Só uma linha ativa esperada na prática, mas sem constraint de unicidade —
mesma filosofia de `meta_tokens` (permite trocar sem apagar o histórico).

### Tabela nova `instagram_funnel_rules`

| coluna | tipo | notas |
|---|---|---|
| `id` | uuid pk | |
| `organization_id` | uuid, fk `organizations.id` (cascade) | |
| `post_id` | text | ID da mídia no Instagram |
| `post_thumbnail_url` | text nullable | cacheado no momento da criação da regra, só pra exibir na lista sem rebuscar na API toda hora |
| `post_permalink` | text nullable | link do post, pra abrir no Instagram direto da tela |
| `keyword` | text | comparação case-insensitive, "contém" (mesmo critério já usado em `classifySummary`) |
| `message` | text | texto fixo enviado no DM |
| `active` | boolean default true | |
| `created_at` | timestamp default now | |

### Tabela nova `instagram_funnel_leads`

| coluna | tipo | notas |
|---|---|---|
| `id` | uuid pk | |
| `rule_id` | uuid, fk `instagram_funnel_rules.id` (cascade) | |
| `comment_id` | text | ID do comentário na Meta — índice único junto com `rule_id`, evita processar o mesmo comentário duas vezes se o webhook reentregar o evento |
| `ig_username` | text nullable | nem sempre vem no payload do webhook |
| `ig_user_id` | text | ID numérico do Instagram de quem comentou |
| `comment_text` | text | texto do comentário que bateu com a palavra-chave |
| `status` | text | `sent` \| `failed`, default calculado no momento da inserção |
| `error_message` | text nullable | preenchido quando `status = failed` (token expirado, comentário fora da janela de 7 dias, etc.) |
| `created_at` | timestamp default now | |

Índice único em (`rule_id`, `comment_id`).

## Servidor

### `src/server/instagram-funnel.ts` (novo, server-only)

- `fetchInstagramConnection()` / `upsertInstagramConnection(data)` — igual
  ao par já existente pra `meta_tokens`, atrás de `requirePlatformAdmin`.
- `fetchRecentInstagramPosts()` — chama `GET /{ig-business-id}/media` com o
  token salvo, retorna id + thumbnail + permalink + caption (só quando a
  tela de criar regra abre — sem sincronização automática).
- `fetchFunnelRules()` / `createFunnelRule(data)` / `toggleFunnelRule(id, active)`
  / `deleteFunnelRule(id)` — CRUD simples, atrás de `requirePlatformAdmin`.
- `fetchFunnelLeads()` — lista paginada/recente pra tela de leads, com nome
  da regra (join) e link pro post.

### `src/server/instagram-webhook.ts` + `instagram-webhook.route.ts` (novo)

Espelha exatamente o padrão de `evolution-webhook.ts` /
`evolution-webhook.route.ts`, adaptado às particularidades do webhook da
Meta:

- **Verificação de assinatura**: handler `GET` responde o handshake de
  assinatura do webhook (`hub.mode=subscribe`, `hub.verify_token`,
  `hub.challenge`) comparando `hub.verify_token` contra uma env var nova
  (`INSTAGRAM_WEBHOOK_VERIFY_TOKEN`) — necessário só uma vez, na hora de
  cadastrar o webhook no painel da Meta.
- **Handler `POST`**: valida o header `X-Hub-Signature-256` (HMAC-SHA256 do
  corpo cru com o App Secret da Meta, env var `INSTAGRAM_APP_SECRET`) antes
  de processar qualquer coisa — payload sem assinatura válida é rejeitado
  com 401.
- Corpo validado, extrai eventos do tipo `comments` (novo comentário em
  mídia). Pra cada evento:
  1. Busca regras ativas com `post_id` igual ao da mídia do comentário.
  2. Se alguma regra tiver `keyword` contida no texto do comentário
     (case-insensitive), chama
     `POST /{ig-business-id}/messages` com o payload de resposta privada
     (`recipient: { comment_id }`, `message: { text: rule.message }`).
  3. Grava o resultado em `instagram_funnel_leads` (`ON CONFLICT DO NOTHING`
     no índice único `rule_id + comment_id`, mesma proteção contra
     reentrega que `sale_suggestions` já usa).
  4. Erro ao chamar a API da Meta (token expirado, comentário fora da
     janela de 7 dias, etc.) não derruba o processamento dos demais
     comentários do mesmo payload — grava o lead com `status = failed` e o
     motivo, sempre retorna 200 pra Meta (evita reenvio em loop por erro
     nosso, mesma lógica do webhook da Evolution).
- Registrado em `vite.config.ts` nos `handlers` do Nitro, igual aos outros
  dois webhooks já existentes:
  `{ route: "/api/webhooks/instagram", method: ["GET", "POST"], handler: "./src/server/instagram-webhook.route.ts" }`

## Cliente / UI

Tudo atrás de `requirePlatformAdmin`, sem aparecer pra organizações comuns.
Duas rotas novas em `/admin`:

### `admin.instagram-conexao.tsx`

Formulário simples (Instagram Business Account ID + Access Token), com
texto de ajuda explicando os passos pra gerar o token (Meta for Developers
→ app → Instagram Login → gerar token de longa duração) e um aviso quando
`expires_at` estiver a menos de 7 dias — mesmo padrão visual da seção
"Webhook n8n" que já existe em Configurações.

### `admin.instagram-funil.tsx`

Duas abas (reaproveitando `Tabs`/`TabsList` já usados em Mensagens):

**Regras** — lista as regras existentes (post + palavra-chave + status
ativo/pausado) com botão "Nova regra": abre um diálogo que busca os posts
recentes (grade com thumbnail, igual a um seletor de mídia), escolhe um,
digita a palavra-chave e a mensagem.

**Leads** — tabela com usuário do Instagram, regra que ativou, trecho do
comentário, quando foi enviado, status (enviado/falhou) — mesmo padrão
visual da tabela de leads em Rastreamento (`LeadsDashboard`), sem os botões
de qualificar/converter (não tem esse conceito aqui em v1).

Link de acesso: entrada nova no menu lateral (`AppShell`), dentro de um
grupo "Admin" visível só quando `isPlatformAdmin` (hoje não existe nenhuma
entrada de admin no menu — acesso era só por URL direta).

## Fora de escopo (v1)

- Continuar a conversa dentro do Direct depois da primeira mensagem
  (fluxo com múltiplas etapas/ramificações) — fase 2.
- Mensagens com variáveis ({{nome}}, {{link}}) — texto fixo por regra.
- Renovação automática do token de longa duração — renovação manual,
  mesmo fluxo que o token do Meta Ads.
- Editar/reenviar um lead que falhou — só fica registrado com o motivo.
- Deletar o comentário público depois de responder — a resposta privada
  não mexe no comentário original.

## Migração

Uma migração: `CREATE TABLE instagram_connections`,
`CREATE TABLE instagram_funnel_rules`, `CREATE TABLE instagram_funnel_leads`.
Gerada via `drizzle-kit generate`, aplicada manualmente via psql no console
do EasyPanel (fluxo já em uso no projeto).

## Variáveis de ambiente novas

- `INSTAGRAM_APP_SECRET` — App Secret do app Meta for Developers, pra
  validar a assinatura do webhook.
- `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` — string arbitrária definida por nós,
  usada só no handshake de verificação do webhook.
