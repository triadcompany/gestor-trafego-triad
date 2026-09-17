# Rastreamento de leads do Meta Ads até a qualificação no WhatsApp — design

## Motivação

Hoje o app sabe quanto cada campanha/conjunto/anúncio gastou e quantos leads
a Meta reporta (via `actions` do próprio anúncio), mas não sabe o que
acontece **depois** que o lead cai no WhatsApp: se aquele contato específico
veio daquele anúncio específico, e se virou um lead bom ou não. O gestor
qualifica isso manualmente hoje, etiquetando a conversa no WhatsApp Business
do celular — mas esse sinal nunca volta pro app nem pra Meta.

O pedido: (1) saber de qual campanha/conjunto/anúncio cada conversa de
WhatsApp veio, (2) quando o gestor/cliente etiquetar a conversa como "lead
qualificado", mandar um evento de conversão pra Meta atribuído àquele
anúncio (pra ela otimizar entrega por qualidade, não só por volume), e (3)
ver tudo isso num painel por cliente.

## Descobertas da pesquisa técnica (por que o design é este)

- A Meta injeta um identificador (`ctwa_clid`) + o `source_id` (id do
  anúncio clicado) na **primeira mensagem** de toda conversa iniciada por um
  anúncio "Clique para o WhatsApp". Isso é o único jeito de atribuir um
  contato a um anúncio — não existe alternativa via UTM ou link.
- A Evolution API (que já usamos) **descarta esse dado hoje** ao emitir seus
  eventos — bug aberto e sem previsão de correção no projeto
  (`evolution-foundation/evolution-api#2645`). Existe um patch documentado
  pela comunidade (arquivo compilado, ~3 linhas) que resolve.
- Pesquisei alternativas (WAHA, WPPConnect, Uazapi, Z-API): nenhuma tem
  suporte comprovado e melhor pra esse campo especificamente — é uma
  limitação da categoria toda de APIs não-oficiais em 2026, não uma
  particularidade da Evolution API. Migrar de ferramenta teria custo alto
  (refazer toda a integração atual: automações de mensagem, sugestões de
  venda) sem garantia de resolver o problema.
- Considerei também migrar pra API oficial da Meta (Cloud API, no modo
  "Coexistência", disponível no Brasil desde abril/2026) — resolveria o
  `ctwa_clid` de forma suportada, mas **não sincroniza etiquetas** do
  WhatsApp Business App (confirmado na documentação oficial: só
  `history`, `smb_app_state_sync` e `smb_message_echoes`, nada de labels).
  Ou seja, mesmo migrando, ainda precisaríamos manter a Evolution API rodando
  só pra etiqueta — duas integrações Meta por cliente em vez de uma, e cada
  cliente novo teria que passar pela verificação de negócio da própria Meta
  (fricção que se repete pra sempre, a cada cliente novo). **Decisão do
  usuário: não vale a pena — seguir só com o patch na Evolution API.**
- A Evolution API também não expõe "quais etiquetas essa conversa tem" via
  consulta (endpoint `findChats` não traz labels — pedido em aberto,
  `evolution-foundation/evolution-api#2315`). O único jeito confiável de
  saber que uma etiqueta foi aplicada é reagir ao evento de webhook
  `LABELS_ASSOCIATION` em tempo real (confirmado que funciona quando a
  etiqueta é aplicada pelo celular, que é o fluxo real de uso aqui).
- Consequência prática: **este é o primeiro recurso do app que precisa
  receber webhook** (tudo que existe hoje — sugestões de venda, resumo de
  grupo — só faz polling puxando dados da Evolution API). Não dá pra evitar,
  dado o ponto acima.

## Visão geral do fluxo

