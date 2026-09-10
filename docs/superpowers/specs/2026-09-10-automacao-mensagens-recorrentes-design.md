# Automação de mensagens recorrentes no WhatsApp — Design Spec

**Data:** 2026-09-10
**Status:** Aprovado pelo usuário

---

## Contexto

A página `/mensagens` hoje só tem **mensagens agendadas de disparo único** (`scheduled_messages`: envia uma vez numa data/hora, entregue por um workflow n8n com Schedule Trigger a cada 1 min que lê o Postgres e dispara via Evolution API). Ver `docs/superpowers/specs/2026-07-31-mensagens-agendadas-whatsapp-design.md`.

O usuário quer **regras recorrentes**, ex:
- "Toda segunda às 10h envia essa mensagem de texto"
- "Toda segunda às 8h30 envia o relatório dos últimos 7 dias do cliente X"

Ao criar a regra, escolher os destinos: o grupo do WhatsApp do cliente (`clients.whatsappGroupId`), outros grupos, ou contatos avulsos.

Duas restrições do projeto que moldam o design:
1. **Sem worker em background no app** — todo cron é feito por workflow n8n na mesma VPS (padrão já usado por `scheduled_messages` e `n8n_jobs`).
2. **Multi-tenant** — desde a spec `2026-09-08-multi-tenant-design.md`, as credenciais da Evolution API vivem em `whatsapp_instances` por organização, não mais no `app_config` global. O workflow n8n "Enviar Mensagens Agendadas" **está quebrado hoje** por ainda ler do `app_config` — esta feature conserta isso junto.

## Objetivo

1. Criar/editar/pausar/excluir regras de automação que enviam conteúdo recorrente no WhatsApp.
2. Suportar recorrência semanal (dia da semana + hora), diária (hora) e mensal (dia do mês + hora).
3. Suportar dois tipos de conteúdo: texto livre com mídia opcional, e relatório de métricas de um cliente (período 7/15/30 dias).
4. Suportar múltiplos destinos por regra (grupo do cliente + outros grupos/contatos).
5. Rodar de forma confiável sem depender do navegador aberto.
6. Consertar o workflow n8n de envio de mensagens agendadas para o mundo multi-tenant.

## Abordagem escolhida — "Materialização"

Uma regra de automação **não envia nada diretamente**. Um endpoint do app (`/api/automations/tick`), chamado por um workflow n8n a cada 5 min, verifica quais regras "venceram" e, para cada uma, **cria uma linha normal em `scheduled_messages` (+ destinatários + mídias)** para disparo imediato. O workflow de envio já existente (depois de consertado) entrega.

Vantagens: reaproveita 100% do pipeline de envio já testado (mídia, status por destinatário, retry manual) e o histórico que já aparece na aba "Agendadas"; cada disparo de regra vira uma entrada rastreável; toda a lógica de negócio (recorrência, resolução de destino, geração do texto do relatório) fica no app — versionada e testável, não em Code nodes do n8n.

Custo: uma camada de indireção (regra → mensagem agendada → enviada) e a necessidade de um controle `last_run_at` por regra contra disparo duplo.

## Modelo de dados

Três tabelas novas em `src/db/schema.ts`, seguindo o padrão do arquivo (`uuid().defaultRandom()`, `timestamp` com `defaultNow()`, `organization_id` FK obrigatória nas tabelas de topo).

