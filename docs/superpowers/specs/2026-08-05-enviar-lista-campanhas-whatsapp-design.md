# Enviar lista de campanhas ativas via WhatsApp — Design Spec

**Data:** 2026-08-05
**Status:** Aprovado pelo usuário

---

## Contexto

Na página do cliente (`src/routes/clients.$id.tsx`), o usuário quer um botão que envia, via WhatsApp, a lista de campanhas ativas daquele cliente para um grupo fixo da equipe: **"Operacional Triad Company"**.

Já existe toda a infraestrutura de envio de WhatsApp construída para a feature de Mensagens Agendadas (`src/lib/whatsapp-messages.ts`): a instância Evolution API já configurada (`evolution_api_url`/`evolution_api_key`/`evolution_instance` em `app_config`), reaproveitada aqui sem nenhuma mudança de infraestrutura.

O grupo de destino já foi localizado: `120363405009763956@g.us`.

---

## Escopo

- Botão único, sem confirmação extra (ação simples e reversível — só manda uma mensagem de texto).
- Mensagem contém: nome do cliente + lista das campanhas com `status: ACTIVE` no momento do clique, uma por linha.
- Envio é imediato — chama a Evolution API direto do servidor, sem passar pelo sistema de agendamento (`scheduled_messages`/n8n). Não há necessidade de fila para uma ação pontual e síncrona.
- Grupo é fixo, guardado em `app_config` (mesmo padrão das outras chaves da Evolution API) — não há busca dinâmica por nome a cada clique.

## Fora de escopo

- Selecionar destinatário diferente do grupo fixo.
- Incluir métricas (Gasto/Leads/CPL) na lista — só nomes.
- Agendar esse envio para o futuro (é sempre imediato).
- Histórico de envios dessa lista (diferente da página Mensagens, que já tem histórico para mensagens agendadas).

---

## Implementação

### Config

Novo valor em `app_config`: `whatsapp_group_operacional_id` = `120363405009763956@g.us`.

### Server function

Nova função em `src/lib/whatsapp-messages.ts`:

```ts
export async function sendActiveCampaignsList(clientName: string, campaignNames: string[]): Promise<void>
```

Monta o texto (`📋 Campanhas ativas — {clientName}\n\n` + `• {nome}` por linha) e faz `POST {evolution_api_url}/message/sendText/{evolution_instance}` com header `apikey`, body `{ number: whatsapp_group_operacional_id, text }` — mesmo padrão de chamada já usado no workflow n8n e coerente com `searchEvolutionRecipients` já existente no mesmo arquivo.

### UI

Em `clients.$id.tsx`, na barra da seção "Campanhas" (`src/routes/clients.$id.tsx:698-722`), ao lado do botão de atualizar (RefreshCw) e antes de "Nova Campanha": um `Button` ícone (ex: `MessageCircle`) com tooltip "Enviar lista de campanhas ativas no WhatsApp". Ao clicar, filtra `campaigns` (já carregado na página) por `status === "ACTIVE"`, chama a server function, mostra toast de sucesso/erro. Desabilitado enquanto não há campanhas ativas.

---

## Casos de erro

| Situação | Comportamento |
|---|---|
| Nenhuma campanha ativa no momento | Botão desabilitado, tooltip explica o motivo |
| Evolution API fora do ar / erro no envio | Toast de erro com a mensagem retornada; usuário pode tentar de novo |
| `whatsapp_group_operacional_id` não configurado | Erro claro ("Grupo de destino não configurado") em vez de falha silenciosa |

---

## Verificação

1. `npx tsc --noEmit` limpo (só o erro pré-existente não relacionado).
2. `npm run build` local sem erros.
3. Clicar no botão num cliente com campanhas ativas, confirmar que a mensagem chega no grupo "Operacional Triad Company" com os nomes corretos.
4. Testar num cliente sem campanhas ativas — botão desabilitado.
5. Deploy e verificação em produção.
