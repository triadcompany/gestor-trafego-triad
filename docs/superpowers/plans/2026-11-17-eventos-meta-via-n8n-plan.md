# Eventos Meta via n8n — plano de implementação

Spec: [../specs/2026-11-17-eventos-meta-via-n8n-design.md](../specs/2026-11-17-eventos-meta-via-n8n-design.md) (aprovado em 2026-11-17).

**Princípios**: n8n só envia; app decide. Caminho direto continua como alternativa enquanto `N8N_META_EVENTS_WEBHOOK_URL` não existir. Cada tarefa termina verificável. Incrementar `package.json#version` (patch, hoje 1.0.156) antes do commit+push final.

**Workflow n8n já criado** (inativo): `XG7y45CDpadiY6jQ`, `POST /webhook/enviar-evento-meta`, header `x-webhook-secret`. Contrato: entrada `{ adId, token, event, fallbackDatasetId?, fallbackPageId? }`; saída `{ ok, datasetId, pageId, metaResponse? , error? , noDataset? }` com HTTP 200 (ok) ou 422. **Nunca 502** (o proxy do EasyPanel troca por HTML); tratar resposta não-JSON como falha.

**Teste**: o projeto não tem framework. Usar `node:test` + `node:assert` (zero dependência, funciona com npm/Docker). Módulos testados ficam **sem imports** (puros). Script novo: `"test": "node --test --experimental-strip-types src/lib/*.test.ts"`.

---

## Tarefa 1 — Módulo puro de palavras-chave (+ testes)

Criar `src/lib/keyword-match.ts` (sem imports) e `src/lib/keyword-match.test.ts`.

```ts
export type EventType = "qualified_lead" | "purchase";
export type RuleSource = "team" | "lead" | "any";
export interface KeywordRule {
  id: string; eventType: EventType; keyword: string; keywordNormalized: string;
  source: RuleSource; defaultValue: number | null; active: boolean;
}

export function normalizeText(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Primeira regra ativa do tipo cujo texto normalizado contém a palavra e cujo "quem diz" confere. */
export function matchRule(rules: KeywordRule[], eventType: EventType, text: string, fromMe: boolean): KeywordRule | null {
  const t = normalizeText(text);
  if (!t) return null;
  for (const r of rules) {
    if (!r.active || r.eventType !== eventType || !r.keywordNormalized) continue;
    if (r.source === "team" && !fromMe) continue;
    if (r.source === "lead" && fromMe) continue;
    if (t.includes(r.keywordNormalized)) return r;
  }
  return null;
}

/** Primeiro "R$ <valor>" no formato BR (1.500,00 | 1500 | R$1 | 12,5). null se não houver. */
export function extractBrlAmount(text: string): number | null {
  const m = text.match(/R\$\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?/i);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, "") + (m[2] ? "." + m[2] : ""));
  return Number.isFinite(n) ? n : null;
}

export type MetaEventKind = "qualified" | "lead" | "purchase";
export const META_EVENT_NAME: Record<MetaEventKind, string> = { qualified: "QualifiedLead", lead: "LeadSubmitted", purchase: "Purchase" };
export const buildEventId = (leadId: string, kind: MetaEventKind) => `${leadId}:${kind}`;

/** Meta só aceita event_time até 7 dias atrás; acima disso usa agora. */
export function clampEventTime(occurredAtMs: number, nowMs = Date.now()): number {
  const sevenDays = 7 * 24 * 3600 * 1000;
  const t = occurredAtMs > nowMs || nowMs - occurredAtMs > sevenDays - 3600_000 ? nowMs : occurredAtMs;
  return Math.floor(t / 1000);
}
```

Testes (`node:test`): normalização (acento, caixa, espaços); "contém"; `source` team/lead/any × `fromMe`; regra inativa e tipo diferente ignorados; `extractBrlAmount` com `R$ 1.500,00`→1500, `R$1`→1, `R$ 1500`→1500, `R$ 12,5`→12.5, `R$1.500`→1500, sem valor→null, dois valores→primeiro, `r$ 20` minúsculo→20; `buildEventId`; `clampEventTime` (futuro, 8 dias, ontem).

