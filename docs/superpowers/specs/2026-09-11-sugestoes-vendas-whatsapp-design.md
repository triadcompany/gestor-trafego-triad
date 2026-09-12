# Sugestões de venda a partir do WhatsApp — design

## Motivação

Hoje registrar uma venda exige: abrir o cliente em Vendas → abrir o drawer →
preencher data/valor/obs → salvar. Na prática, o gestor já fica sabendo que
uma venda aconteceu porque alguém escreve isso no grupo do cliente no
WhatsApp ("vendi o Corolla", "fechou com o cliente"). O pedido do usuário foi
tornar o registro de venda mais prático — a direção escolhida foi detectar
essas menções automaticamente e poupar o trabalho manual na maioria dos
casos, mantendo um humano no laço pra não poluir os números de meta e
faturamento com falso positivo.

## Visão geral

A cada tick de automações (já roda de 5 em 5 minutos, disparado pelo cron do
n8n em `/api/automations/tick`), o servidor varre o grupo de WhatsApp de
cada cliente ativo com grupo vinculado, procurando mensagens novas desde a
última varredura que batam com as mesmas palavras-chave de venda já usadas
no Resumidor de Grupo (`vendi`, `vendeu`, `fechou`, `fechei`). Cada mensagem
que bate vira uma **sugestão pendente** — não cria uma venda de verdade.

Na página **Vendas**, um painel no topo lista as sugestões pendentes do
gestor (respeitando a mesma isolação por gestor já existente: member só vê
sugestões de clientes que ele é dono; admin vê todas). Pra cada uma:

- **Confirmar** abre o drawer do cliente já no formulário "Nova venda", com
  a data preenchida (dia da mensagem) e a observação preenchida com o trecho
  detectado. O gestor só confere/ajusta o valor (continua opcional, como
  hoje) e salva. Ao salvar, a sugestão correspondente é marcada como
  confirmada e vinculada ao id da venda criada.
- **Descartar** marca a sugestão como descartada sem criar nada — usada pra
  falso positivo (ex.: "não vendi ainda", "vendi meu carro pessoal",
  brincadeiras que contêm a palavra).

Nenhuma venda é criada sem uma ação explícita do gestor.

## Modelo de dados

### Tabela nova `sale_suggestions`

| coluna | tipo | notas |
|---|---|---|
| `id` | uuid pk | |
| `client_id` | uuid, fk `clients.id` (cascade) | organização vem por aqui (join), igual `sales` hoje |
| `message_text` | text | trecho da mensagem (até ~300 chars) |
| `message_at` | timestamp | horário da mensagem no WhatsApp |
| `status` | text | `pending` \| `confirmed` \| `dismissed`, default `pending` |
| `sale_id` | uuid nullable, fk `sales.id` (set null on delete) | preenchido ao confirmar |
| `created_at` | timestamp default now | |

Índice único em (`client_id`, `message_at`, `message_text`) — rede de
segurança contra reprocessar a mesma mensagem duas vezes se o checkpoint
falhar de salvar por algum motivo.

### Coluna nova em `clients`

`last_sale_scan_at: timestamp nullable` — data/hora da mensagem mais recente
já processada pra esse cliente. A varredura só olha mensagens com
`messageTimestamp` maior que esse valor; ao final de cada varredura bem
sucedida do cliente, atualiza pra o timestamp da mensagem mais recente vista
(mesmo que nenhuma tenha batido com a palavra-chave — isso evita reprocessar
o grupo inteiro todo tick). `NULL` (cliente nunca escaneado) começa a olhar
só a partir de agora (não varre o histórico inteiro do grupo de uma vez).

## Mecanismo de varredura

Nova função `scanClientsForSaleSuggestions()` em `automations-core.ts`,
chamada no fim de `runAutomationsTick()` (mesmo tick, sem workflow novo no
n8n). Roda pra TODAS as organizações, sem escopo de sessão — mesmo padrão
já usado pelo restante do tick.

Para cada cliente ativo com `whatsapp_group_id` preenchido:

1. Resolve a instância de WhatsApp da organização via `pickWhatsappInstance`
   (mesma função já usada pelas automações — não precisa de uma regra).
