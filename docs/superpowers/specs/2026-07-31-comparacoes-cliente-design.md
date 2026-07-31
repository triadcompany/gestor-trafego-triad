# Comparações na página do cliente — período e campanhas

**Data:** 2026-07-31
**Status:** Aprovado pelo usuário

---

## Contexto

Na página do cliente (`src/routes/clients.$id.tsx`), hoje só dá pra ver um período por vez (Hoje/Ontem/Esta semana/Semana passada/Este mês/Máximo/Personalizado) — sem jeito de comparar a evolução entre dois períodos, nem de comparar campanhas entre si além de olhar linha por linha na tabela.

O usuário quer duas coisas, validadas via mockups no companion visual:
1. **Comparação de período** — ex: esta semana vs semana passada, semana passada vs a anterior, este mês vs mês passado, mês passado vs o anterior — com controle total pra escolher qualquer par de períodos, não só atalhos fixos.
2. **Comparação de campanhas** — poder ver rapidamente qual campanha está performando melhor, seja olhando todas ordenadas por uma métrica, seja focando num grupo específico selecionado.

Decisão de implementação: direto em `clients.$id.tsx` (não numa página duplicada — descartado depois de ver o mockup funcionando).

## Comparação de período

### Direção visual aprovada
Duas linhas sobrepostas no mesmo gráfico (a atual, laranja sólida; a de comparação, cinza tracejada), alinhadas por "dia 1, dia 2..." em vez de data de calendário — os dois períodos têm datas diferentes mas o mesmo número de dias. Acima do gráfico, cards mostrando a variação percentual de cada métrica (CPL, Gasto, Leads) entre os dois períodos, com seta e cor indicando se a mudança é favorável (verde) ou desfavorável (vermelho) — CPL menor é bom, Leads maior é bom; Gasto fica neutro (sem cor), já que gasto maior não é bom nem ruim por si só.

### Seleção dos períodos
Um botão "Comparar período" (perto do seletor de período já existente) liga o modo comparação. Quando ligado:
- O seletor de período atual passa a ser rotulado "Período A" (nenhuma mudança de comportamento nele).
- Aparece um segundo seletor idêntico, "Período B" — mesmos presets (Hoje/Ontem/Esta semana/Semana passada/Este mês/Máximo/Personalizado). O usuário escolhe livremente qualquer combinação.
- Isso cobre todos os pares pedidos sem precisar inventar presets novos: "semana passada vs a anterior" vira Período A = "Semana passada", Período B = "Personalizado" com as datas da semana anterior a essa.

### Dados
`fetchDailyInsights` (já existe em `meta.ts`) é chamado duas vezes — uma por período, cada um com seu próprio `datePreset`/`customRange`. Os totais de cada período (soma de spend/leads, CPL resultante) alimentam os cards de variação; as séries diárias alimentam as duas linhas do gráfico, alinhadas por índice do dia (não por data).

## Comparar campanhas

### Ordenação por coluna
As tabelas do Explorador de Campanhas (abas Campanhas/Conjuntos/Anúncios, em `CampaignsExplorer.tsx`) ganham cabeçalhos clicáveis — clicar ordena pela coluna (asc/desc, alternando a cada clique), com um indicador visual (seta) mostrando a direção atual. Resolve "ver qual está melhor" olhando qualquer métrica (CPL, Leads, Gasto, CTR, CPM) sem precisar de uma tela separada.

### Comparação focada
Escopo desta fase: só na aba **Campanhas** (hoje é a única com checkbox de seleção por linha — Conjuntos e Anúncios não têm, ficam de fora por enquanto). Quando 2 ou mais campanhas estão selecionadas, aparece um botão "Comparar selecionadas" perto do checkbox de "selecionar tudo". Clicar abre uma tabela compacta só com as campanhas selecionadas, mesmas colunas visíveis atualmente, com a **melhor** e a **pior** de cada métrica destacadas (verde/vermelho + selo "melhor" na melhor).

## Fora de escopo

- Exportar comparações (PDF/imagem/CSV).
- Comparação de período dentro do Explorador de Campanhas (fica só no gráfico geral da conta).
- Salvar/nomear comparações favoritas pra reabrir depois.
- Ordenação múltipla (por mais de uma coluna ao mesmo tempo).

## Verificação

1. `npx tsc --noEmit` limpo (só o erro pré-existente não-relacionado).
2. `npm run build` local sem erros.
3. Ligar "Comparar período", testar ao menos 3 combinações (este mês vs mês passado, semana passada vs personalizado cobrindo a anterior, hoje vs ontem) e conferir que os cards de variação e as duas linhas do gráfico batem com os números reais.
4. Clicar nos cabeçalhos da tabela de campanhas, conferir que ordena corretamente asc/desc em pelo menos 3 colunas diferentes (texto, número, moeda).
5. Selecionar 2-3 campanhas, abrir "Comparar selecionadas", conferir que a melhor/pior de cada métrica está destacada corretamente.
6. Deploy e verificação em produção, mesmo fluxo já usado nas features anteriores.
