# Relatório semanal de métricas via WhatsApp — Design Spec

**Data:** 2026-08-20
**Status:** Aprovado pelo usuário

---

## Contexto

O usuário quer, com um clique na página do cliente, enviar um relatório semanal de métricas (últimos 7 dias) pro grupo **"Operacional Triad Company"**, com o texto:

```
🎯Olá pessoal, segue Relatório semanal das Métricas dos últimos 7 dias dos anúncios:

▪️Impressões: {impressões}
▪️Número de mensagens: {leads}
▪️Custo por mensagem: R$ {custo por mensagem}
▪️Investimento: R$ {investimento}

Dos carros que estamos anunciando, quais estão tendo mais dificuldade nas negociações e quais objeções?
Vou usar esse feedback para melhorar o tráfego!
```

Mesma lógica do botão já existente "Enviar lista de campanhas ativas" (`sendActiveCampaignsList`) — mesmo destino fixo (grupo Operacional), mesmo padrão de botão na página do cliente.

---

## Escopo

- **`fetchAccountInsightsForRange`** (`src/lib/meta.ts`): estender o retorno pra incluir `impressions` (hoje só retorna `spend`, `leads`, `forms`).
- **Nova função `sendWeeklyMetricsReport(clientId: string)`** em `src/lib/meta.ts`:
  1. Busca `name` e `meta_ad_account_id` do cliente no banco.
  2. `requireMetaToken()` (já existe).
  3. `since` = hoje − 7 dias, `until` = hoje.
  4. `fetchAccountInsightsForRange(adAccountId, token, since, until)` → `{ spend, leads, impressions }`.
  5. `custoPorMensagem = leads > 0 ? spend / leads : 0`.
  6. Monta o texto exatamente no formato acima, com `impressions` formatado com separador de milhar (`toLocaleString('pt-BR')`) e os dois valores em reais formatados como moeda (`toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })`).
  7. Envia via Evolution API pro grupo Operacional (reaproveita `getEvolutionConfig`, que será exportado de `whatsapp-messages.ts` pra ser usado aqui também).
- **Botão novo** em `clients.$id.tsx`, ao lado do botão "Enviar lista de campanhas ativas": ícone de gráfico (`BarChart3` ou similar), chama `sendWeeklyMetricsReport(client.id)` via `useMutation`, com toast de sucesso/erro no mesmo padrão do botão vizinho.

## Fora de escopo

- Listar os carros específicos com dificuldade — isso é a pergunta que VAI pro grupo, não algo calculado pelo sistema.
- Qualquer configuração de período diferente de "últimos 7 dias" pela interface — fica fixo, igual aos outros botões de disparo manual.
- Agendamento automático desse envio — é sempre manual, um clique por vez.

---

## Casos de erro

| Situação | Comportamento |
|---|---|
| Cliente sem nenhuma mensagem nos últimos 7 dias | Mostra "Custo por mensagem: R$ 0,00" (sem lógica condicional extra pra omitir a linha) |
| Erro na API da Meta ou na Evolution API | `useMutation` mostra toast de erro, mesmo padrão dos outros botões de disparo |

---

## Verificação

1. `npx tsc --noEmit` limpo (só os erros pré-existentes não relacionados).
2. `npm run build` sem erros.
3. Testar em um cliente real com dados recentes, conferir que os números batem com o que aparece na página do cliente.
4. Conferir a mensagem chegando formatada corretamente no grupo Operacional.
