# Funil visual (blocos conectáveis) pro Instagram — design

## Motivação

O funil do Instagram (spec anterior,
`2026-09-21-funil-instagram-design.md`) parava na primeira mensagem: regra
captura o comentário, manda um DM fixo, fim. O pedido agora é continuar a
conversa dentro do Direct — decidido no brainstorming original como "fase
2", agora priorizada — com um **editor visual de blocos conectáveis**
(canvas, arrastar/conectar/desconectar), no mesmo espírito de ferramentas
tipo ManyChat, mas com escopo enxuto: sem espera programada entre mensagens
e sem ação de Meta CAPI por enquanto (avaliar depois de validar em uso
real).

## Visão geral

Uma **Regra** (já existente) ganha um campo opcional "Funil" — quando
preenchido, depois de mandar a mensagem de captura (like hoje, a resposta
privada ao comentário), o lead entra nesse funil.

Um **Funil** é um grafo de blocos:

- 🟠 **Gatilho** ("Lead capturado") — ponto de entrada fixo, um por funil,
  criado automaticamente quando o funil é criado, não pode ser apagado.
- ⚙️ **Enviar mensagem** — manda um DM de texto fixo.
- 🔀 **Condição** — define uma ou mais palavras-chave (cada uma vira uma
  saída no bloco); quando a próxima resposta da pessoa no Direct bater com
  alguma, segue por aquele caminho. Sempre tem também uma saída fixa
  "Nenhuma bateu".

O funil roda em blocos "Enviar mensagem" em sequência, sem pausa entre eles,
até bater um bloco de "Condição" — aí o sistema **para e espera** a próxima
mensagem da pessoa no Direct (chega via webhook, campo `messages`, já
assinado hoje). Ao chegar, decide o próximo caminho e continua. Se a saída
escolhida (ou "Nenhuma bateu") não estiver conectada a nada, o funil
termina ali pra essa pessoa.

## Modelo de dados

### Tabela nova `instagram_funnels`

| coluna | tipo | notas |
|---|---|---|
| `id` | uuid pk | |
| `organization_id` | uuid, fk `organizations.id` (cascade) | |
| `name` | text | |
| `created_at` | timestamp default now | |

### Tabela nova `instagram_funnel_nodes`

| coluna | tipo | notas |
|---|---|---|
| `id` | uuid pk | |
| `funnel_id` | uuid, fk `instagram_funnels.id` (cascade) | |
| `type` | text | `trigger` \| `message` \| `condition` |
| `position_x` / `position_y` | integer | posição no canvas, salva pra reabrir do jeito que deixou |
| `message` | text nullable | texto do DM — só pra `type = message` |
| `condition_keywords` | jsonb default `[]` | só pra `type = condition` — array de `{ id: uuid, keyword: string }`, um por saída (fora a saída fixa "Nenhuma bateu", que não precisa de linha própria) |
| `created_at` | timestamp default now | |

### Tabela nova `instagram_funnel_edges`

| coluna | tipo | notas |
|---|---|---|
| `id` | uuid pk | |
| `funnel_id` | uuid, fk `instagram_funnels.id` (cascade) | evita join só pra escopar por organização |
| `source_node_id` | uuid, fk `instagram_funnel_nodes.id` (cascade) | |
| `source_handle` | text nullable | `null` pra Gatilho/Mensagem (saída única); pro nó de Condição, o `id` de uma entrada de `condition_keywords`, ou o literal `"default"` pra "Nenhuma bateu" |
| `target_node_id` | uuid, fk `instagram_funnel_nodes.id` (cascade) | |
| `created_at` | timestamp default now | |

Índice único em (`source_node_id`, `source_handle`) — cada saída só liga a
um destino; "desconectar" é apagar a linha, "conectar" é inserir (ou
substituir, se já tinha uma ligação ali).

### Tabela nova `instagram_funnel_sessions`

Estado de "em qual bloco de Condição essa pessoa está esperando".

| coluna | tipo | notas |
|---|---|---|
| `id` | uuid pk | |
| `organization_id` | uuid, fk `organizations.id` (cascade) | |
| `ig_user_id` | text | único por organização — uma pessoa só fica esperando em um funil por vez (se entrar em outro, sobrescreve) |
| `funnel_id` | uuid, fk `instagram_funnels.id` (cascade) | |
| `current_node_id` | uuid, fk `instagram_funnel_nodes.id` (cascade) | sempre um nó `condition` |
| `lead_id` | uuid, fk `instagram_funnel_leads.id` (cascade) | rastreabilidade até o lead original |
| `updated_at` | timestamp default now | |

Índice único em (`organization_id`, `ig_user_id`).

### Coluna nova em `instagram_funnel_rules`

`funnel_id: uuid nullable, fk instagram_funnels.id (set null on delete)` —
funil desconectado da regra se for apagado, a regra continua funcionando
(só sem continuar depois da 1ª mensagem).

## Servidor

### `src/server/instagram-funnel.ts` (extensão)

- `fetchFunnels()` / `createFunnel(name)` (já cria o nó Gatilho junto,
  posição fixa) / `renameFunnel(id, name)` / `deleteFunnel(id)`.