```
Meta Ads (CTWA) → clique → WhatsApp do cliente (1ª mensagem com ctwa_clid + source_id)
                                    │
                                    ▼
                    Evolution API (patched) — webhook messages.upsert
                                    │
                                    ▼
                 POST /api/webhooks/evolution  (novo, neste app)
                                    │
                    resolve anúncio → conjunto → campanha (Meta Graph API)
                                    │
                                    ▼
                       grava em `meta_lead_attributions` (status: pending)

   [tempo depois, gestor/cliente etiqueta a conversa no celular]
                                    │
                                    ▼
                 Evolution API — webhook labels.association
                                    │
                                    ▼
                 POST /api/webhooks/evolution  (mesmo endpoint)
                                    │
       nome da etiqueta bate com a configurada nesse cliente?
                                    │ sim
                                    ▼
     marca lead como `qualified` + dispara evento `QualifiedLead`
     pra Conversions API da Meta (action_source=business_messaging,
     messaging_channel=whatsapp, user_data.ctwa_clid=<salvo>)
```

## Modelo de dados

### Tabela nova `meta_lead_attributions`

| coluna | tipo | notas |
|---|---|---|
| `id` | uuid pk | |
| `client_id` | uuid, fk `clients.id` (cascade) | |
| `remote_jid` | text | telefone/contato do WhatsApp (formato Evolution) |
| `contact_name` | text nullable | nome salvo no WhatsApp, se vier |
| `ctwa_clid` | text | id de clique da Meta — nunca hasheado, vai direto pra CAPI |
| `ad_id` / `ad_name` | text | |
| `adset_id` / `adset_name` | text | |
| `campaign_id` / `campaign_name` | text | nomes denormalizados — se o anúncio for apagado depois na Meta, o histórico continua legível |
| `first_message_at` | timestamp | quando a conversa começou |
| `status` | text | `pending` \| `qualified` \| `conversion_sent` \| `conversion_failed`, default `pending` |
| `qualified_at` | timestamp nullable | |
| `label_name` | text nullable | etiqueta exata que qualificou (auditoria) |
| `conversion_sent_at` | timestamp nullable | |
| `conversion_error` | text nullable | erro da Meta, se `conversion_failed` |
| `created_at` | timestamp default now | |

Índice único em (`client_id`, `remote_jid`, `first_message_at`) — evita
duplicar se o webhook reentregar o mesmo evento (Evolution API não garante
entrega única).

### Coluna nova em `clients`

`qualified_lead_label: text nullable` — nome exato da etiqueta que, quando
aplicada, marca o lead como qualificado. Configurável na tela do cliente
(dropdown com as etiquetas reais daquela instância, buscadas via
`GET /label/findLabels/{instance}` da Evolution API). Cliente sem essa
etiqueta configurada simplesmente não participa do rastreamento de
qualificação (mas a atribuição de campanha/conjunto/anúncio continua
funcionando normalmente, já que não depende disso).

## Endpoint novo: `POST /api/webhooks/evolution`

Segue o mesmo padrão de `automations-tick.route.ts` (handler h3 registrado
em `vite.config.ts`, sem sessão de usuário — roda cross-org).

- **Autenticação**: por um parâmetro na própria URL do webhook
  (`?secret=...`), configurado no setup, contra a env var
  `EVOLUTION_WEBHOOK_SECRET` — não depende de header customizado (suporte a
  isso no `/webhook/set` varia entre versões da Evolution API). O handler
  resolve o cliente pelo campo `instance` do corpo do evento.
- **Idempotência**: cada evento processado é checado contra o índice único
  da tabela antes de gravar — reentrega não duplica.
- **Eventos tratados**:
  - `messages.upsert`, só a primeira mensagem de uma conversa nova
    (`fromMe: false`), só se vier com o campo de referral (após o patch).
    Resolve `ad_id → adset/campaign` via uma chamada nova em `meta.ts`
    (`fetchAdContext(adId, token)`), usando o token Meta do gestor dono do
    cliente (mesma resolução que já existe hoje). Grava a atribuição.
  - `labels.association`: resolve o cliente pela instância + `remoteJid`,
    confere se o nome da etiqueta bate com `clients.qualified_lead_label`.
    Se bater: atualiza a atribuição pendente daquele contato pra
    `qualified` e dispara o evento de conversão (função nova
    `sendQualifiedLeadEvent` em `meta.ts`, reaproveitando o padrão de
    `withRetry`/`fetchMetaJson` já usado no resto do arquivo). Sucesso vira
    `conversion_sent`; falha vira `conversion_failed` com o erro da Meta
    salvo (nunca falha silenciosamente).
  - Qualquer outro evento é ignorado (200, sem processar).

