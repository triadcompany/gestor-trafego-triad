# Design: Agente IA — Gestor de Tráfego Secundário

**Data:** 2026-04-30  
**Status:** Aprovado

---

## Visão Geral

Um agente de IA embutido no Gestor de Tráfego que atua como gestor de tráfego secundário. Ele analisa campanhas, sugere otimizações e pode executar ações (com confirmação obrigatória do usuário) via OpenAI GPT-4o.

---

## Arquitetura

```
Frontend (React)
  ├── /agente         → página de chat dedicada
  └── AppShell        → botão flutuante de atalho em todas as páginas

API (TanStack Start — Cloudflare Workers)
  └── /api/agente/chat → rota server-side que orquestra OpenAI + ferramentas

Serviços externos
  ├── OpenAI API (GPT-4o) — chave em Cloudflare secret OPENAI_API_KEY
  ├── Meta Graph API v21.0 — token já salvo no sistema (app_config)
  └── Supabase — leitura/escrita de dados (clientes, tarefas, notas, PIX)
```

**Fluxo de uma mensagem:**

1. Usuário digita → POST `/api/agente/chat` com `{ conversation_id, message }`
2. API route monta contexto: histórico + resumo automático de clientes/alertas
3. Chama OpenAI com tool definitions (streaming)
4. OpenAI decide: responder em texto ou chamar ferramenta
   - **Ferramenta de leitura** → executa → resultado volta para OpenAI → resposta final
   - **Ferramenta de escrita** → retorna `{ type: "confirmation_required", action }` para o frontend
5. Frontend exibe card de confirmação; `pending_action` fica em estado React (não persiste no banco)
6. Usuário confirma → frontend re-envia com `{ confirm: true, pending_action }` → ação executada
7. Resposta streamada de volta ao frontend

---

## Interface

### Página `/agente`

- Item "Agente IA" na sidebar (entre Tarefas e Nova Campanha)
- Layout: sidebar esquerda com lista de conversas + área principal de chat
- Ao abrir uma conversa nova: agente envia automaticamente um resumo inicial
- Histórico de mensagens com scroll
- Input fixo no rodapé com envio por Enter ou botão

### Botão flutuante

- Presente em todas as páginas (via `AppShell`)
- Posição: canto inferior direito
- Clique: navega para `/agente` (preserva conversa ativa se houver)

### Card de confirmação

Aparece inline na conversa quando o agente quer executar uma ação:

```
┌─────────────────────────────────────────┐
│ ⚠ Confirmação necessária                │
│ [descrição legível da ação]             │
│ [detalhes: cliente, valores, etc.]      │
│ [Confirmar]  [Cancelar]                 │
└─────────────────────────────────────────┘
```

Após confirmação, o card é substituído pela resposta final do agente. Após cancelamento, agente recebe feedback e pode sugerir alternativa.

---

## Banco de Dados

```sql
CREATE TABLE agent_conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text,
  created_by  uuid REFERENCES profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_msg_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content         text,
  tool_calls      jsonb,
  tool_results    jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agent_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_conversations_all" ON agent_conversations FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "agent_messages_all" ON agent_messages FOR ALL USING (auth.uid() IS NOT NULL);
```

O título da conversa é gerado automaticamente a partir das primeiras palavras da primeira mensagem do usuário (truncado em ~50 chars).

---

## Contexto Inicial (System Prompt)

Ao iniciar cada chamada à OpenAI, a API route injeta:

```
Você é o assistente de gestão de tráfego pago da Triad Company.
Você analisa campanhas Meta Ads, sugere otimizações e executa ações com aprovação do usuário.
Seja direto, objetivo e use dados concretos (CPL, orçamento, leads).

Contexto atual:
[lista de clientes ativos com CPL hoje vs. meta — gerado dinamicamente]
[alertas: clientes com CPL acima do máximo]
```

---

## Ferramentas

### Fase 1 — Leitura (sem confirmação)

| Tool | Descrição | Dados retornados |
|---|---|---|
| `get_client_metrics` | Métricas de N dias de um cliente | spend, leads, CPL por dia |
| `get_client_campaigns` | Campanhas ativas de um cliente (via Meta API) | id, nome, status, orçamento |
| `get_ad_sets` | Ad sets de uma campanha (via Meta API) | id, nome, orçamento diário, status |
| `list_tasks` | Lista tarefas do sistema | título, status, prazo, responsável |

### Fase 2 — Escrita (sempre com confirmação)

| Tool | Descrição | Parâmetros |
|---|---|---|
| `update_ad_budget` | Altera orçamento diário de um ad set | ad_set_id, daily_budget |
| `pause_campaign` | Pausa uma campanha | campaign_id |
| `activate_campaign` | Ativa uma campanha | campaign_id |
| `create_task` | Cria uma tarefa | title, status, due_date?, client_id?, assigned_to? |
| `update_task_status` | Muda status de tarefa | task_id, status |
| `create_note` | Cria anotação em um cliente | client_id, content |
| `update_client_pix` | Configura cobrança PIX de um cliente | client_id, monthly_budget, pix_cycle, pix_reference_day |

---

## Arquivos a Criar/Modificar

| Arquivo | Ação | Descrição |
|---|---|---|
| `docs/migrations/2026-04-30-agent-tables.sql` | Criar | Migration das tabelas de conversas |
| `src/routes/api.agente.chat.ts` | Criar | Rota server-side — orquestra OpenAI + ferramentas |
| `src/lib/agent-tools.ts` | Criar | Definições e implementações das ferramentas |
| `src/routes/agente.tsx` | Criar | Página de chat `/agente` |
| `src/components/AppShell.tsx` | Modificar | Adicionar botão flutuante + item na sidebar |
| `src/integrations/supabase/types.ts` | Modificar | Tipos das novas tabelas |
| `src/lib/database.types.ts` | Modificar | Tipos das novas tabelas |
| `wrangler.jsonc` | Modificar | Documentar secret `OPENAI_API_KEY` |

---

## Ordem de Implementação

1. Migration SQL (`agent_conversations` + `agent_messages`)
2. Atualizar tipos Supabase
3. Instalar `openai` npm package
4. Criar `src/lib/agent-tools.ts` (ferramentas de leitura — Fase 1)
5. Criar `src/routes/api.agente.chat.ts` (rota server-side + streaming)
6. Criar `src/routes/agente.tsx` (UI de chat com lista de conversas)
7. Adicionar botão flutuante + sidebar item no `AppShell`
8. Testar Fase 1 end-to-end
9. Adicionar ferramentas de escrita em `agent-tools.ts` (Fase 2)
10. Implementar fluxo de confirmação no frontend

---

## Dependências e Pré-requisitos

- `openai` npm package (a instalar)
- Secret `OPENAI_API_KEY` configurado no Cloudflare (`wrangler secret put OPENAI_API_KEY`)
- Migration das tabelas rodada no Supabase
- Auth (profiles) já implementado — necessário para `created_by` nas conversas
