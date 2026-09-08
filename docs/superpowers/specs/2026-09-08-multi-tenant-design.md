# Multi-tenant (produto vendável) — Design Spec

**Data:** 2026-09-08
**Status:** Aprovado pelo usuário

---

## Contexto

O gestor-trafego-triad hoje é um sistema de uso único: todos os usuários logados enxergam os mesmos clientes, campanhas, mensagens agendadas e configurações. Integrações (token Meta Ads, Evolution API/WhatsApp, webhook do n8n) são uma configuração global única, guardada em `app_config` (chave-valor, sem dono). Não existe conceito de "organização" nem de dados isolados entre grupos de usuários.

O objetivo é transformar isso num produto que pode ser vendido pra outras agências de tráfego, cada uma com sua própria equipe, seus próprios clientes e suas próprias credenciais de Meta Ads e WhatsApp — sem que uma agência veja ou interfira nos dados de outra.

## Objetivo

1. Introduzir o conceito de **organização** (uma agência) como unidade de isolamento de dados.
2. Suportar múltiplos usuários por organização, com dois papéis: **admin** e **membro**.
3. Tornar as integrações de Meta Ads e WhatsApp (Evolution API) configuráveis por organização, no lugar da configuração global única de hoje.
4. Dar a você (dono do produto) um acesso de **platform admin**, fora do conceito de organização, pra criar organizações novas e dar suporte a qualquer uma delas.
5. Migrar os dados atuais da Triad para uma organização própria, sem perda nem necessidade de recadastro.

## Fora de escopo (v1)

- **Cobrança/assinatura.** Nenhum Stripe, plano ou bloqueio por inadimplência. Organização é liberada manualmente por você.
- **Cadastro público self-service.** Não existe tela "criar conta" aberta ao público. Toda organização nasce via ação do platform admin.
- **Convite por email.** Não há SMTP/serviço de email configurado no sistema. Um admin de organização adiciona um colega preenchendo diretamente nome, email e uma senha inicial — sem link de convite.
- **n8n por organização.** O n8n continua sendo uma instância única, compartilhada, operada por você. Os workflows passam a receber as credenciais (Evolution API da instância escolhida, token Meta quando aplicável) no payload de cada chamada, em vez de ler uma configuração global fixa.
- **Multi-organização por usuário.** Cada usuário pertence a exatamente uma organização. Não existe hoje (nem é pedido) um usuário que transite entre organizações diferentes, fora o platform admin.
- **OAuth "Continuar com Facebook".** O token da Meta continua sendo colado manualmente na tela de Configurações — só que agora por organização, em vez de global.

## Design

### 1. Modelo de dados

**Tabela nova `organizations`:**
```
id          uuid PK
name        text not null
active      boolean not null default true
created_at  timestamptz not null default now()
```

**`profiles`** ganha:
- `organization_id` uuid FK → `organizations.id`, **nullable a nível de banco** — só fica nulo pro platform admin puro (que ainda tem uma linha em `profiles`, pra não quebrar o `innerJoin` que `loadSessionUser` já faz hoje entre `users` e `profiles`, só que sem organização atrelada). A aplicação garante, fora do banco, que todo usuário que não seja platform admin tenha `organization_id` preenchido.
- `role` (já existe) passa a aceitar só `'admin' | 'member'` (hoje é texto livre com default `'member'`, sem validação).

**`users`** ganha:
- `is_platform_admin` boolean not null default false.

**`organization_id` (FK obrigatória) é adicionada em:**
- `clients` — a raiz de todo o resto: `metrics_daily`, `campaign_snapshots`, `client_notes`, `sales`, `sales_goals`, `client_tags`, `conversation_templates`, `report_log`, `sync_log` já filtram por `client_id`, e portanto herdam o isolamento por join em `clients.organization_id` — **não** ganham a coluna duplicada.
- `tags`
- `tasks`
- `agent_conversations`
- `scheduled_messages`
- `drive_uploads`
- `n8n_jobs`
- `app_config` — deixa de ser singleton global. A constraint `unique(key)` vira `unique(organization_id, key)`.

**Tabela nova `whatsapp_instances`** (substitui as chaves `evolution_api_url` / `evolution_api_key` / `evolution_instance` hoje soltas em `app_config`):
```
id               uuid PK
organization_id  uuid FK -> organizations.id, not null
label            text not null              -- ex: "WhatsApp do João"
evolution_url    text not null
evolution_key    text not null
instance_name    text not null              -- nome da instância na Evolution API
assigned_user_id uuid FK -> profiles.id, nullable
active           boolean not null default true
created_at       timestamptz not null default now()
```
Uma organização pode ter **N** instâncias. Mensagens agendadas (`scheduled_messages`) e grupos monitorados passam a referenciar qual `whatsapp_instance_id` usar. Se a organização só tem 1 instância ativa, a UI pré-seleciona ela automaticamente — zero fricção extra pra quem usa hoje (a Triad terá exatamente 1, migrada da config atual).

### 2. Auth, sessão e papéis

O JWT de sessão não muda de formato (continua só `{ sub: userId }`). O que muda é `loadSessionUser` (`src/server/session.ts`), que hoje já faz `join` de `users` com `profiles` — passa a trazer também `organizationId`, `role` e `isPlatformAdmin`.

