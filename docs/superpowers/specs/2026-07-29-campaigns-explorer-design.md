# Explorador de Campanhas — Abas por nível, edição rápida e colunas customizáveis

**Data:** 2026-07-29
**Status:** Aprovado pelo usuário

---

## Contexto

Hoje, na página do cliente (`src/routes/clients.$id.tsx`), a tabela de campanhas mostra só o nível de campanha, com colunas fixas (Campanha, Status, Orçamento/dia, Gasto, Leads, CPL, Impressões, Cliques, CTR, CPM). Clicar numa linha abre um painel lateral (`CampaignSheet`) que já mostra os conjuntos de anúncios daquela campanha e os anúncios de cada conjunto, com edição de orçamento por conjunto — mas só um nível de cada vez, aninhado, sem visão consolidada.

O usuário quer algo mais parecido com o Gerenciador de Anúncios da Meta (print de referência anexado durante o brainstorming): abas pra trocar entre ver Campanhas / Conjuntos / Anúncios como listas completas, com seleção que filtra entre os níveis, edição rápida de orçamento e status direto na tabela, e colunas que dá pra escolher/reordenar. **Não** é pra replicar a tela inteira da Meta — fica de fora qualquer coisa como Teste A/B, Estratégia de lance, Configuração de atribuição, Detalhamento, Agrupamento, recomendações automáticas.

## Decisões já validadas com o usuário

- **Filtro entre abas**: selecionar campanha(s) na aba Campanhas filtra os conjuntos/anúncios mostrados nas outras abas pra só os daquelas campanhas — igual à Meta. Sem seleção, cada aba mostra tudo do cliente.
- **Colunas**: só as métricas que o app já busca da Meta (status, orçamento, gasto, leads, CPL, impressões, cliques, CTR, CPM) — sem buscar dados novos da API por enquanto.
- **Persistência de colunas**: salva no `localStorage`, lembrada entre visitas.
- **Painel lateral (`CampaignSheet`)**: continua existindo. A tabela nova cobre toggle de status e edição de orçamento; o painel continua sendo o lugar pra criativo, público e outras edições que a tabela não cobre. Clicar no nome de uma linha abre o painel.
- **Edição de orçamento inline**: nos dois níveis que têm orçamento — campanha (quando usa orçamento no nível de campanha, CBO) e conjunto. Anúncio não tem orçamento próprio na Meta, então a aba Anúncios não tem essa coluna.

## Camada de dados (`src/lib/meta.ts`)

`fetchAdSets(campaignId, token)` e `fetchAds(adSetId, token)` hoje buscam por campanha/conjunto específico e não trazem métricas de performance (só `id, name, status, daily_budget, optimization_goal` pra conjunto e `id, name, status, thumbnail_url` pra anúncio) — foram feitas pra alimentar o painel lateral, que já sabe em qual campanha/conjunto está.

Novas funções, seguindo exatamente o padrão já usado em `fetchCampaigns` (busca os objetos + busca `insights` em paralelo, junta pelo ID):

- **`fetchAllAdSets(adAccountId, token, datePreset, customRange)`**: busca `/{ad_account}/adsets` (campos `id,name,status,daily_budget,campaign_id`) + `/{ad_account}/insights` com `level: "adset"` (campos `adset_id,spend,actions,impressions,inline_link_clicks,ctr,cpm`). Retorna `MetaAdSet[]` estendido com as métricas e `campaign_id` (pra filtrar por campanha selecionada).
- **`fetchAllAds(adAccountId, token, datePreset, customRange)`**: mesma lógica, `/{ad_account}/ads` (campos `id,name,status,adset_id,campaign_id`) + insights com `level: "ad"` (campos `ad_id,...`). Retorna `MetaAd[]` estendido com as métricas e `campaign_id`/`adset_id`.

Isso troca N chamadas (uma por campanha/conjunto) por 1 chamada por nível — mais rápido pra popular a visão consolidada.

`updateMetaObject` (já existe, usada hoje pra pausar/editar orçamento de conjunto) é reaproveitada sem mudança pra editar campanha também — a Graph API aceita os mesmos campos (`status`, `daily_budget`) em qualquer nível.

## Componente novo: `CampaignsExplorer`

Substitui a tabela de campanhas atual dentro de `clients.$id.tsx` (a seção que hoje renderiza `CampaignsTotals` + lista de `CampaignRow`). Estrutura:

