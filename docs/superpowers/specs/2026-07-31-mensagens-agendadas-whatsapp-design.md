# Mensagens Agendadas no WhatsApp — Design Spec

**Data:** 2026-07-31
**Status:** Aprovado pelo usuário

---

## Contexto

O usuário quer poder programar uma mensagem de WhatsApp (texto + mídia opcional) para ser enviada em uma data/hora futura, para uma pessoa, um grupo, ou vários de uma vez.

Hoje o app não tem nenhuma integração de envio de WhatsApp — o único uso existente é o link `wa.me` no CTA dos anúncios do Meta. Mas a VPS já roda uma instância de **Evolution API** (`triadcompany_evolution-api`), com um número já conectado (`+55 47 98862-0003`, confirmado na spec `2026-05-28-whatsapp-drive-upload-design.md`, que já usa essa mesma instância para outro fluxo via n8n). Esta feature reaproveita essa instância — sem criar número/sessão novo.

O app hoje também não tem nenhum worker/cron em background: o "sync automático" existente é client-side (dispara quando alguém está com o app aberto no navegador). Para o disparo na hora certa, este design reaproveita o padrão já usado no projeto — um workflow n8n rodando na mesma VPS, com Schedule Trigger, consultando o Postgres do app (mesmo mecanismo já usado por `n8n_jobs` na criação de campanhas, ver `updateAdCreative`/fluxo "Criar Anúncio Meta").

---

## Modelo de dados

Duas tabelas novas em `src/db/schema.ts`, seguindo o padrão já usado no arquivo (`uuid` + `defaultRandom()`, `timestamp` com `defaultNow()`):

```ts
export const scheduledMessages = pgTable("scheduled_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  body: text("body").notNull(),
  mediaBase64: text("media_base64"),
  mediaMimetype: text("media_mimetype"),
  mediaFilename: text("media_filename"),
  scheduledAt: timestamp("scheduled_at").notNull(),
  status: text("status").notNull().default("pending"), // pending | sent | partial | failed | canceled
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const scheduledMessageRecipients = pgTable("scheduled_message_recipients", {
  id: uuid("id").primaryKey().defaultRandom(),
  messageId: uuid("message_id").notNull().references(() => scheduledMessages.id, { onDelete: "cascade" }),
  remoteJid: text("remote_jid").notNull(), // ID do contato/grupo na Evolution API
  name: text("name").notNull(), // cacheado no momento do agendamento, só para exibição
  status: text("status").notNull().default("pending"), // pending | sent | failed
  sentAt: timestamp("sent_at"),
  errorMessage: text("error_message"),
});
```

Separar destinatário em tabela própria permite mandar para vários de uma vez e acompanhar sucesso/falha individualmente — um número inválido no meio de 5 não impede o envio para os outros 4. O status da mensagem-pai é derivado: `sent` (todos os destinatários `sent`), `partial` (mistura de `sent`/`failed`), `failed` (todos `failed`), `pending` (ainda tem `pending`), `canceled` (cancelada manualmente antes de disparar).

---

## Fluxo na interface

Nova página **`/mensagens`**, com item **"Mensagens"** no menu (seção Ferramentas).

**Lista de agendamentos:** cards ordenados por `scheduled_at` (futuros primeiro), mostrando prévia do texto, nomes dos destinatários, data/hora e status (badge colorido). Mensagens `sent`/`partial`/`failed` são expansíveis para ver o status de cada destinatário individualmente.

**Composer ("+ Nova mensagem"):**
- Campo de texto para a mensagem.
- Upload opcional de mídia (imagem/vídeo/documento) — convertido para base64 no client e enviado junto no payload da server function (sem storage externo, mesmo padrão já usado em `drive_uploads.media_base64`).
- Busca de destinatários: campo de busca com debounce, que chama uma server function que consulta ao vivo os contatos e grupos da Evolution API (`/chat/findContacts` e `/group/fetchAllGroups`, ou os endpoints equivalentes da versão instalada). Seleção múltipla via chips removíveis.
- Seletor de data/hora (não pode ser no passado).
- Botão "Agendar" — grava `scheduled_messages` (`status: pending`) + uma linha em `scheduled_message_recipients` por destinatário selecionado (também `pending`).