- `fetchFunnelGraph(funnelId)` → `{ nodes, edges }`.
- `saveFunnelGraph(funnelId, nodes, edges)` — substitui o grafo inteiro
  numa transação (apaga tudo do funil e reinsere o estado atual do canvas).
  Mais simples que sincronizar nó a nó, e o volume de dados é pequeno.
- `createFunnelRule`/`updateFunnelRule` ganham `funnel_id?: string | null`.

### `src/server/instagram-webhook.ts` (extensão)

`handleInstagramWebhook` passa a processar dois formatos de evento por
`entry`, não só `changes` (comentário):

- `entry[].changes[]` com `field = "comments"` — fluxo já existente.
- `entry[].messaging[]` — mensagem direta nova. Ignora se
  `sender.id === ig_business_account_id` (eco da nossa própria mensagem
  enviada). Chama `processIncomingMessage`.

`processIncomingMessage(igBusinessAccountId, senderId, text)`:
1. Busca sessão ativa (`instagram_funnel_sessions`) por `ig_user_id`. Sem
   sessão → não faz nada (mensagem fora de qualquer funil).
2. Carrega o nó de Condição (`current_node_id`), compara `text` (minúsculo)
   contra cada `condition_keywords[].keyword` (contém, mesmo critério de
   sempre) na ordem cadastrada; primeira que bater vence. Nenhuma bate →
   usa a saída `"default"`.
3. Busca a aresta (`source_node_id = nó atual`, `source_handle` = a
   escolhida). Sem aresta → apaga a sessão, funil termina aqui.
4. Com aresta → apaga a sessão e chama `advanceFunnel` a partir do
   `target_node_id`.

`advanceFunnel(connection, igUserId, funnelId, leadId, nodeId)` — usada
tanto ao entrar no funil pela regra quanto ao continuar depois de uma
Condição:
1. Nó `message`: manda o DM (`sendDirectMessage`, igual `sendPrivateReply`
   mas com `recipient: { id: igUserId }` em vez de `comment_id` — já não
   está mais dentro da janela de resposta a comentário, é conversa
   corrente). Busca a aresta única de saída (handle `null`); sem aresta,
   funil acaba; com aresta, chama `advanceFunnel` de novo (recursivo,
   encadeia várias mensagens seguidas sem pausa).
2. Nó `condition`: grava/atualiza a sessão (`upsert` por
   `organization_id + ig_user_id`) apontando pra esse nó, e para —
   espera a próxima mensagem chegar pelo webhook.

No handler do comentário: depois de `sendPrivateReply` e gravar o lead, se
`rule.funnelId` estiver preenchido, busca a aresta de saída do nó Gatilho
do funil e chama `advanceFunnel` a partir do destino.

## Cliente / UI

### Nova aba "Funis" em `/admin/instagram-funil`

Lista de funis (nome + botão "Editar" + excluir) e "Novo funil" (só pede o
nome, já cria com o bloco Gatilho sozinho no canvas).

### Editor visual (rota nova `/admin/instagram-funil-editor/$funnelId`, tela cheia)

Usa **React Flow** (`@xyflow/react`) — biblioteca já pensada exatamente pra
esse tipo de canvas (arrastar nó, puxar linha de uma saída até um nó pra
conectar, apagar a linha pra desconectar). 3 componentes de nó customizados
(Gatilho/Mensagem/Condição) com o visual de card com ícone + label do print
que o usuário mandou como referência.

- Nó **Mensagem**: clique abre um painel lateral/popover com o textarea do
  texto do DM.
- Nó **Condição**: painel lateral com lista de palavras-chave (adicionar/
  remover linhas), cada uma vira uma saída (`Handle` do React Flow) na
  lateral direita do card, mais uma saída fixa "Nenhuma bateu" embaixo.
- Barra de ações: "Salvar" (chama `saveFunnelGraph` com o estado atual do
  canvas) e "Voltar" (pra lista de funis, sem salvar se não clicou Salvar).

### Regra (`NewRuleDialog`/`EditRuleDialog`)

Campo novo "Funil (opcional)" — `Select` populado por `fetchFunnels()`,
com opção "Nenhum" (comportamento de hoje: só a 1ª mensagem).

## Fora de escopo (v1)

- Espera programada entre mensagens (delay/agendamento dentro do funil).
- Bloco de ação Meta CAPI (ou qualquer ação além de mandar mensagem).
- Múltiplas sessões simultâneas por pessoa em funis diferentes — a mais
  recente sempre sobrescreve.
- Desfazer/histórico de versões do funil — salvar substitui o grafo
  anterior sem guardar versões antigas.
- Editar o texto/palavras-chave de um nó fora do editor visual (não tem
  atalho pela lista de funis).

## Migração

Uma migração: `CREATE TABLE instagram_funnels`,
`CREATE TABLE instagram_funnel_nodes`, `CREATE TABLE instagram_funnel_edges`,
`CREATE TABLE instagram_funnel_sessions`,
`ALTER TABLE instagram_funnel_rules ADD COLUMN funnel_id`. Gerada via
`drizzle-kit generate`, aplicada manualmente via psql no console do
EasyPanel (fluxo já em uso no projeto).

## Dependência nova

`@xyflow/react` (React Flow) — biblioteca de canvas de nós/arestas, MIT,
sem dependência de backend próprio (só client-side).