## Setup operacional (uma vez, não recorrente)

1. Aplicar o patch documentado da comunidade em cada deployment distinto de
   Evolution API em uso (identificar todas as `evolution_url` distintas na
   tabela `whatsapp_instances` — pode ser mais de uma).
2. Configurar o webhook de cada instância pra apontar pro endpoint novo,
   com os eventos `MESSAGES_UPSERT` e `LABELS_ASSOCIATION` habilitados
   (`POST {evolutionUrl}/webhook/set/{instance}` — script único, não
   manual por cliente).
3. Cada gestor regenera seu token Meta (mesma tela de Configurações de
   hoje) incluindo as permissões `whatsapp_business_management` e
   `whatsapp_business_manage_events`, além das que já usa.
4. Por cliente que participa da qualificação: escolher a etiqueta em
   Configurações do cliente.

## Painel (dashboard)

Novo, por cliente: uma aba a mais na página do cliente (`clients.$id.tsx`),
ao lado das que já existem, com:

- **Lista de leads com origem**: contato, data, campanha/conjunto/anúncio,
  status (pendente/qualificado/evento enviado/falhou).
- **Métricas por campanha**: conversas iniciadas × qualificadas × taxa de
  qualificação, agrupado por campanha/conjunto/anúncio.
- **Custo por lead qualificado**: gasto da campanha (já rastreado hoje) ÷
  leads qualificados dela — ao lado do CPL de hoje (gasto ÷ todos os leads),
  pra comparar lado a lado.
- **Indicador de saúde da atribuição**: compara conversas novas dos últimos
  N dias vs. quantas vieram com `ctwa_clid` capturado. Cliente com campanha
  ativa gastando e zero atribuição nova é sinal de que o patch da Evolution
  API quebrou (ex.: depois de um update de imagem no EasyPanel) — alerta
  visível, não silencioso.

## Limitações (v1, conhecidas e aceitas)

- `ctwa_clid` só existe na primeira mensagem de conversas **novas** — não
  dá pra atribuir retroativamente conversas que já existiam antes de ligar
  isso.
- Depende de um patch não-oficial na Evolution API — mitigado pelo
  indicador de saúde, não eliminado. Se a Evolution API for atualizada no
  EasyPanel, o patch precisa ser reaplicado.
- Etiqueta precisa ser exatamente a configurada (comparação por nome, sem
  fuzzy match) — etiqueta renomeada no WhatsApp do cliente para de bater até
  alguém atualizar a configuração.
- Evento de conversão é `QualifiedLead` (evento customizado aceito pela
  Meta) — não é um dos eventos "padrão" dela; a Meta pode ou não usar isso
  pra otimizar automaticamente dependendo da configuração de otimização de
  cada conjunto de anúncios (fora do controle deste app).

## Fora de escopo (v1)

- Editar/gerenciar etiquetas do WhatsApp pela UI do app — só leitura, pra
  popular o dropdown de configuração.
- Suporte a outros canais de anúncio "click to" (Instagram Direct,
  Messenger) — só Click-to-WhatsApp.
- Reatribuição manual de um lead a um anúncio diferente, caso a atribuição
  automática erre.

## Migração

Uma migração: `CREATE TABLE meta_lead_attributions` + `ALTER TABLE clients
ADD COLUMN qualified_lead_label`. Gerada via `drizzle-kit generate`,
aplicada manualmente via psql no console do EasyPanel (fluxo já em uso no
projeto).