```ts
export const messageAutomations = pgTable("message_automations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  contentType: text("content_type").notNull(), // 'text' | 'report'
  body: text("body"),                            // texto livre — só quando contentType='text'
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }), // obrigatório p/ 'report', opcional p/ 'text'
  reportPeriodDays: integer("report_period_days").notNull().default(7), // 7 | 15 | 30 — usado só p/ 'report'
  recurrenceType: text("recurrence_type").notNull(), // 'weekly' | 'daily' | 'monthly'
  recurrenceDays: integer("recurrence_days").array().notNull().default([]), // weekly: 1..7 (1=segunda); monthly: 1..28; daily: []
  sendHour: integer("send_hour").notNull(),     // 0..23, fuso America/Sao_Paulo
  sendMinute: integer("send_minute").notNull(), // 0..59
  whatsappInstanceId: uuid("whatsapp_instance_id").references(() => whatsappInstances.id, { onDelete: "set null" }),
  lastRunAt: timestamp("last_run_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const messageAutomationDestinations = pgTable("message_automation_destinations", {
  id: uuid("id").primaryKey().defaultRandom(),
  automationId: uuid("automation_id").notNull().references(() => messageAutomations.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),        // 'client_group' | 'custom'
  remoteJid: text("remote_jid"),       // null p/ 'client_group' (resolve em runtime via clients.whatsappGroupId)
  name: text("name").notNull(),        // cacheado p/ exibição
});

export const messageAutomationMedia = pgTable("message_automation_media", {
  id: uuid("id").primaryKey().defaultRandom(),
  automationId: uuid("automation_id").notNull().references(() => messageAutomations.id, { onDelete: "cascade" }),
  base64: text("base64").notNull(),
  mimetype: text("mimetype").notNull(),
  filename: text("filename").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});
```

**Convenção de dias da semana:** `1=segunda … 7=domingo` (ISO). Documentar no código.

**Validações (no server function de upsert):**
- `contentType='report'` exige `clientId` não-nulo; `reportPeriodDays ∈ {7,15,30}`.
- `contentType='text'` exige `body` não-vazio OU pelo menos uma mídia.
- `recurrenceType='weekly'` exige `recurrenceDays` ⊆ {1..7} não-vazio; `'monthly'` exige `recurrenceDays` ⊆ {1..28} não-vazio; `'daily'` ignora `recurrenceDays`.
- Pelo menos um destino.
- `client_id`, `whatsapp_instance_id` e os `remote_jid` são validados como pertencentes à organização de quem chama (mesmo padrão `assertClientInOrg` já usado em `queries.ts`).

## Interface

`/mensagens` passa a ter duas abas: **"Agendadas"** (a lista atual, sem mudança de fundo) e **"Automações"** (nova).

### Aba Automações — lista

Cards, um por regra:
- Nome
- Resumo legível da recorrência: "Toda seg e qua às 10:00", "Todo dia às 08:00", "Todo dia 1 às 08:30"
- Tipo: "Texto" ou "Relatório 7 dias · Cliente X"
- Destinos (chips)
- Badge **Ativa** / **Pausada**
- "Rodou pela última vez em <data>" ou "Nunca rodou"
- Ações: toggle ativar/pausar · editar · excluir · **"Rodar agora"** (chama a materialização na hora para aquela regra, ignorando o horário — para teste)

### Composer "+ Nova automação" (dialog)

1. **Nome** (texto)
2. **Tipo de conteúdo**: Texto | Relatório de métricas
   - **Texto** → campo de texto (Textarea) + upload de mídia (reusa o componente de upload/preview do composer de mensagem agendada, mesmo limite de tamanho) + seletor de cliente **opcional**
   - **Relatório** → seletor de cliente **obrigatório** + período (Select: 7 / 15 / 30 dias)
3. **Recorrência**: RadioGroup Semanal | Diária | Mensal
   - Semanal → checkboxes seg–dom
   - Mensal → multi-seleção dias 1–28
   - Diária → sem seleção de dias
   - + horário: dois selects (hora 00–23, minuto em passos de 5)
4. **Destinos** (multi-seleção): opção "Grupo do cliente" aparece **quando há cliente selecionado**; demais grupos/contatos via o `RecipientSearch` já existente (busca ao vivo na Evolution API). Chips removíveis.
5. **Instância WhatsApp**: só aparece se a organização tiver mais de uma instância ativa (auto-seleciona quando só há uma) — mesmo padrão do cadastro de cliente.
6. **Salvar**.

Editar abre o mesmo dialog preenchido. Não há edição de uma ocorrência já materializada — para mexer numa, cancela na aba "Agendadas" como qualquer mensagem agendada.

## Execução

### Endpoint de tick

`POST /api/automations/tick` — **route handler** (não server function, precisa rodar sem sessão de usuário). Autentica comparando o header `x-automation-secret` à env var `AUTOMATION_SECRET`; se não bater, `401`.