2. `POST {url}/chat/findMessages/{instance}` com
   `{ where: { key: { remoteJid: groupId } }, limit: 100 }` — mesmo
   endpoint/formato já usado em `buildGroupSummaryText`.
3. Filtra: `key.fromMe === false` e `messageTimestamp > last_sale_scan_at`
   (ou tudo, na primeira varredura, mas só pra atualizar o checkpoint —
   não gera sugestão retroativa no primeiro scan).
4. Pra cada mensagem restante, roda a mesma checagem de palavra-chave do
   Resumidor de Grupo (`classifySummary`/`SUMMARY_RULES`, filtrando só o
   tipo `venda`). Se bater, insere uma linha em `sale_suggestions`
   (`ON CONFLICT DO NOTHING` no índice único).
5. Atualiza `clients.last_sale_scan_at` pro maior `messageTimestamp` visto
   nesse lote (independente de ter gerado sugestão).
6. Erros de leitura de um grupo (grupo apagado, instância fora do ar) são
   isolados por cliente — não interrompem a varredura dos demais.

`TickResult` ganha um campo `saleSuggestionsCreated: number` pra
visibilidade no log do tick.

## Servidor: `src/server/sale-suggestions.ts` (novo)

- `fetchPendingSaleSuggestions(): Promise<SaleSuggestionRow[]>` — filtra por
  `status = 'pending'` e pela mesma condição de acesso por gestor
  (`clientAccessCondition`) usada em `queries.ts`. Retorna cliente, texto,
  data.
- `dismissSaleSuggestion(id: string): Promise<void>` — valida posse do
  cliente (via `canAccessClient`) e seta `status = 'dismissed'`.

## Cliente: fluxo de confirmação

`createSale` (em `src/lib/queries.ts`) ganha um campo opcional
`fromSuggestionId?: string` no payload. No handler, depois de inserir a
venda, se `fromSuggestionId` vier preenchido: valida que a sugestão existe,
pertence a esse `client_id` e está `pending`; se sim, atualiza ela pra
`status = 'confirmed', sale_id = <id da venda criada>`. Sem validação extra
de UI — o `ClientDrawer` já abre pro cliente certo.

Na página Vendas, o painel de sugestões abre o `ClientDrawer` do cliente
correspondente com `startWithForm = true` e dois novos props opcionais pra
pré-preencher o formulário: `prefillDate` (data da mensagem) e
`prefillObs` (texto detectado, prefixado com algo como
`"Detectado no WhatsApp: "`), mais o `suggestionId` pra passar adiante no
`createSale`. O botão "Descartar" chama `dismissSaleSuggestion` direto,
sem abrir o drawer. Tanto confirmar (sucesso do `createSale`) quanto
descartar invalidam a query de sugestões pendentes, pra sumir da lista na
hora sem precisar recarregar a página.

## UI

Painel novo no topo da página Vendas, entre o cabeçalho e os cards de
resumo — só aparece quando há sugestões pendentes:

```
🟢 Sugestões do WhatsApp (2)
┌──────────────────────────────────────────────────┐
│ Auto Motors 2 · há 3h                             │
│ "vendi o Corolla pra aquele cliente do sábado"    │
│                          [Descartar]  [Confirmar] │
├──────────────────────────────────────────────────┤
│ ...                                                │
└──────────────────────────────────────────────────┘
```

## Fora de escopo (v1)

- Registrar valor automaticamente (mensagens de texto não trazem preço de
  forma confiável) — o gestor sempre confere o valor na confirmação.
  Não vamos tentar extrair R$ do texto da mensagem.
- Badge de contagem na navegação lateral (Vendas no menu) — cosmético,
  pode entrar depois se fizer falta.
- Editar a lista de palavras-chave pela UI — continua compartilhada com o
  Resumidor de Grupo (`SUMMARY_RULES`), hardcoded.
- Rodar a varredura fora do tick de automações (ex.: em tempo real via
  webhook do Evolution) — o intervalo de 5 minutos do tick já existente é
  suficiente.

## Migração

Uma migração: `CREATE TABLE sale_suggestions` + `ALTER TABLE clients ADD
COLUMN last_sale_scan_at`. Gerada via `drizzle-kit generate`, aplicada
manualmente via psql no console do EasyPanel (fluxo já em uso no projeto).