Verificar: `npm test` verde.

## Tarefa 2 — Schema e migração

Em [src/db/schema.ts](../../../src/db/schema.ts), junto de `metaLeadAttributions`:

- `clientEventKeywords` (`client_event_keywords`): `id uuid pk`, `clientId uuid fk clients cascade`, `eventType text`, `keyword text`, `keywordNormalized text`, `source text default 'team'`, `defaultValue numericMoney(…) null`, `active boolean default true`, `createdAt`. Unique `(clientId, eventType, keywordNormalized)`; index em `clientId`.
- `metaEventLog` (`meta_event_log`): `id uuid pk`, `leadId uuid fk metaLeadAttributions cascade`, `eventType text` (`qualified|lead|purchase`), `trigger text` (`manual|keyword`), `keyword text null`, `messageExcerpt text null`, `datasetId text null`, `pageId text null`, `eventId text`, `status text` (`sent|failed`), `error text null`, `createdAt`. Index `(leadId)` e `(createdAt)`.
- Adicionar relations se o padrão do arquivo pedir.

Gerar migração: `npx drizzle-kit generate` (cria `drizzle/0040_*.sql` + snapshot + journal, como o 0039). Conferir no `package.json`/deploy como migrações são aplicadas e seguir o mesmo caminho do 0039.

Verificar: SQL gerado só cria as duas tabelas (nenhum `DROP`).

## Tarefa 3 — Construtores do evento (meta-capi) e dispatcher

1. Em [src/server/meta-capi.ts](../../../src/server/meta-capi.ts): exportar `buildMetaEvent({ kind, leadId, ctwaClid, phoneRemoteJid, email, contactName, value, occurredAtMs })` que devolve o objeto do evento **sem `page_id`**: `event_name` (de `META_EVENT_NAME`), `event_id`, `event_time` (`clampEventTime`), `action_source: "business_messaging"`, `messaging_channel: "whatsapp"`, `user_data` com `ctwa_clid`, `ph` (dígitos, SHA256), `em` (minúsculas/trim), `fn`/`ln` (primeiro nome / resto do `contactName`, minúsculas, sem acento, **só se houver**), e `custom_data {currency:"BRL", value}` só no `purchase` com valor. Nunca hashear string vazia.
2. Manter `sendQualifiedLeadEvent`/`sendCustomMessagingEvent`/`sendPurchaseEvent` como caminho direto (alternativa), reaproveitando `buildMetaEvent` + `page_id`.
3. Criar `src/server/meta-events.ts` (server-only) com:

```ts
export interface DispatchInput {
  kind: MetaEventKind; leadId: string; clientId: string;
  lead: { ctwaClid: string; remoteJid: string; leadEmail: string | null; contactName: string | null; adId: string };
  client: { metaCapiDatasetId: string | null; metaPageId: string | null };
  token: string; value?: number | null;
  trigger: "manual" | "keyword"; keyword?: string; messageExcerpt?: string; occurredAtMs?: number;
}
export async function dispatchMetaEvent(i: DispatchInput): Promise<{ ok: true; datasetId: string; pageId: string | null }>; // lança Error com a mensagem legível
```
   - Se `N8N_META_EVENTS_WEBHOOK_URL` e `N8N_WEBHOOK_SECRET` existem: `fetch` POST com header `x-webhook-secret`, corpo `{ adId, token, event, fallbackDatasetId, fallbackPageId }`, timeout 20 s (`AbortSignal.timeout`). Parsear JSON; se não for JSON, ou `ok !== true`, lançar `Error(error ?? "n8n sem resposta válida")`.
   - Sem as variáveis: caminho direto (dataset do cliente obrigatório; senão erro `Cliente sem "Identificação do conjunto de dados" configurada.`).
   - Em qualquer desfecho, inserir linha em `meta_event_log` (`sent`/`failed`, dataset/página usados, erro). Falha ao gravar o log nunca derruba o envio.

Verificar: teste manual com o workflow ativo (Tarefa 9). Typecheck: `npx tsc --noEmit` sem erro novo.

## Tarefa 4 — Botões passam pelo dispatcher