Lógica a cada chamada:
1. Busca todas as `message_automations` com `active = true` de **todas** as organizações (operação de sistema, cross-org — não usa `requireOrgContext`).
2. Para cada regra, calcula no fuso **America/Sao_Paulo** se "a ocorrência de hoje já deveria ter saído e ainda não saiu":
   - agora (BR) já passou de `send_hour:send_minute` hoje, **e**
   - a recorrência bate com hoje:
     - `weekly`: dia-da-semana-ISO de hoje ∈ `recurrenceDays`
     - `daily`: sempre
     - `monthly`: dia-do-mês de hoje ∈ `recurrenceDays`
   - **e** `last_run_at` é `null` OU anterior a "hoje às `send_hour:send_minute`" no fuso BR
3. Se disparar:
   - **Texto da mensagem**: `contentType='text'` → `body` da regra; `contentType='report'` → `buildMetricsReportText(clientId, reportPeriodDays, token)` — ver seção "Relatório". O `token` é resolvido **direto do banco** (`clients.meta_token_id → meta_tokens.access_token`, ou o token ativo mais antigo da organização como fallback), sem passar por `requireOrgContext()`, porque o tick roda sem sessão.
   - **Destinos resolvidos**: `kind='client_group'` → `clients.whatsappGroupId` da regra (se `null`/vazio, pula esse destino e conta como aviso no resumo); `kind='custom'` → `remote_jid`.
   - **Instância**: `whatsapp_instance_id` da regra, ou a primeira `whatsapp_instances` ativa da organização — resolvida **direto do banco** no tick (a `resolveWhatsappInstance` existente depende de sessão e não serve aqui; extrair a lógica de escolha para uma função pura reutilizável por ambos os caminhos).
   - Cria `scheduled_messages` (`organization_id`, `whatsapp_instance_id`, `body` = texto resolvido, `scheduled_at = now()`, `status = 'pending'`) + copia as linhas de `message_automation_media` para `scheduled_message_media` + cria um `scheduled_message_recipients` por destino resolvido.
   - `UPDATE message_automations SET last_run_at = now()`.
4. Responde `200` com um resumo JSON: `{ rulesFired, messagesCreated, warnings: [...] }`.

Erros por regra (ex: geração do relatório falha, cliente sem grupo) **não derrubam o tick inteiro** — são coletados em `warnings` e o laço segue para a próxima regra. `last_run_at` só é setado se a mensagem foi criada; uma regra que falhou é retentada no próximo tick.

### Workflow n8n de tick (novo)

Schedule Trigger a cada **5 min** → 1 HTTP Request `POST https://<app-host>/api/automations/tick` com header `x-automation-secret`. Nada mais.

Comportamento em indisponibilidade: se o app estiver fora num tick, o próximo (5 min depois) ainda pega a regra, porque `last_run_at` continua defasado da ocorrência de hoje — **atrasa, não perde**. Se ficar fora o dia todo, a ocorrência daquele dia é perdida (sem backfill de dias — decisão consciente).

### Consertar o workflow n8n de envio (multi-tenant)

O workflow "Enviar Mensagens Agendadas" (Schedule 1 min) hoje lê `evolution_api_url` / `evolution_api_key` / `evolution_instance` do `app_config`, que sob multi-tenant **não existem mais lá** (viraram `whatsapp_instances` por organização). Ajustes:
- A query do passo "Buscar vencidos" passa a fazer `JOIN whatsapp_instances wi ON wi.id = m.whatsapp_instance_id` e trazer `wi.evolution_url`, `wi.evolution_key`, `wi.instance_name` por mensagem.
- Fallback para `m.whatsapp_instance_id IS NULL` (mensagens antigas): subquery pegando a primeira `whatsapp_instances` ativa da organização da mensagem (`ORDER BY created_at LIMIT 1`).
- Os nós HTTP Request de envio passam a usar `wi.evolution_url` / `wi.evolution_key` / `wi.instance_name` da linha, em vez de valores fixos.
- Atualização feita via a API REST do n8n (`X-API-KEY`, GET workflow → modificar JSON → PUT), mesmo método já usado nas features anteriores.

## Relatório — generalização