**Cancelar:** disponível em mensagens com `status: pending`, muda para `canceled` (linhas de destinatário não são mais processadas pelo workflow).

Não há edição de uma mensagem já agendada — para mudar algo, cancela e cria outra.

---

## Envio (workflow n8n)

Novo workflow no n8n, **Schedule Trigger a cada 1 minuto**, usando a mesma credencial Postgres (`Gestor Trafego Postgres (VPS)`) já usada pelo workflow de criação de campanha:

1. **Buscar vencidos** — Postgres node: `SELECT r.*, m.body, m.media_base64, m.media_mimetype FROM scheduled_message_recipients r JOIN scheduled_messages m ON m.id = r.message_id WHERE r.status = 'pending' AND m.status NOT IN ('canceled') AND m.scheduled_at <= now()`.
2. **Loop por destinatário** — para cada linha: HTTP Request para a Evolution API (`apikey` no header, mesmo padrão do fluxo Drive) — `POST /message/sendText/{instance}` se não tem mídia, `POST /message/sendMedia/{instance}` se tem, endereçado ao `remote_jid`.
3. **Atualizar status** — Postgres node: `UPDATE scheduled_message_recipients SET status = ..., sent_at = now(), error_message = ...` conforme a resposta da Evolution API (sucesso ou erro).
4. **Recalcular status da mensagem-pai** — Postgres node: depois de processar, verifica se ainda restam destinatários `pending` para aquela `message_id`; se não, calcula `sent`/`partial`/`failed` a partir da distribuição de status dos destinatários e atualiza `scheduled_messages`.

A app (server functions) só grava as linhas em `pending`; quem efetivamente dispara é o n8n — mesma divisão de responsabilidade já usada na criação de campanha via "Criar do zero".

---

## Casos de erro

| Situação | Comportamento |
|---|---|
| Evolution API fora do ar no momento do envio | HTTP Request falha; linha do destinatário fica `failed` com o erro registrado; não há retry automático nesta fase (mensagem cancelada precisa ser recriada) |
| `remote_jid` inválido/não existe mais | Evolution API retorna erro; só aquele destinatário fica `failed`, os demais seguem normalmente |
| Mídia muito grande | Validação no client antes do upload (limite ~16MB, mesmo teto prático do WhatsApp); acima disso, bloqueia o agendamento com aviso |
| Data/hora no passado | Bloqueado no client ao criar o agendamento |
| Cancelar mensagem que já começou a ser processada (alguns destinatários já `sent`) | Os `pending` restantes não são mais enviados; os que já foram `sent` continuam `sent` (cancelamento não desfaz envios já feitos) |

---

## Fora de escopo

- Recorrência (mensagens repetidas — só envio único por enquanto).
- Lista de contatos/grupos salva na aplicação — busca é sempre ao vivo na Evolution API, sem tabela de contatos própria.
- Edição de uma mensagem já agendada (cancelar + criar outra).
- Retry automático em caso de falha de envio.
- Templates de mensagem reutilizáveis (diferente dos templates de conversa do WhatsApp Ads, que já existem em outra parte do app).

---

## Verificação

1. `npx tsc --noEmit` limpo (só o erro pré-existente não relacionado em `clients.$id.tsx`).
2. Migration aplicada na VPS (`scheduled_messages` + `scheduled_message_recipients` criadas).
3. `npm run build` local sem erros.
4. Workflow n8n criado e ativado, testado manualmente disparando uma mensagem agendada para 1 minuto no futuro, para um número de teste.
5. Testar com múltiplos destinatários (pessoa + grupo juntos) numa mensagem só, incluindo um `remote_jid` inválido de propósito, confirmando que só aquele destinatário fica `failed` e os outros são enviados normalmente.
6. Testar envio com mídia (imagem) e sem mídia.
7. Testar cancelamento de uma mensagem `pending` antes do horário chegar.
8. Deploy e verificação em produção, mesmo fluxo já usado nas features anteriores.