Em [src/server/lead-attribution.ts](../../../src/server/lead-attribution.ts):
- `sendQualifiedLeadEventWithStatus`: trocar `sendQualifiedLeadEvent`/`sendCustomMessagingEvent` por `dispatchMetaEvent` (`qualified` depois `lead`; o `lead` continua sem afetar o status se falhar). A validação "sem dataset" deixa de ser obrigatória quando o n8n está ligado (o anúncio fornece o pixel); manter a mensagem de erro só no caminho direto.
- `convertLeadToSaleCore`: trocar `sendPurchaseEvent` por `dispatchMetaEvent` (`purchase`, `value`).
- Carregar `adId`, `contactName` nos `lead` que as funções recebem (hoje só `ctwaClid/remoteJid/leadEmail`); ajustar `loadLeadWithClient*` e tipos.
- **Exportar** `qualifyLeadCore` e `convertLeadToSaleCore` (hoje privados) e adicionar parâmetro opcional `trigger: { trigger: "manual" | "keyword"; keyword?: string; messageExcerpt?: string; occurredAtMs?: number }` repassado ao dispatcher.
- Em [evolution-webhook.ts](../../../src/server/evolution-webhook.ts) `handleLabelAssociation`: trocar `sendQualifiedLeadEvent` por `dispatchMetaEvent` (`trigger: "manual"`, sem palavra).

Verificar: botões Qualificar/Converter e Reenviar funcionam como antes (caminho direto, variáveis do n8n ausentes).

## Tarefa 5 — Motor de palavra-chave

Criar `src/server/keyword-triggers.ts`:

```ts
export async function processKeywordMessage(args: {
  clientId: string; organizationId: string; remoteJid: string;
  fromMe: boolean; text: string; timestampMs: number;
}): Promise<void>
```
- Carrega regras ativas do cliente (`client_event_keywords`); se não houver, retorna.
- Acha o lead: `meta_lead_attributions` do cliente com o `remoteJid`, mais recente por `firstMessageAt`; sem lead → retorna.
- Para cada tipo (`qualified_lead`, `purchase`): `matchRule(...)`.
  - **qualified_lead**: dentro de `db.transaction`, `SELECT ... FOR UPDATE` do lead; se `status !== "pending"` retorna; senão chama `qualifyLeadCore(..., {trigger:"keyword", keyword, messageExcerpt, occurredAtMs})`.
  - **purchase**: transação com `FOR UPDATE`; se `saleId` já existe retorna; valor = `extractBrlAmount(text) ?? rule.defaultValue ?? null`; chama `convertLeadToSaleCore(...)`.
- Token: `pickMetaTokenRow({ organizationId, clientId })` (como em `handleNewMessage`), sem sessão de usuário.
- Erros: capturar e gravar (o core já registra falha no lead/log); nunca lançar pro webhook.
- `messageExcerpt` = primeiros 200 caracteres do texto.

Verificar: simular chamada com lead de teste; segunda chamada com o mesmo texto não duplica evento nem venda.

## Tarefa 6 — Webhook da Evolution

