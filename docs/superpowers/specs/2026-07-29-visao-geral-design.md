# Visão Geral — Design Spec

**Data:** 2026-07-29
**Status:** Aprovado pelo usuário

---

## Contexto

O Gestor de Tráfego administra campanhas Meta Ads de ~34 clientes. Hoje, pra saber se alguma campanha está com problema (CPL alto, sem entrega, verba acabando), é preciso entrar cliente por cliente e conferir manualmente — não existe uma visão consolidada do portfólio inteiro.

Essa é a fase 1 de uma iniciativa maior de melhorar gestão de campanhas, decidida em conjunto com o usuário. As próximas fases (não cobertas aqui):
- **Fase 2** — ações rápidas de edição (pausar/duplicar em lote, atalhos de orçamento) direto na lista de atenção.
- **Fase 3** — contexto histórico/tendência (comparação com período anterior, mini-gráficos) na tabela de campanhas de cada cliente.

## O que será construído

Nova página **`/visao-geral`**, acessível por um item novo no menu lateral posicionado **antes de "Dashboard"** (ícone de sino/alerta, com contador de itens críticos). Não substitui nem altera o Dashboard atual.

A página lista, para todos os clientes ativos, os itens que precisam de atenção agora, agrupados por severidade (🔴 Críticos primeiro, depois 🟡 Atenção). Cada item mostra cliente, tipo de alerta, campanha (quando aplicável), detalhe textual e o valor relevante. Clicar num item navega para `/clients/$id`, reaproveitando o mecanismo `openCampaignId` que já existe hoje (usado pelo link "Ver no Meta") pra abrir a campanha certa direto no `CampaignSheet` quando aplicável.

Sem ações inline nesta fase — só navegação. Se não houver nenhum item, mostra um estado vazio positivo ("Tudo sob controle").

## Critérios de alerta

| Critério | Severidade | Condição |
|---|---|---|
| CPL acima da meta | 🟡 Atenção / 🔴 Crítico | Campanha ativa com `cpl > clients.cpl_max` (atenção) ou `cpl > clients.cpl_max × 1.3` (crítico) — mesma régua já usada no status do cliente no Dashboard |
| Sem entrega | 🟡 Atenção | Campanha com `status = ACTIVE` e `spend = 0` no snapshot do dia |
| Saldo acabando | 🔴 Crítico | `clients.meta_balance` menor que o gasto médio diário do cliente nos últimos 7 dias (`metrics_daily`) |

Só considera clientes com `active = true`. Campanhas pausadas nunca geram alerta.

## Banco de dados

### Tabela nova `campaign_snapshots`

Cache por campanha, atualizado pelo mesmo sync horário que já popula `metrics_daily` — a página lê do Postgres, nunca ao vivo do Meta (evita 34 chamadas à API a cada visita e mantém a página rápida). Dado pode ter até ~1h de atraso, aceitável pra esse caso de uso.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | uuid, PK | `gen_random_uuid()` |
| `client_id` | uuid, FK → `clients(id)` ON DELETE CASCADE | |
| `campaign_id` | text | ID da campanha no Meta |
| `name` | text | |
| `status` | text | `ACTIVE` / `PAUSED` / etc. |
| `daily_budget` | numeric(10,2), nullable | |
| `spend` | numeric(10,2), default 0 | |
| `leads` | integer, default 0 | |
| `forms` | integer, default 0 | |
| `cpl` | numeric(10,2), nullable | calculado no upsert (mesma fórmula de `metrics_daily.cpl`) |
| `impressions` | integer, default 0 | |
| `clicks` | integer, default 0 | |
| `synced_at` | timestamptz, default now() | |

Constraint: `UNIQUE(client_id, campaign_id)` (upsert por esse par).

### Extensão do sync existente

`syncClientMetrics` (chamada por `syncAllClients`, hoje rodando a cada hora — ver `src/server/meta-sync.ts` / `src/lib/meta.ts`) passa a também chamar `fetchCampaigns(adAccountId, token, "today")` por cliente e fazer upsert de cada campanha em `campaign_snapshots`. Isso adiciona ~1 chamada à API do Meta por cliente por ciclo de sync (34 clientes ativos ≈ tranquilo dentro do rate limit).

## Query de agregação

Uma função de servidor nova (`fetchAttentionItems`, seguindo o padrão `createServerFn` já usado no resto do app) monta a lista combinando:

1. `campaign_snapshots` join `clients` — CPL acima da meta e sem entrega
2. `clients` join com média de gasto dos últimos 7 dias (`metrics_daily`) — saldo acabando

Retorna uma lista já ordenada por severidade, com o formato necessário pra renderizar cada card (cliente, tipo, campanha, detalhe, valor, link).

## Interface

- Item de menu novo em `AppShell.tsx`, antes de "Dashboard", com badge de contagem de críticos (mesmo padrão visual dos badges já usados no app)
- Página nova `src/routes/visao-geral.tsx`
- Layout: cabeçalho + linha de stats (Críticos / Atenção) + grupos de cards por severidade + estado vazio quando não há alertas
- Cores/severidade reaproveitam a paleta já usada no Dashboard (verde/amarelo/vermelho)

## Fora de escopo (fases futuras)

- Ações rápidas (pausar, ajustar orçamento) direto na lista
- Comparação com período anterior / tendência
- Alertas configuráveis por cliente (limites customizados de CPL/saldo)
- Notificações push/e-mail — por enquanto é só uma página pra consultar
