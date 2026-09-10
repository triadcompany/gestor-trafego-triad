# Isolamento de dados por gestor (dentro da organização) — Design Spec

**Data:** 2026-09-11
**Status:** Aprovado pelo usuário

---

## Contexto

O multi-tenant (spec `2026-09-08`) isola dados **entre organizações**: cada agência só vê o seu. Dentro de uma organização, porém, todos os membros compartilham tudo — qualquer gestor vê todos os clientes, campanhas, mensagens e automações da agência.

O usuário quer um segundo nível de isolamento: **cada gestor (membro) vê só os próprios clientes**. O admin da organização continua vendo tudo.

## Objetivo

1. Cada cliente tem um **gestor responsável** (`owner_user_id`).
2. Usuário com papel **member** só enxerga/edita clientes de que é responsável, e tudo que pendura deles.
3. Usuário com papel **admin** (e o **platform admin** agindo dentro da org) continua vendo tudo da organização.
4. Tarefas e conversas do agente de IA também passam a ser por gestor.
5. Migração dos clientes atuais: todos atribuídos ao admin mais antigo de cada organização.

## Fora de escopo

- Vários gestores por cliente (só um `owner_user_id`; evoluir depois se preciso).
- Isolar **tags** por gestor — tags são rótulos compartilhados da organização; membro usa, mas só aplica nos clientes dele.
- Isolar **agenda** — já é por usuário hoje (cada um conecta o próprio Google Calendar).
- Transferência em lote de carteira de clientes entre gestores (troca é 1 a 1 na tela do cliente).
- Papéis intermediários (ex: "supervisor que vê um subconjunto") — só member/admin.

## Modelo de dados

`clients` ganha:
```ts
ownerUserId: uuid("owner_user_id").references(() => profiles.id, { onDelete: "set null" }),
```
Nullable a nível de banco (um cliente pode ficar "sem dono" se o gestor for removido), mas a aplicação sempre grava um valor ao criar/editar. Quando `null`, só admin vê o cliente.

Nenhuma tabela filha muda — o isolamento delas vem por join em `clients.owner_user_id`, do mesmo jeito que o isolamento por organização já vem por `clients.organization_id`.

`tasks` e `agent_conversations` **já têm** `created_by` / `assigned_to` — não muda schema, só a query.

## Regra de acesso (central)

`requireOrgContext()` já devolve `{ userId, organizationId, role }`. Duas peças novas, em `src/server/session.ts` ou um `src/server/access.ts`:

```ts
// Condição extra pra WHERE de queries que envolvem clients. undefined = sem
// restrição (admin / platform admin agindo na org). Membro: só os seus.
function clientAccessCondition(ctx: OrgContext): SQL | undefined {
  return ctx.role === "admin" ? undefined : eq(clients.ownerUserId, ctx.userId);
}

// Confere org + (admin OU dono). Substitui assertClientInOrg.
async function assertClientAccessible(clientId: string, ctx: OrgContext): Promise<void> {
  const row = await db.query.clients.findFirst({
    where: eq(clients.id, clientId),
    columns: { organizationId: true, ownerUserId: true },
  });
  if (!row || row.organizationId !== ctx.organizationId) throw new Error("Cliente não encontrado.");
  if (ctx.role !== "admin" && row.ownerUserId !== ctx.userId) throw new Error("Cliente não encontrado.");
}
```

Toda função hoje escopada só por `organizationId` passa a também aplicar `clientAccessCondition` (nas listagens) ou `assertClientAccessible` (quando recebe um `client_id` específico).

## O que fica por gestor (papel member)

| Área | Regra pro member |
|---|---|
| Lista de clientes (`fetchAllClients`, `fetchClients`, `fetchActiveClients`, `fetchClientsForDate`, `fetchClientBalances`, `fetchPixClients`) | só `owner_user_id = eu` |
| Detalhe do cliente, métricas, snapshots, saldos, PIX | `assertClientAccessible` |
| Notas, relatórios, vendas, metas de venda, modelos de conversa | filtra/assert pelo cliente dono |
| Itens de atenção / Visão Geral / cards do dashboard | só clientes dele |
| Campanhas (criar/duplicar/editar/sync na Meta) | `assertClientAccessible` no `client_id` selecionado; `syncAllClients` sincroniza só os clientes dele |
| Token Meta / instância WhatsApp por cliente | resolução por `client_id` passa pelo `assertClientAccessible` |
| Mensagens agendadas **com** cliente e automações **com** cliente | só as de clientes dele (+ as que ele criou) |
| Automação "Resumo de grupo" | só pode escolher clientes dele em `summary_client_ids` |
| Tarefas | as que ele criou **ou** estão atribuídas a ele (`created_by = eu OR assigned_to = eu`) |
| Conversas do agente de IA | **sempre** só as suas (`created_by = eu`), pra qualquer papel — histórico de chat é pessoal |

## O que continua da organização toda

