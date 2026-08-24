# Destino configurável dos envios manuais (WhatsApp) — Design Spec

**Data:** 2026-08-20
**Status:** Aprovado pelo usuário

---

## Contexto

Hoje o app tem dois botões de envio manual via WhatsApp (na página do cliente): "Enviar lista de campanhas ativas" e "Enviar relatório semanal de métricas". Os dois sempre mandam pro grupo fixo "Operacional Triad Company". O usuário quer poder escolher, em Configurações, se cada um desses envios vai pro grupo Operacional ou pro grupo do próprio cliente (o mesmo vínculo `whatsapp_group_id` criado pro recurso "Resumidor de Grupo").

A escolha é **global** (uma config por tipo de envio, vale pra todos os clientes) — não é por cliente.

---

## Escopo

### Config (`app_config`)

Duas chaves novas, valores `"operacional"` ou `"client_group"`, padrão `"operacional"` (mantém o comportamento atual quando não configurado):
- `campaigns_list_destination`
- `weekly_report_destination`

### Configurações (`settings.tsx`)

Nova seção "Destino dos envios manuais" com dois seletores (um por tipo de envio), cada um com as duas opções. Salva automaticamente ao trocar o valor (sem botão "Salvar" separado).

Novas funções em `src/lib/meta.ts`:
- `getSendDestinations(): Promise<{ campaignsListDestination: "operacional" | "client_group"; weeklyReportDestination: "operacional" | "client_group" }>`
- `saveSendDestinations(data: { campaignsListDestination: ...; weeklyReportDestination: ... }): Promise<void>`

### Lógica de envio

Ambas as funções de envio passam a resolver o destino assim:
1. Lê a config correspondente (`campaigns_list_destination` ou `weekly_report_destination`).
2. Se `"operacional"` → grupo fixo (`whatsapp_group_operacional_id`), como hoje.
3. Se `"client_group"` → usa `whatsapp_group_id` do cliente, se existir.
4. Se `"client_group"` mas o cliente não tem grupo vinculado → cai automaticamente pro grupo Operacional (sem bloquear o envio).

**`sendActiveCampaignsList`** (`src/lib/whatsapp-messages.ts`): assinatura muda de `(clientName, campaignNames)` para `(clientId, clientName, campaignNames)`, pra poder buscar `whatsapp_group_id` do cliente quando a config for `"client_group"`. Call site em `clients.$id.tsx` atualizado.

**`sendWeeklyMetricsReport`** (`src/lib/meta.ts`): já recebe `clientId`; a query que já busca o cliente passa a incluir `whatsappGroupId` também.

---

## Fora de escopo

- Configuração por cliente (fica só global, por enquanto).
- Novos tipos de envio além dos dois já existentes.
- Editar o `whatsapp_group_operacional_id` ou `whatsapp_group_id` por essa tela — isso já é feito em outro lugar (app_config direto / Editar cliente).

---

## Casos de erro

| Situação | Comportamento |
|---|---|
| Config ausente (nunca configurada) | Trata como `"operacional"` (comportamento atual) |
| `"client_group"` + cliente sem `whatsapp_group_id` | Cai pro Operacional automaticamente, sem erro visível |
| `"client_group"` + cliente com grupo vinculado | Envia pro grupo do cliente normalmente |

---

## Verificação

1. `npx tsc --noEmit` e `npm run build` limpos.
2. Trocar a config de "Lista de campanhas ativas" pra "Grupo do cliente", testar em um cliente COM grupo vinculado → mensagem chega no grupo do cliente.
3. Testar em um cliente SEM grupo vinculado → mensagem cai no Operacional mesmo assim.
4. Repetir os dois testes acima pro "Relatório 7 dias".
5. Voltar as configs pra "Operacional" e confirmar que volta ao comportamento original.