1. Em [evolution-webhook.ts](../../../src/server/evolution-webhook.ts) `handleEvolutionWebhook`: aceitar `eventName` `send.message` além de `messages.upsert`. Extrair `text` de `message.conversation` / `extendedTextMessage.text`.
2. `handleNewMessage` hoje faz `if (!envelope || envelope.fromMe) return;` — manter a captura de atribuição **só para mensagem recebida**, e chamar `processKeywordMessage` para qualquer mensagem de texto (recebida ou enviada) depois. Não alterar a captura de `ctwa_clid`.
3. Em [whatsapp-messages.ts:160](../../../src/lib/whatsapp-messages.ts#L160): `events: ["MESSAGES_UPSERT", "SEND_MESSAGE", "LABELS_ASSOCIATION"]`.
4. **Instâncias existentes** continuam assinadas só nos dois eventos antigos. Mensagens digitadas no celular chegam como `messages.upsert` com `fromMe: true` (já cobertas); mensagens enviadas por API só chegam com `SEND_MESSAGE`. Criar função de servidor `reconfigureEvolutionWebhook(instanceId)` (reusa `configureEvolutionWebhook`) e um botão/ação na página Conversões pra reaplicar numa instância, **ou** rodar uma vez por instância via script. Decidir na execução; não é bloqueante.

Verificar: com instância real de teste, mensagem enviada do celular com a palavra dispara; mensagem do lead com palavra de regra `team` não dispara.

## Tarefa 7 — Funções de servidor da página

Criar `src/server/event-keywords.ts` (padrão `createServerFn` + `assertAccessible`/`canAccessClient` como em lead-attribution.ts):
- `listEventKeywords(clientId)`, `addEventKeyword({clientId, eventType, keyword, source, defaultValue})` (normaliza, recusa duplicada com mensagem clara), `updateEventKeyword({id, active?, source?, defaultValue?})`, `deleteEventKeyword(id)`. Zod em todas as entradas; validar que a regra pertence a cliente acessível.
- `listMetaEventLog(clientId, limit=50)` (join por lead → cliente).
- `getConversionsReadiness(clientId)`: token da Meta válido, instância WhatsApp ligada, fallback de dataset/página cadastrado, e contagem de eventos `failed` com erro de "sem pixel" nos últimos 7 dias.

Verificar: gestor de outra organização recebe "não encontrado" (teste manual com dois usuários).

## Tarefa 8 — Página "Conversões"

- Rota `src/routes/conversoes.$id.tsx` (mesmo padrão de `report-deck.$id.tsx`; **não** usar `clients.$id.conversoes`, porque `clients.$id.tsx` não tem `<Outlet/>` e a rota filha não renderizaria).
- Link "Conversões" na página do cliente ([clients.$id.tsx](../../../src/routes/clients.$id.tsx), perto dos botões `report-deck`/`campaigns/new`).
- Conteúdo: duas listas (Lead qualificado / Compra) com adicionar, "Quem diz" (Equipe/Lead/Qualquer), valor padrão (só compra), liga/desliga, remover; bloco de prontidão; histórico do `meta_event_log`.
- Reaproveitar os componentes de UI e o estilo já usados em `clients.$id.tsx`. Textos em pt-BR. `routeTree.gen.ts` regenera com `vite dev`/`vite build`.

Verificar: abrir a página no navegador (`/run`), cadastrar, desativar e remover regras; acesso restrito por organização.

## Tarefa 9 — Rollout e validação real

1. **Antes de ativar o n8n**: obter do usuário o JSON de `GET /{ad_id}?fields=tracking_specs` de um anúncio com pixel de mensagem (ex.: LF Motors, pixel `1864811938052411`) e rodar o código de extração do workflow sobre ele. Confirmar dataset e página; tratar mais de um pixel/página se aparecer (escolher o que bate com o conjunto de dados do cliente).
2. No EasyPanel (app): `N8N_META_EVENTS_WEBHOOK_URL=https://triadcompany-n8n.upw28y.easypanel.host/webhook/enviar-evento-meta` e `N8N_WEBHOOK_SECRET` (valor em `~/.claude/credentials/n8n.env`; o usuário cola, não passa pelo chat).
3. Ativar o workflow `XG7y45CDpadiY6jQ` no n8n (API: `POST /api/v1/workflows/{id}/activate`). Considerar desligar "salvar execuções com sucesso" nele (o corpo inclui o token).
4. Deploy; testar com um cliente real: Qualificar por botão, Converter por botão, palavra de qualificado e palavra de compra com `R$`. Conferir no **Test Events** do Gerenciador de Eventos: dataset do anúncio, `event_id`, valor e `page_id`.
5. Só depois de validado: remover o caminho direto num passo à parte.
6. `package.json` version 1.0.156 → 1.0.157, commit e push (o usuário faz o deploy no EasyPanel).

## Riscos conhecidos

- `tracking_specs` real pode divergir do esperado (Tarefa 9.1 existe pra isso).
- Evolution pode não entregar `fromMe` em `messages.upsert` nas instâncias atuais (Tarefa 6.4).
- Token trafega no corpo para o n8n; mitigado por segredo no webhook e retenção curta.
- Mudanças só de código e variáveis de ambiente; **nada no app da Meta** é alterado.