`sendWeeklyMetricsReport(clientId)` hoje monta o texto **fixo em 7 dias** e já envia. Refatoração:
- Extrair `buildMetricsReportText(client: { metaAdAccountId: string }, periodDays: number, token: string): Promise<string>` — recebe o token **já resolvido** pelo chamador (não resolve por conta própria, pra funcionar tanto no caminho com sessão quanto no tick sem sessão). Chama `fetchAccountInsightsForRange` com `since = hoje - periodDays` e monta o mesmo texto de hoje, com o rótulo do período ("últimos N dias").
- `sendWeeklyMetricsReport` resolve o token com `requireMetaToken(clientId)` (caminho com sessão, botão manual) e chama `buildMetricsReportText(client, 7, token)`; só ele cuida do envio.
- A materialização de automação resolve o token direto do banco (ver "Execução") e chama `buildMetricsReportText(client, reportPeriodDays, token)`, jogando o retorno no `body` da `scheduled_messages`.

## Multi-tenant / escopo por organização

- `message_automations` e filhas escopadas por `organization_id`; todas as server functions de CRUD resolvem a organização via `requireOrgContext()` e nunca aceitam `organizationId` do cliente (mesmo padrão do resto do app pós-multi-tenant).
- O tick é a exceção: opera cross-org, autenticado por segredo, e ao materializar cada mensagem copia o `organization_id` da regra para a `scheduled_messages`.
- CRUD de automação: qualquer membro da organização pode criar/editar/pausar (não é ação de admin) — consistente com quem já pode criar mensagem agendada hoje.

## Casos de erro

| Situação | Comportamento |
|---|---|
| App fora do ar num tick | Próximo tick (5 min) pega a regra; atrasa, não perde |
| App fora do ar a ocorrência inteira do dia | Ocorrência daquele dia é perdida; sem backfill |
| Regra `report` cujo cliente perdeu o token / Graph API falha | `warning` no resumo do tick; `last_run_at` **não** é setado; retenta no próximo tick até passar a janela do dia |
| Destino `client_group` mas o cliente não tem `whatsappGroupId` | Esse destino é pulado com `warning`; os demais destinos da regra seguem normalmente |
| Regra sem nenhum destino resolvível | Nada é criado; `warning`; `last_run_at` não é setado |
| `x-automation-secret` errado ou ausente | `401`, tick não roda |
| Instância WhatsApp da regra foi desativada/excluída | Cai na instância padrão da organização; se não houver nenhuma ativa, `warning` e nada é criado |
| Mídia grande na regra | Validada no client ao salvar a regra (mesmo limite do composer de mensagem agendada) |

## Fora de escopo

- Recorrência "a cada X semanas", "dias úteis", ou com data-limite ("até tal dia") — só semanal/diária/mensal sem fim.
- Backfill de ocorrências perdidas por indisponibilidade prolongada.
- Fuso configurável — fixo `America/Sao_Paulo`.
- Retry automático de envio — herdado do pipeline de mensagem agendada, que não tem (falha fica registrada por destinatário).
- Editar/reprocessar uma ocorrência já materializada — cancela na aba "Agendadas".
- Prévia renderizada do relatório dentro do composer da regra — o texto só é gerado na hora do disparo.
- Templates de automação reutilizáveis.

## Verificação

1. `npx tsc --noEmit` limpo (só os erros pré-existentes conhecidos em `clients.$id.tsx` e `vendas.tsx`).
2. `npm run build` local sem erros.
3. Migration aplicada na VPS (3 tabelas novas) + `AUTOMATION_SECRET` definida no ambiente do app no EasyPanel.
4. Workflow n8n de tick criado e ativado; workflow de envio atualizado para o multi-tenant.
5. Criar uma regra `text` semanal para daqui a ~6 min, "Rodar agora" e confirmar que aparece uma mensagem na aba "Agendadas" e é entregue.
6. Criar uma regra `report` (7 dias) para um cliente com grupo configurado, "Rodar agora", confirmar o texto do relatório correto e a entrega no grupo do cliente.
7. Regra com 2 destinos (grupo do cliente + um contato de teste), confirmar que os dois recebem.
8. Pausar a regra e confirmar que o tick seguinte não a dispara.
9. Deixar `last_run_at` de hoje setado e confirmar que o tick não redispara na mesma ocorrência.
10. Deploy e verificação em produção, mesmo fluxo das features anteriores.
