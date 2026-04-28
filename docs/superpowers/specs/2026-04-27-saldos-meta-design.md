# Saldos Meta — Design Spec

**Data:** 2026-04-27  
**Status:** Aprovado

---

## Objetivo

Permitir que o gestor de tráfego visualize o saldo disponível em cada conta de anúncios Meta (créditos prepagos) em uma única página, sem precisar acessar cada cliente individualmente. O dashboard existente não é alterado.

---

## Fonte de dados

A Meta Graph API retorna o saldo disponível via:

```
GET /{ad-account-id}?fields=balance&access_token={token}
```

- `balance` é um inteiro em centavos (ex: `84300` = R$ 843,00)
- Disponível apenas para contas prepagos (padrão no Brasil)

---

## Estratégia de sincronização

O saldo é buscado **durante a sincronização já existente** (`syncClientMetrics`), que roda automaticamente a cada hora e também pode ser acionada manualmente. O valor é armazenado na tabela `clients` do Supabase, no campo `meta_balance` (integer, nullable).

Nenhuma chamada extra de API ocorre no carregamento das páginas — o saldo exibido é sempre o do último sync, com timestamp visível.

---

## Modelo de dados

**Migração Supabase:** adicionar coluna à tabela `clients`:

```sql
ALTER TABLE clients ADD COLUMN meta_balance integer;
```

Nullable — clientes sem saldo sincronizado ainda mostram `—`.

---

## Thresholds de criticidade

| Status   | Condição              | Cor     |
|----------|-----------------------|---------|
| Ok       | saldo ≥ R$ 500        | Verde   |
| Atenção  | R$ 200 ≤ saldo < R$ 500 | Amarelo |
| Crítico  | saldo < R$ 200        | Vermelho |

---

## Nova página: `/saldos`

Rota nova no TanStack Router. Acessível pelo menu de navegação existente (AppShell).

### Layout

**Header:**
- Título "Saldos Meta" + timestamp do último sync
- Botão "Atualizar agora" que dispara o sync manual e refetch

**Cards de resumo (3 colunas):**
1. Total disponível (soma de todos os saldos)
2. Contas críticas (count de saldo < R$200)
3. Em atenção (count de R$200–R$500)

**Tabela de clientes** (ordenada: crítico → atenção → ok):

| Coluna        | Detalhe                                                  |
|---------------|----------------------------------------------------------|
| Cliente       | Avatar com iniciais colorido + nome + segmento           |
| Saldo Meta    | Valor formatado em BRL + barra de progresso proporcional |
| Gasto hoje    | Spend do dia (já disponível em `metrics_daily`)          |
| Estimativa    | `saldo / gasto_hoje` = dias restantes (se gasto > 0)     |
| Status        | Chip colorido: Ok / Atenção / Crítico                    |

A barra de progresso é relativa ao maior saldo entre todos os clientes ativos.

A coluna "Estimativa" mostra `—` se o gasto do dia for zero.

---

## Arquivos a modificar / criar

| Arquivo | Mudança |
|---|---|
| Supabase | Migration: `ADD COLUMN meta_balance integer` |
| `src/lib/meta.ts` | Adicionar `fetchAdAccountBalance(adAccountId, token)` |
| `src/server/meta-sync.ts` | Em `syncClientMetrics`, buscar e salvar `meta_balance` em `clients` |
| `src/lib/queries.ts` | Adicionar `meta_balance` ao tipo `ClientWithToday` e `ClientRow`; nova query `fetchClientBalances()` |
| `src/routes/saldos.tsx` | Nova rota com a página completa |
| `src/components/AppShell.tsx` | Adicionar link "Saldos" na navegação |

---

## Comportamento de erro

- Se a conta Meta não retornar `balance` (ex: conta pós-pago ou erro de API), `meta_balance` fica `null` e a linha exibe `—` sem cor.
- Erros no fetch de saldo não interrompem o sync das métricas — são tratados silenciosamente com log.

---

## Fora de escopo

- Alterações no dashboard existente (cards permanecem iguais)
- Alertas por e-mail/push quando saldo fica crítico (será tratado no módulo de Alertas futuramente)
- Histórico de saldo ao longo do tempo
