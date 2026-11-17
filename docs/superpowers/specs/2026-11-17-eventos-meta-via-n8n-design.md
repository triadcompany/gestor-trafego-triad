# Eventos de conversão da Meta via n8n (lead qualificado e compra)

Data: 2026-11-17 · Status: aguardando revisão do usuário

## Objetivo

Todo envio de `QualifiedLead`, `LeadSubmitted` e `Purchase` pra Conversions API da Meta passa a sair por **um workflow do n8n**, em vez de o servidor do app chamar a Meta direto. Dois gatilhos:

1. **Botões** "Qualificar" e "Converter" (como hoje).
2. **Palavra-chave** na conversa, configurada **por cliente** numa página do sistema.

Referência: três workflows de aula enviados pelo usuário (lead, purchase, atribuição de anúncio). Deles aproveitamos a descoberta do pixel pelo anúncio (`tracking_specs`), a regra "mensagem da equipe contém a palavra" e a ideia de `event_id` pra deduplicar na Meta. Não copiamos o banco próprio deles (`whatsapp_anuncio`), que repete `meta_lead_attributions`.

## Decisões já tomadas

| Tema | Decisão |
|---|---|
| Onde fica a lógica | App detecta, decide e guarda status. n8n só descobre o pixel e envia pra Meta (sem banco, sem regra de negócio). Motivo: isolamento entre gestores e clientes fica numa checagem só (`canAccessClient`). |
| Pixel / página | Descobertos **pelo anúncio** (`GET /{ad_id}?fields=tracking_specs`). `metaCapiDatasetId` e `metaPageId` do cliente viram só alternativa quando o anúncio não devolve pixel. |
| Quem diz a palavra | Seletor por regra: `team` (padrão), `lead` ou `any`. |
| Match | Texto normalizado (minúsculas, sem acento), vale se **contiver** a palavra. |
| Valor da compra | Primeiro `R$ <número>` achado na mensagem que contém a palavra (formato BR: `1.500,00`, `1500`, `R$1`). Se não achar, usa o valor padrão da regra; se também não houver, envia sem valor. |
| Duplicidade | Uma vez por lead e por tipo de evento. `event_id` determinístico manda a deduplicação pra Meta também. |
| Produto e código de transação | Fora do escopo agora. Podem virar opcionais se algum cliente pedir. |

## Arquitetura

```
Botão / palavra-chave
        │
        ▼
 dispatchMetaEvent()  (app, server-only)
  - monta o evento (hash do telefone/e-mail/nome, ctwa_clid, event_id, event_time, valor)
  - resolve token do cliente
  - chama o webhook do n8n
        │  POST + header x-webhook-secret
        ▼
 n8n "Enviar evento Meta"
  Webhook → GET tracking_specs → Code (extrai dataset/page) → [usa alternativa do payload se vazio]
        → POST {dataset}/events → Respond to Webhook ({ok, datasetId, pageId, metaResponse | error})
        │
        ▼
 app grava status no lead + linha em meta_event_log
```

- **Resposta síncrona**: a chamada `/events` é rápida, então o n8n responde na mesma requisição. Sem callback e sem polling (diferente do fluxo de campanhas).
- **Payload app → n8n**: `{ adId, token, eventName, event, fallbackDatasetId?, fallbackPageId? }`. `event` é o objeto completo do evento **sem `page_id`**; o n8n injeta `user_data.page_id` com a página descoberta.
- **Variáveis de ambiente**: `N8N_META_EVENTS_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`. Enquanto a URL não existir, o app envia direto como hoje (transição). Depois de validar o n8n em produção, remove-se o caminho direto.
- **Hash**: continua no app (`buildMetaUserData`), então o n8n nunca vê telefone ou e-mail em texto puro.

### Melhorias no evento (vindas dos fluxos de aula)

- `event_id` em todos: `{leadId}:qualified`, `{leadId}:lead`, `{leadId}:purchase`.
- `event_time` = horário da mensagem que disparou (palavra-chave) ou do clique (botão), não o de processamento. A Meta só aceita até 7 dias atrás.
- `fn` e `ln` hasheados (minúsculas, sem espaço nas pontas) a partir de `contactName`, **só quando existirem**. Campo vazio é omitido; nunca hashear string vazia.

## Gatilho por palavra-chave

Entrada: webhook da Evolution ([evolution-webhook.ts](../../../src/server/evolution-webhook.ts)). Hoje ele trata só `messages.upsert` de mensagem **recebida** (`fromMe` é descartado) e `labels.association`.

Mudanças:
- Tratar também mensagens **da equipe**: `messages.upsert` com `fromMe: true` e o evento `send.message` (que é o usado no fluxo de aula pra mensagens enviadas). O comportamento atual de captura de atribuição (mensagem do lead com `ctwa_clid`) não muda.
- Pra cada mensagem de texto, carregar as regras ativas do cliente, normalizar o texto e testar cada palavra, respeitando o seletor de quem disse (`fromMe` = equipe).
- Achou regra:
  - `qualified_lead`: se o lead está `pending`, marca `qualified` e envia `QualifiedLead` + `LeadSubmitted` (mesma função do botão).
  - `purchase`: se o lead não tem venda, cria a venda (como o botão Converter) com o valor extraído, ou o padrão da regra, ou `null`, e envia `Purchase`.
- Lead = a atribuição mais recente do cliente pra aquele `remoteJid`. Sem atribuição (`ctwa_clid`), ignora.
- **Uma vez só**: a transição (`pending` → `qualified`, e "sem venda" → "com venda") ocorre dentro de uma transação com a linha do lead travada. Reentrega da mesma mensagem pela Evolution não duplica evento.
- Em caso de várias regras batendo na mesma mensagem, vale uma por tipo (a primeira); as duas podem disparar (qualificado e compra) se forem de tipos diferentes.

