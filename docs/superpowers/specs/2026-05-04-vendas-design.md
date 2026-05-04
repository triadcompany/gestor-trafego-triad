# Área de Vendas — Design Spec

**Data:** 2026-05-04
**Status:** Aprovado pelo usuário

---

## Contexto

O Gestor de Tráfego gerencia Meta Ads para múltiplos clientes. "Venda" neste sistema significa uma conversão de lead em cliente para os negócios anunciantes — ou seja, alguém que viu o anúncio, entrou em contato e comprou. A equipe da agência registra as vendas manualmente, por cliente.

---

## O que será construído

Nova página `/vendas` acessível pelo menu lateral, com:

1. Cards de resumo geral no topo
2. Tabela de clientes com progresso por meta
3. Painel lateral (drawer) por cliente com histórico e formulário de nova venda
4. Edição de meta diretamente inline na tabela

---

## Banco de dados

### Tabela `sales`

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | — |
| `client_id` | uuid FK → clients | Cliente ao qual a venda pertence |
| `date` | date | Data da venda (obrigatório) |
| `value` | numeric nullable | Valor em R$ (opcional) |
| `obs` | text nullable | Observação livre (opcional) |
| `created_at` | timestamptz | — |

RLS: `allow all` (autenticado).

### Tabela `sales_goals`

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | — |
| `client_id` | uuid FK → clients | — |
| `month` | text | Formato `YYYY-MM` (ex: `2026-05`) |
| `goal` | integer | Meta de quantidade de vendas |
| `created_at` | timestamptz | — |
| UNIQUE | `(client_id, month)` | Uma meta por cliente por mês |

RLS: `allow all` (autenticado).

---

## Filtro de período

Mesmas opções já usadas no dashboard:

- Hoje / Ontem / Esta semana / Este mês / Mês passado / Máximo / Personalizado

A meta usada para comparação é sempre a do mês corrente do período selecionado. Para períodos que cruzam meses (ex: "últimos 30 dias"), usa-se a meta do mês mais recente.

---

## Página `/vendas`

### Header
- Título "Vendas" + seletor de período (dropdown igual ao dashboard)
- Botão "＋ Registrar venda" abre um popover/combobox para selecionar o cliente, depois abre o drawer daquele cliente com o formulário já expandido

### Cards de resumo (3 cards)

| Card | Conteúdo |
|---|---|
| Total de vendas | Soma de todas as vendas no período + barra de progresso vs soma das metas |
| Faturado estimado | Soma dos valores informados + contagem de vendas com valor |
| Clientes no alvo | Quantidade de clientes com ≥ 80% da meta atingida |

### Tabela de clientes

Colunas: **Cliente** · **Vendas** · **Meta** · **Progresso** · **Faturado** · **Ações**

- Ordenação padrão: por progresso ascendente (clientes mais críticos primeiro)
- Barra de progresso com glow colorido: verde (≥ 100%), amarelo (50–99%), vermelho (< 50%)
- Número de vendas colorido pelo mesmo critério de status
- Coluna Meta: exibe o número da meta do mês corrente; se não definida, mostra botão inline "+ definir"
- Ao clicar no número da meta (ou no botão "+ definir"), o campo vira um `<input>` inline com botões ✓ e ✕
- Salvar a meta chama upsert em `sales_goals` com `month = YYYY-MM` do período ativo
- Coluna Ações: botão "＋ venda" e link "histórico" — ambos abrem o drawer do cliente

### Clientes sem meta
- Aparecem ao final da tabela (após todos os que têm meta definida)
- Sem barra de progresso; texto "sem meta" no lugar do progresso

---

## Drawer (painel lateral)

Abre pela direita ao clicar em "histórico" ou "+ venda" de qualquer cliente.

### Estrutura
1. **Header:** nome do cliente + período visualizado + botão fechar
2. **Mini resumo:** 2 cards (vendas/meta do mês · faturado estimado)
3. **Formulário de nova venda:**
   - Data (obrigatório, padrão = hoje)
   - Valor em R$ (opcional)
   - Observação (opcional, textarea)
   - Botões: "Salvar venda" / "Cancelar"
4. **Lista de registros** (scroll): cada item mostra data, observação e valor (ou "—"), com botão "✕ remover"

### Comportamento
- Ao salvar, insere em `sales` e refaz as queries da tabela principal
- Ao remover, soft-delete não é necessário — delete direto
- O drawer respeita o período do filtro da página: mostra só vendas do período selecionado
- Formulário sempre começa aberto quando o acesso veio pelo botão "+ venda"; começa colapsado quando veio por "histórico"

---

## Queries necessárias (src/lib/queries.ts)

```typescript
// Busca vendas de todos os clientes no período
fetchSales(since: string, until: string): Promise<SaleRow[]>

// Busca vendas de um cliente específico
fetchSalesByClient(clientId: string, since: string, until: string): Promise<SaleRow[]>

// Cria uma venda
createSale(payload: { client_id, date, value?, obs? }): Promise<void>

// Remove uma venda
deleteSale(id: string): Promise<void>

// Busca metas do mês atual para todos os clientes
fetchSalesGoals(month: string): Promise<SalesGoalRow[]>

// Upsert de meta
upsertSalesGoal(clientId: string, month: string, goal: number): Promise<void>
```

---

## Rota e navegação

- Nova rota: `src/routes/vendas.tsx`
- Adicionar item "Vendas" no `AppShell.tsx` com ícone `TrendingUp` (lucide-react)

---

## Design visual

- Segue o padrão dark do sistema
- Cards com gradiente colorido temático (verde, índigo, âmbar) e círculo decorativo
- Barras de progresso com glow (`box-shadow`) proporcional ao status
- Número de vendas em destaque (font-size maior, colorido por status)
- Drawer estilo sheet deslizante da direita

---

## Fora de escopo

- Importação automática de vendas via Meta (ex: pixel de compra) — manual apenas
- Notificações/alertas quando meta não é atingida
- Exportação para CSV/PDF
- Histórico de edições de meta