- **Abas** (Campanhas / Conjuntos / Anúncios) controlando um estado `level`. Trocar de aba dispara a query correspondente (`fetchCampaigns` já existente, ou as duas novas), reaproveitando `datePreset`/`customRange` que a página já gerencia hoje.
- **Seleção**: checkbox por linha, estado de IDs selecionados **por nível de campanha** (só a aba Campanhas tem seleção que afeta as outras — selecionar um conjunto ou anúncio não filtra nada, é só visual/futuro). Ao trocar pra aba Conjuntos/Anúncios com campanhas selecionadas, a query filtra client-side pelos `campaign_id` selecionados.
- **Toggle de status**: switch inline por linha (ativo/pausado), chama `updateMetaObject(id, { status: "ACTIVE" | "PAUSED" }, token)` e invalida a query do nível atual. Mesmo padrão de mutation que já existe pra conjunto no `CampaignSheet`, generalizado pros três níveis (exceto quando não aplicável).
- **Edição de orçamento inline**: clique no valor do orçamento abre um input (mesmo padrão já usado em `AdSetRow` no `CampaignSheet` — `editingBudget`/`budgetInput`/mutation), Enter ou blur salva via `updateMetaObject`. Disponível nas abas Campanhas e Conjuntos; não aparece na aba Anúncios.
- **Clique no nome**: abre o `CampaignSheet` já existente (campanha) — pra conjunto/anúncio, abre o `CampaignSheet` da campanha-pai. O estado de "expandido" de cada conjunto hoje é local (`useState` dentro de `AdSetRow`, sem jeito de vir controlado de fora); pra abrir já focado no conjunto/anúncio certo, `CampaignSheet` ganha uma prop nova opcional (`initialAdSetId`), repassada pra `AdSetsSection`/`AdSetRow` pra auto-expandir o conjunto correspondente ao abrir — pequena extensão, não é reaproveitamento direto do que já existe.

## Colunas customizáveis

Botão "Colunas" (popover) com checkboxes das métricas disponíveis pro nível atual:
- Campanha/Conjunto: Status, Orçamento, Gasto, Leads, CPL, Impressões, Cliques, CTR, CPM
- Anúncio: Status, Gasto, Leads, CPL, Impressões, Cliques, CTR, CPM (sem Orçamento)

Reordenar via botões ↑/↓ na lista do popover (mais simples e acessível que drag-and-drop). Nome da coluna sempre fixo na primeira posição (não entra no picker).

Preferência salva em `localStorage`, uma chave por nível (`campaigns-explorer-columns-campaign`, `-adset`, `-ad`), formato `{ visible: string[], order: string[] }`. Sem preferência salva, usa o conjunto de colunas atual como padrão.

## Fora de escopo

- Qualquer métrica que a Meta expõe mas o app não busca hoje (frequência, alcance, resultados por tipo de conversão detalhado, configuração de atribuição, estratégia de lance).
- Teste A/B, Agrupamento, Detalhamento, recomendações automáticas.
- Drag-and-drop pra reordenar colunas (fica com botões ↑/↓ por simplicidade).
- Edição em massa (selecionar várias linhas e pausar/editar orçamento de todas de uma vez) — só toggle/edição individual por linha nesta fase.
- Criar campanha/conjunto/anúncio direto dessa tela (continua só pelo fluxo "Nova Campanha" já existente).

## Verificação

1. `npx tsc --noEmit` limpo (só o erro pré-existente não-relacionado em `clients.$id.tsx`).
2. `npm run build` local sem erros.
3. Teste visual: trocar entre as 3 abas, confirmar que os dados certos aparecem em cada uma.
4. Selecionar campanha(s), trocar pra Conjuntos/Anúncios, confirmar que filtra corretamente; limpar seleção, confirmar que volta a mostrar tudo.
5. Editar orçamento inline numa campanha e num conjunto, confirmar que salva na Meta (reconferir no painel lateral ou recarregando).
6. Alternar toggle de status, confirmar que pausa/ativa de verdade.
7. Abrir o picker de colunas, desmarcar/marcar/reordenar, recarregar a página e confirmar que a preferência persistiu.
8. Deploy e verificação em produção, mesmo fluxo já usado nas features anteriores.