Três níveis de autorização, aplicados **nas server functions** (não só escondendo botão na UI — a validação real fica no backend):

- **member**: CRUD de clientes, campanhas, mensagens agendadas, modelos de conversa, tarefas, tags — tudo escopado à própria `organization_id`.
- **admin**: tudo que member faz, mais: tela "Usuários" (criar/editar/desativar colegas da própria organização), tela de Integrações (token Meta, gerenciar `whatsapp_instances`).
- **platform admin** (`users.is_platform_admin`): não pertence a nenhuma organização por padrão. Acessa `/admin/organizations` — lista todas as organizações, cria organização nova (+ primeiro admin dela), e pode "entrar" numa organização específica (assume o contexto daquela org, como um admin dela, pra fins de suporte).

Helper central `requireRole(minRole)` em `session.ts`, chamado no início de toda server function que hoje não verifica nada além de "está logado". Isso cobre o mesmo padrão de centralização que o resto do sistema já usa (tudo em poucos arquivos: `queries.ts`, `meta.ts`, `session.ts`).

### 3. Camada de queries — isolamento obrigatório

Toda função em `src/lib/queries.ts` (e as equivalentes de integração em `meta.ts`, `whatsapp-messages.ts`, `n8n.ts`) que hoje lê/escreve uma tabela de topo passa a **exigir `organizationId` como parâmetro** (via tipos do TypeScript — quebra a build de quem esquecer de passar). A chamada, nas rotas/componentes, sempre resolve `organizationId` a partir do usuário logado (nunca aceito como input arbitrário do cliente).

Tabelas que hoje já filtram por `client_id` continuam exatamente assim; a garantia extra ali é que toda função que busca um `client_id` avulso (ex: notas, vendas) primeiro confirma que aquele cliente pertence à organização do usuário, antes de prosseguir — evita um usuário de uma organização adivinhar o UUID de um cliente de outra.

### 4. Integrações por organização

- **Meta Ads**: token continua 1 por organização (token de sistema da Business Manager — não faz sentido dividir por pessoa). A tela `/settings` existente passa a ler/gravar em `app_config` filtrado por `organization_id`, em vez de global.
- **WhatsApp / Evolution API**: vira `whatsapp_instances` (seção 1). Tela de Configurações ganha uma lista de instâncias da organização (criar, editar, desativar, atribuir a um usuário).
- **n8n**: continua uma instância só, compartilhada, operada por você. Os workflows que hoje leem `evolution_api_url`/`evolution_api_key` globais direto do `app_config` (envio de mensagem agendada, resumidor de grupo) passam a **receber essas credenciais no payload do webhook** — o server function que dispara a chamada busca a `whatsapp_instance` correta (da organização/mensagem em questão) e manda junto.

### 5. Provisionamento e migração

**Provisionamento de organização nova**: rota `/admin/organizations` (só platform admin) — formulário simples: nome da organização + nome/email/senha do primeiro admin. Sem fluxo de pagamento nem aprovação automática.

**Dentro da organização**: o admin adiciona colegas pela tela "Usuários" em Configurações — nome, email, senha inicial (o admin comunica essa senha por fora do sistema, ex: WhatsApp). Não existe hoje nenhuma tela de troca de senha — essa etapa adiciona uma opção simples "Trocar minha senha" no menu do usuário (pede senha atual + nova), pra quem recebeu uma senha inicial do admin poder trocá-la sem depender dele de novo.

**Migração dos dados existentes**: uma migration cria a organização `"Triad Company"` e faz `UPDATE` de `organization_id` em todas as linhas hoje órfãs de: `clients`, `tags`, `tasks`, `scheduled_messages`, `agent_conversations`, `drive_uploads`, `n8n_jobs`, `app_config`. As linhas atuais de `evolution_api_url`/`evolution_api_key`/`evolution_instance` em `app_config` são convertidas numa primeira linha de `whatsapp_instances` da Triad (`label: "Principal"`). Todos os usuários existentes (`profiles`) recebem `organization_id` = Triad Company, com `role = 'admin'` (mantendo o acesso que já têm hoje). Zero perda de dado; o sistema continua funcionando pra vocês exatamente como hoje, só que agora dentro de uma organização nomeada.

## Plano de teste

1. Rodar a migration e confirmar que todos os dados atuais da Triad continuam acessíveis e intactos, sob a organização "Triad Company".
2. Como platform admin, criar uma segunda organização de teste ("Agência Teste") com um admin novo.
3. Logar como o admin da Agência Teste: confirmar que a lista de clientes/campanhas/mensagens está **vazia** (não vê nada da Triad).
4. Cadastrar um cliente de teste na Agência Teste, configurar um token Meta de teste e uma `whatsapp_instance` de teste; confirmar que a Triad não vê nada disso e vice-versa.
5. Como admin da Agência Teste, criar um usuário "membro"; confirmar que ele consegue editar clientes/campanhas mas **não** acessa a tela de Integrações nem "Usuários".
6. Disparar uma mensagem agendada em cada organização e confirmar que cada uma usa a `whatsapp_instance` correta (via payload do n8n), sem misturar credenciais.
7. Como platform admin, entrar na Agência Teste via `/admin/organizations` e confirmar acesso de admin àquela organização especificamente.
