# PIX Management — Design Doc

**Data:** 2026-04-29  
**Status:** Aprovado

---

## Problema

O gestor de tráfego cobra clientes via PIX em ciclos diferentes (semanal, quinzenal ou mensal). Hoje não há nenhuma tela que mostre: qual é o ciclo de cada cliente, qual o valor da parcela, e quando é o próximo vencimento. A informação fica na cabeça.

## Escopo

**Incluído:**
- Página `/pix` dedicada — lista todos os clientes PIX com ciclo, parcela e próximo vencimento
- Campos novos no cadastro do cliente: investimento mensal, ciclo PIX, data de referência
- Agrupamento por urgência: vence hoje / esta semana / mais adiante
- Cards de resumo: total a cobrar hoje, esta semana, nº de clientes PIX

**Excluído:**
- Histórico de pagamentos
- Marcar cobrança como paga
- Notificações / alertas

---

## Modelo de Dados

### Campos novos na tabela `clients`

```sql
ALTER TABLE clients
  ADD COLUMN monthly_budget    numeric(10,2),
  ADD COLUMN pix_cycle         text CHECK (pix_cycle IN ('semanal','quinzenal','mensal')),
  ADD COLUMN pix_reference_day integer CHECK (pix_reference_day BETWEEN 1 AND 31),
  ADD COLUMN pix_active        boolean NOT NULL DEFAULT false;
```

**Semântica dos campos:**
- `monthly_budget` — investimento mensal total do cliente (ex: R$ 2.000)
- `pix_cycle` — frequência de cobrança (`semanal` | `quinzenal` | `mensal`)
- `pix_reference_day` — dia do mês de referência (ex: 8 → cobranças nos dias 8 e 22 se quinzenal; toda terça não cabe aqui — cliente semanal usa o dia da semana do `pix_reference_day` como âncora)
- `pix_active` — só aparece na página PIX quando `true`

### Cálculo da parcela

```
semanal    → monthly_budget ÷ 4
quinzenal  → monthly_budget ÷ 2
mensal     → monthly_budget (valor inteiro)
```

### Cálculo do próximo vencimento

A partir de hoje e do `pix_reference_day`, determinar a próxima ocorrência:

- **Mensal:** próximo `pix_reference_day` do mês (ou mês seguinte se já passou)
- **Quinzenal:** próxima ocorrência entre `pix_reference_day` e `pix_reference_day + 15` do mês
- **Semanal:** calcular o próximo dia-da-semana equivalente ao `pix_reference_day` (usando `dayOfWeek(pix_reference_day)` como âncora)

Todo o cálculo acontece no frontend, sem coluna derivada no banco.

---

## Arquitetura

### Rota nova

`src/routes/pix.tsx` — listada no TanStack Router como `/pix`

### Sidebar

Adicionar item "PIX" entre "Saldos" e "Tarefas" no componente de navegação (`__root.tsx` ou componente de sidebar).

### Query

```typescript
// src/lib/queries.ts
export async function fetchPixClients(): Promise<PixClient[]>
// filtra clients onde pix_active = true
// retorna campos: id, name, monthly_budget, pix_cycle, pix_reference_day
```

### Tipos novos

```typescript
// src/lib/database.types.ts (e integrations/supabase/types.ts)
// adicionar campos em clients.Row:
monthly_budget: number | null;
pix_cycle: 'semanal' | 'quinzenal' | 'mensal' | null;
pix_reference_day: number | null;
pix_active: boolean;
```

### Componentes da página `/pix`

```
PixPage
├── SummaryCards (hoje / esta semana / total clientes)
├── PixTable
│   ├── SectionLabel ("Vencem hoje" / "Esta semana" / "Mais adiante")
│   └── PixRow (cliente, badge ciclo, parcela, próximo PIX)
└── (empty state se nenhum cliente tem pix_active = true)
```

### Atualização do cadastro do cliente

Em `src/routes/clients.$id.tsx`, adicionar seção "Cobrança PIX" com:
- Toggle `pix_active`
- Campo `monthly_budget` (numérico, R$)
- Select `pix_cycle` (Semanal / Quinzenal / Mensal)
- Campo `pix_reference_day` (número 1–31)

---

## Design Visual

Referência: `.superpowers/brainstorm/33522-1777483643/content/pix-design-premium.html`

- Dark theme alinhado com o restante do app (`#0a0a0f` background)
- Fontes: Syne (headings) + JetBrains Mono (dados numéricos)
- Accent: teal `#2dd4bf`
- Badges de ciclo: Semanal = violeta, Quinzenal = sky blue, Mensal = laranja
- Linha "Hoje": borda esquerda vermelha + background levemente diferente
- Cor do "Próximo PIX": vermelho se hoje, laranja se ≤ 7 dias, cinza se mais distante

---

## Ordem de Implementação

1. SQL migration — adicionar campos em `clients`
2. Atualizar tipos TypeScript (`database.types.ts` + `types.ts`)
3. Adicionar `fetchPixClients` em `queries.ts`
4. Criar `src/routes/pix.tsx`
5. Registrar rota no router
6. Adicionar "PIX" na sidebar
7. Adicionar seção PIX em `clients.$id.tsx`