## Dados

**Tabela nova `client_event_keywords`**

| Coluna | Tipo | Nota |
|---|---|---|
| id | uuid pk | |
| client_id | uuid fk → clients, cascade | |
| event_type | text | `qualified_lead` \| `purchase` |
| keyword | text | como o gestor digitou |
| keyword_normalized | text | minúsculas, sem acento; única por (client_id, event_type) |
| source | text | `team` (padrão) \| `lead` \| `any` |
| default_value | numeric null | só `purchase` |
| active | boolean | padrão true |
| created_at | timestamp | |

**Tabela nova `meta_event_log`**: `id`, `lead_id` (fk, cascade), `event_type` (`qualified` \| `lead` \| `purchase`), `trigger` (`manual` \| `keyword`), `keyword` null, `message_excerpt` null (até 200 caracteres), `dataset_id` null, `page_id` null, `event_id`, `status` (`sent` \| `failed`), `error` null, `created_at`. Alimenta o histórico da página e dá auditoria.

`meta_lead_attributions` continua com seus campos de status (`conversion_sent`, `conversion_failed`, `purchase_event_*`), pra não quebrar a lista de leads e o botão Reenviar. O dataset/página efetivamente usados ficam no `meta_event_log`.

As duas tabelas precisam ser declaradas em [schema.ts](../../../src/db/schema.ts) (Drizzle, `pgTable`). Conferir na implementação como o deploy aplica o schema; se for `db push`, tabela sem model declarado é apagada a cada restart.

## Página "Conversões" (por cliente)

Rota nova dentro do cliente, p.ex. `clients.$id.conversoes.tsx`, com link na página do cliente.

- **Duas listas**: "Lead qualificado" e "Compra". Em cada uma: adicionar palavra, escolher quem diz (Equipe / Lead / Qualquer), valor padrão (só compra), ligar/desligar e remover.
- **Prontidão**: mostra se o cliente tem token da Meta válido e instância de WhatsApp ligada; e avisa quando leads recentes vieram de anúncio **sem pixel de mensagem** (dataset não encontrado no `tracking_specs` e sem alternativa cadastrada), em vez de falhar calado.
- **Histórico**: últimos eventos de `meta_event_log` (tipo, gatilho, palavra, trecho da mensagem, dataset usado, status/erro).
- Acesso pela mesma regra de organização/gestor dos demais dados do cliente. Palavras duplicadas (mesma palavra normalizada no mesmo tipo) são recusadas.

## Erros e segurança

- n8n fora do ar, resposta não-ok ou Meta recusando: o lead fica `conversion_failed` (ou `purchase_event_error`) com a mensagem, e o botão Reenviar atual funciona. `meta_event_log` registra `failed`.
- O webhook do n8n exige `x-webhook-secret`; sem ele responde 401 e não chama a Meta.
- O token da Meta vai no corpo da chamada ao n8n, por HTTPS, como já acontece no fluxo de campanhas. Cada chamada usa o token do próprio cliente, então só enxerga o que aquele cliente permite. Observação: as execuções do n8n guardam o corpo; manter a retenção curta ou desligar "salvar execuções com sucesso" nesse workflow.
- Nenhuma palavra-chave dispara sem `ctwa_clid`; mensagens do tipo texto apenas.

## Entregáveis

1. `dispatchMetaEvent()` + ajuste de [meta-capi.ts](../../../src/server/meta-capi.ts) (event_id, event_time, fn/ln, sem page_id) e dos pontos de chamada em [lead-attribution.ts](../../../src/server/lead-attribution.ts) e [evolution-webhook.ts](../../../src/server/evolution-webhook.ts).
2. Detector de palavra-chave (normalização, match, extração de valor) como módulo puro e testável.
3. Tabelas `client_event_keywords` e `meta_event_log` + funções de servidor de CRUD das regras.
4. Página "Conversões".
5. `docs/n8n-meta-events-workflow.json` pra importar no n8n (o MCP do n8n não conectou nesta sessão, então o workflow não é criado direto lá).
6. Incremento de `package.json#version` (patch) antes de cada commit+push.

## Testes

- Unitários (módulo puro): normalização com acento e caixa; "contém"; seletor de quem diz; extração de valor (`R$ 1.500,00`, `R$1`, `R$ 1500`, `R$ 12,5`, sem valor, vários valores = primeiro); `event_id`.
- Integração do detector com o webhook: mensagem da equipe com palavra → um evento; reentrega → continua um; lead sem `ctwa_clid` → nenhum; regra inativa → nenhum.
- Manual: importar o workflow, apontar a variável, disparar um evento e conferir no Test Events do Gerenciador de Eventos (dataset do anúncio, `event_id`, valor).

## Fora de escopo

- Produto e código de transação como campos próprios.
- Remover o envio direto (será feito depois de validar o n8n em produção).
- Vincular automaticamente o app às contas de anúncios (`advertisable_applications`), tratado à parte, após a aprovação da Meta.
- Mexer no App Review: **nada disto é alterado enquanto a análise da Meta estiver em andamento**.

## Pontos a confirmar na implementação

- Quais eventos a Evolution realmente entrega pro webhook das instâncias (`send.message`, `messages.upsert` com `fromMe`). O código atual só assina `messages.upsert` e `labels.association`; pode ser preciso habilitar `send.message` na instância.
- Formato real do `tracking_specs` de anúncio de mensagem (chave `dataset` vs `fb_pixel`); o código de extração do fluxo de aula trata os dois.