- **Tags** — rótulos compartilhados. `fetchTags` continua por org. Membro pode criar tag e aplicá-la, mas só nos clientes dele (o `setClientTags` já vai passar pelo `assertClientAccessible`).
- **Agenda** — cada usuário conecta o próprio Google Calendar (`google_calendar_tokens.user_id`); nada muda.
- **Configurações / Integrações / Usuários** — já é admin-only.
- **Mensagens agendadas e automações sem cliente** (texto solto pra um grupo) — por enquanto **continuam visíveis pra toda a organização**, porque `scheduled_messages` e `message_automations` não têm `created_by` hoje. Isolar essas fica pra uma etapa posterior (ver "Pendências").

## Cadastro de cliente

`ClientFormDialog` ganha o campo **"Gestor responsável"** (select de membros da org, via `fetchOrgMembers`):
- **Admin** criando/editando: escolhe qualquer membro (default = ele mesmo ao criar).
- **Member** criando: campo travado nele (vira o dono automaticamente).
- **Member** editando: campo travado (não pode transferir).
- Trocar o responsável de um cliente existente: só admin.

Server-side, `upsertClient` valida: se `role = member`, ignora qualquer `owner_user_id` recebido e força `= userId`; se `role = admin`, aceita o `owner_user_id` informado (tem que ser um profile da mesma org) e, se não vier nada num cliente novo, usa o próprio admin.

## Migração

`0011_client_owner.sql`:
1. `ALTER TABLE clients ADD COLUMN owner_user_id uuid;` + FK.
2. Backfill: pra cada organização, `owner_user_id = ` o `profiles.id` do **admin mais antigo** dela:
   ```sql
   UPDATE clients c
   SET owner_user_id = (
     SELECT p.id FROM profiles p
     JOIN users u ON u.id = p.id
     WHERE p.organization_id = c.organization_id AND p.role = 'admin'
     ORDER BY p.created_at ASC
     LIMIT 1
   )
   WHERE owner_user_id IS NULL;
   ```
   Idempotente (`WHERE owner_user_id IS NULL`).
3. Sem `NOT NULL` na coluna (permite "sem dono" se o gestor sair).

## Superfície de mudança (ordem de implementação)

1. **Schema + migração** (`clients.owner_user_id`).
2. **Helpers** `clientAccessCondition` / `assertClientAccessible` + trocar `assertClientInOrg` por eles.
3. **`queries.ts`** — todas as ~20 funções de cliente + tarefas.
4. **`meta.ts`** — `syncAllClients`, resolução de token por cliente, relatório semanal, sync de saldo.
5. **`whatsapp-messages.ts`** — resolução de instância por cliente, `sendActiveCampaignsList`.
6. **`automations.ts` / `automations-core.ts`** — `assertClientAccessible` no create; `summary_client_ids` só de clientes acessíveis. (O tick continua system-level, materializa tudo.)
7. **`agent-chat.ts`** — `agentListConversations` e `agentLoadMessages` passam a filtrar `created_by = userId` pra todo mundo.
8. **`agent-tools.ts`** — as tools que recebem `client_id` já herdam o filtro via `fetchClients`, mas adicionar `assertClientAccessible` explícito nas de escrita.
9. **`ClientFormDialog` + `upsertClient`** — campo "Gestor responsável" + regra de quem pode setar.
10. **UI de listagem de clientes** — os selects de cliente (campanhas, automações) já herdam de `fetchAllClients`/`fetchClients`; a tabela em `/clients` mostra a coluna "Responsável" (só admin) e, pra admin, um filtro por gestor.

## Casos de erro / borda

| Situação | Comportamento |
|---|---|
| Membro tenta abrir `/clients/<id>` de cliente que não é dele | `assertClientAccessible` lança "Cliente não encontrado" → tela de erro/404 |
| Cliente com `owner_user_id = null` (gestor foi removido) | Só admin vê; aparece na tela do admin com "sem responsável" pra reatribuir |
| Admin rebaixado pra member | Passa a ver só os clientes de que é dono; os que ele criou como admin já têm ele como `owner` no backfill, então continua vendo esses |
| Automação de relatório de um cliente que mudou de dono | Continua rodando (o tick é system-level); só a visibilidade na lista muda |
| Membro seleciona cliente num dropdown que foi reatribuído no meio do fluxo | `assertClientAccessible` no submit barra |

## Pendências / follow-ups (fora deste spec)

- `scheduled_messages` e `message_automations` **sem cliente** não têm `created_by` — hoje ficam visíveis pra toda a org. Pra fechar 100% o isolamento delas, precisaria adicionar `created_by` nessas tabelas numa etapa posterior. Este spec deixa as **com cliente** já isoladas (pelo dono do cliente).

## Verificação

1. `npx tsc --noEmit` limpo (só os 3 erros pré-existentes conhecidos).
2. `npm run build` local sem erro.
3. Migração aplicada; todo cliente com `owner_user_id` preenchido.
4. Logar como **member**: só vê os clientes dele em `/clients`, dashboard, saldos, PIX, mensagens/automações. `/clients/<id>` de outro dá erro.
5. Logar como **admin**: vê todos; consegue trocar o "Gestor responsável" de um cliente e o member correspondente passa/deixa de ver.
6. Member cria um cliente → ele vira o dono automaticamente.
7. Conversa do agente de IA: cada usuário só vê o próprio histórico.
8. Tarefa atribuída a um member aparece pra ele; tarefa de outro não.
9. Deploy + verificação em produção.
