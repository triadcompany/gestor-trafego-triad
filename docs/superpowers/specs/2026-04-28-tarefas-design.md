# Tarefas — Design Spec

**Data:** 2026-04-28  
**Escopo:** Bloco 3 — Anotações + Controle de Relatórios  
**Status:** Aprovado pelo usuário

---

## Visão Geral

Nova página `/tarefas` com duas abas: **Anotações** e **Relatórios**. Permite ao gestor de tráfego registrar observações textuais livres por cliente e controlar o envio periódico de relatórios.

As anotações também aparecem em uma seção dedicada dentro do perfil de cada cliente (`/clients/$id`), tornando o contexto acessível no fluxo de análise por conta.

---

## Arquitetura

### Rotas

| Rota | Descrição |
|------|-----------|
| `/tarefas` | Página principal com tabs Anotações e Relatórios |
| `/clients/$id` | Perfil do cliente — recebe nova seção "Anotações" |

### Stack

- TanStack Router (rotas existentes)
- TanStack Query (fetch/mutate com cache)
- Supabase (persistência)
- shadcn/ui + Tailwind CSS
- Dark theme consistente com o restante do app

---

## Banco de Dados

### Tabela `client_notes`

```sql
create table if not exists client_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_client_notes_client on client_notes(client_id, created_at desc);
```

### Tabela `report_log`

```sql
create table if not exists report_log (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  period_type text not null check (period_type in ('semanal', 'mensal')),
  period_start date not null,
  status text not null check (status in ('pendente', 'enviado')) default 'pendente',
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_report_log_client on report_log(client_id, created_at desc);
create index if not exists idx_report_log_status on report_log(status, period_type);
```

**Regra de negócio:** `sent_at` é preenchido automaticamente com `now()` quando `status` muda de `pendente` para `enviado`.

---

## Aba Anotações

### Comportamento

- Lista todas as notas, ordenadas por `created_at desc`
- Filtro por cliente via dropdown (opcional — padrão "Todos")
- Busca por texto (client-side, filtra `content`)
- Botão "+ Nova anotação" revela composer inline (sem modal)
- Cada nota tem: badge com nome do cliente (cor única), texto, timestamp relativo, botões editar (inline) e deletar

### Criar nota

1. Selecionar cliente no select do composer
2. Digitar texto livre
3. Salvar → INSERT em `client_notes`, invalida query list

### Editar nota

- Clicar no ícone de editar transforma o card em modo edição inline
- Salvar → UPDATE em `client_notes` (atualiza `updated_at`)
- Cancelar → restaura visualização sem salvar

### Deletar nota

- Clicar no ícone de deletar → `window.confirm()` nativo ("Deletar esta anotação?")
- Se confirmado: DELETE em `client_notes`, remove da lista imediatamente via optimistic update
- Se cancelado: nenhuma ação

### Cores por cliente

As cores são atribuídas pela posição do cliente na lista ordenada alfabeticamente (índice % 5). Paleta fixa (left-border + badge bg):

| Índice | Cor | Border | Badge bg |
|--------|-----|--------|----------|
| 0 | Azul | `#4f7fff` | `#1e3a5f` |
| 1 | Roxo | `#a855f7` | `#2d1f4e` |
| 2 | Esmeralda | `#10b981` | `#1f3a2d` |
| 3 | Âmbar | `#f59e0b` | `#3a2d1f` |
| 4 | Rosa | `#f472b6` | `#3a1f2d` |

Sem configuração manual de cor por cliente neste escopo.

---

## Aba Relatórios

### Comportamento

- Tabela com todos os registros de `report_log`, ordenados por `created_at desc`
- Chips de resumo no topo: "X pendentes" (âmbar) e "Y enviados este mês" (verde)
- Status "Pendente" é um badge clicável — ao clicar, atualiza `status = 'enviado'` e `sent_at = now()` diretamente (sem modal de confirmação)
- Linhas "Enviado" são exibidas com opacidade reduzida (0.6) para hierarquia visual

### Colunas da tabela

| Coluna | Campo | Notas |
|--------|-------|-------|
| Cliente | `client_id` → `clients.name` | Texto |
| Período | `period_start` + `period_type` | Exibido como "Abr/2025" (mensal) ou "21–27 abr" (semanal) |
| Tipo | `period_type` | Badge "Mensal" / "Semanal" |
| Data envio | `sent_at` | "—" se pendente |
| Status | `status` | Badge clicável quando pendente |

### Registrar relatório (botão "+ Registrar relatório")

Abre um form simples (sheet ou inline) com:
- Select de cliente (obrigatório)
- Select de tipo: Mensal / Semanal
- Date picker para `period_start`
- Status inicial: "Pendente"

INSERT em `report_log`, invalida query list.

---

## Anotações no Perfil do Cliente (`/clients/$id`)

### Localização

Seção "Anotações" adicionada ao final do perfil do cliente, abaixo das métricas existentes.

### Comportamento

- Exibe apenas as notas do cliente atual (`client_id = params.id`)
- Mesmo composer inline do `/tarefas`, pré-selecionado para o cliente corrente
- Edição e deleção idênticas
- `client_id` é fixo — não há select de cliente no composer interno ao perfil

---

## Componentes

### Novos componentes a criar

| Componente | Localização | Responsabilidade |
|------------|-------------|-----------------|
| `NoteCard` | `src/components/NoteCard.tsx` | Exibe uma nota com edição inline |
| `NoteComposer` | `src/components/NoteComposer.tsx` | Form de criação/edição de nota |
| `ReportTable` | `src/components/ReportTable.tsx` | Tabela de relatórios com ação de marcar enviado |
| `ReportForm` | `src/components/ReportForm.tsx` | Form para registrar novo relatório |

### Queries e Mutations (lib/queries.ts)

```ts
// Notas
// Se clientId omitido: retorna todas as notas com join em clients (name, id)
// Se clientId fornecido: filtra por client_id
fetchNotes(clientId?: string): Promise<NoteWithClient[]>
createNote(payload: { client_id: string; content: string }): Promise<Note>
updateNote(id: string, content: string): Promise<Note>
deleteNote(id: string): Promise<void>

// Relatórios
fetchReports(): Promise<Report[]>
createReport(payload: ReportPayload): Promise<Report>
markReportSent(id: string): Promise<Report>
```

---

## Fora do Escopo (Bloco 3)

Os itens abaixo foram identificados como Blocos 1 e 2 e não fazem parte desta implementação:

- Checklists de rotina por cliente
- Follow-ups com data/hora e alertas visuais
- Tarefas geradas automaticamente pelo sistema (baseadas em métricas)
- Kanban de status de campanha

---

## Design Visual

Referência: `tarefas-design-v1.html` (aprovado)

- Fontes: `DM Serif Display` (título da página), `DM Mono` (badges, timestamps, dados), `Outfit` (corpo/UI)
- Fundo: `#0c0e16` com textura grain sutil via SVG filter
- Cards de nota: borda esquerda colorida por cliente (4px), fundo `#12151f`, borda `#1e2a3a`
- Composer inline: expande abaixo do botão, colapsa ao salvar/cancelar
- Animação de entrada: `fadeUp` escalonado (stagger 60ms por card)
- Responsividade: sidebar fixa desktop, mobile não é requisito neste escopo

---

## Fora do Escopo (Considerações Futuras)

- Notificações push quando relatório vence
- Filtro por período na aba Relatórios
- Exportação de relatórios
- Busca fulltext via Supabase (`tsquery`)
