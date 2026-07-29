# Refresh de Design — Paleta, Tipografia e Modo Dark/Light

**Data:** 2026-07-29
**Status:** Aprovado pelo usuário

---

## Contexto

O Gestor de Tráfego usa hoje um único tema fixo, definido direto em `:root` em `src/styles.css` (comentário no próprio arquivo: "Dark by default — professional internal tool"). Existe um bloco `.dark` no mesmo arquivo, mas é sobra do template original (shadcn/Lovable) — nunca é aplicado, porque nada no app adiciona a classe `.dark` em lugar nenhum. Não há fonte customizada (usa a fonte padrão do navegador) e a variante `font-mono` do Tailwind (usada bastante pra números — CPL, saldo, datas) também cai na monoespaçada padrão do sistema, não numa fonte escolhida.

O usuário quer um visual mais moderno, com paleta e tipografia novas, e um modo dark/light de verdade com alternância manual.

Durante a investigação, foi confirmado que **~230 ocorrências em 20 arquivos** (praticamente todas as rotas do app — Dashboard, Clientes, PIX, Tarefas, Vendas, Agenda, Diagnóstico, Visão Geral, Saldos, etc. — mais `AppShell`, `TagBadge`, `CampaignSheet`, `ReportTable`, `AdCreativeEditor`, `TokenExpiryBanner` e `client-colors.ts`) usam cores do Tailwind hardcoded (`text-red-500`, `bg-yellow-500/10`, etc.) direto no componente, em vez de um token central. Isso significa que só trocar as variáveis CSS não é suficiente — essas ocorrências precisam ser migradas individualmente pra ficarem corretas nos dois temas. O usuário optou por fazer essa migração completa numa única passada, cobrindo as ~20 telas.

## Decisões já validadas com o usuário

- **Direção visual**: "Nórdico Calmo" — paleta azul suave e neutra, fonte DM Sans (validado via mockups no companion visual).
- **Comportamento do tema**: segue a preferência do sistema operacional por padrão; usuário pode alternar manualmente e a escolha fica salva (localStorage), sobrepondo a preferência do sistema dali em diante.
- **Escopo**: migração completa de uma vez, cobrindo todos os arquivos com cor hardcoded identificados.
- **Abordagem técnica do toggle**: `ThemeProvider` próprio (React context + localStorage + `matchMedia('(prefers-color-scheme: dark)')`), sem biblioteca nova. Rejeitado `next-themes` (pensada pra Next.js, dependência desnecessária pra ~40 linhas de lógica) e rejeitado CSS-only via `prefers-color-scheme` (não permite alternância manual, requisito explícito do usuário).

## Paleta de cores

Valores de referência (a converter para oklch na implementação, mantendo a convenção já usada em `styles.css`, que exige todas as cores nesse formato):

| Token | Light | Dark |
|---|---|---|
| `background` | `#eef1f6` | `#1b2536` |
| `foreground` | `#28344a` | `#e7edf7` |
| `card` | `#ffffff` | `#222e42` |
| `card-foreground` | `#28344a` | `#e7edf7` |
| `primary` (acento) | `#3b82c4` | `#7ab3ea` |
| `muted-foreground` | `#7c8aa5` | `#7f8ba3` |
| `border` | `#e2e8f0` | `#263346` |
| `sidebar` | `#ffffff` | `#141d2c` |
| `sidebar-accent` (item ativo) | `#e1ebfa` | `#1f2c40` |
| `status-critical` | `#dc4c4c` | `#f08080` |
| `status-attention` | `#c48a1f` | `#e0b25a` |
| `status-on-target` | `#2f9e6e` (verde suave, mesma família de saturação contida da paleta) | `#6cc9a0` |
| `status-no-data` | igual a `muted-foreground` | igual a `muted-foreground` |

Os tokens `--color-status-*` já existem em `@theme inline` no `styles.css` atual, mas hoje só têm um valor (do tema único); passam a ter par light/dark como todos os outros.

## Tipografia

- **DM Sans** — texto geral, títulos, menu (substitui a fonte padrão do sistema).
- **DM Mono** — números e valores tabulares (CPL, saldo, datas), assumindo o papel que hoje é do `font-mono` genérico do navegador.
- Ambas hospedadas localmente via pacotes `@fontsource/dm-sans` e `@fontsource/dm-mono` (bundladas pelo Vite), sem depender do Google Fonts em produção.
- Registradas em `@theme inline` como `--font-sans` e `--font-mono`, mapeando pras classes utilitárias `font-sans`/`font-mono` que o Tailwind já gera — não exige trocar `className` em lugar nenhum além da fonte em si.

## Mecanismo de tema (dark/light)

- `ThemeProvider` novo (`src/components/ThemeProvider.tsx`): contexto React expondo `theme` (`"light" | "dark"`) e `toggleTheme()`.
- Na primeira visita sem preferência salva: usa `window.matchMedia('(prefers-color-scheme: dark)')` pra decidir o tema inicial, e continua reagindo a mudanças do sistema (listener no `matchMedia`) enquanto o usuário não alternar manualmente.
- Ao clicar no toggle, o valor escolhido é salvo em `localStorage` (chave `theme`) e passa a ter prioridade sobre a preferência do sistema a partir dali.
- A classe `.dark` é aplicada em `<html>` (já existe `@custom-variant dark (&:is(.dark *))` configurado em `styles.css`, hoje sem uso — passa a ser o mecanismo real).
- Prevenção de flash (FOUC): script inline síncrono no `<head>` do `RootShell` (`__root.tsx`), executado antes da hidratação, que lê `localStorage`/`matchMedia` e aplica a classe `.dark` imediatamente — mesmo padrão usado por bibliotecas como `next-themes`, implementado na mão.
- **Toggle visual**: botão com ícone de sol/lua no rodapé do menu lateral (`AppShell.tsx`), ao lado do nome do usuário/botão de sair — tanto na versão desktop (`<aside>`) quanto na gaveta mobile.

## Migração das cores hardcoded

As ~230 ocorrências se dividem em duas categorias, tratadas de formas diferentes:

**1. Cores de severidade/status** (crítico, atenção, ok, sem dados) — usadas em `saldos.tsx` (`STATUS_COLORS`), `visao-geral.tsx` (`SEVERITY_COLORS`), status de cliente no Dashboard, aviso de expiração de token em `TokenExpiryBanner.tsx`, e badges similares em `CampaignSheet.tsx`/`ReportTable.tsx`. Essas migram para um helper central novo, `src/lib/status-colors.ts`, que expõe as classes Tailwind correspondentes aos tokens semânticos já existentes (`bg-status-critical`, `text-status-attention`, etc.) — motivo de esses tokens existirem no `styles.css` sem uso hoje. Cada arquivo passa a importar esse helper em vez de manter seu próprio mapa de cores local.

**2. Cores categóricas/decorativas** (sem relação com severidade — cor de tag escolhida pelo usuário em `TagBadge.tsx`, cor determinística por cliente em `client-colors.ts`, e ocorrências pontuais equivalentes em `AdCreativeEditor.tsx`) — continuam usando a paleta fixa do Tailwind (azul, verde, roxo etc. como identificadores visuais, não como semântica de status), mas cada uma ganha um par de classes light/dark explícito via a variante `dark:` (ex.: `bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400`), já que hoje os valores existentes foram calibrados só pro fundo escuro e ficariam com contraste ruim num fundo claro.

## Escopo — arquivos afetados

Todas as rotas (`src/routes/*.tsx`, 18 arquivos) + `src/components/AppShell.tsx`, `TagBadge.tsx`, `CampaignSheet.tsx`, `ReportTable.tsx`, `AdCreativeEditor.tsx`, `TokenExpiryBanner.tsx` + `src/lib/client-colors.ts`, além de `src/styles.css` (tokens), `src/routes/__root.tsx` (script anti-flash) e dois arquivos novos (`ThemeProvider.tsx`, `status-colors.ts`).

## Fora de escopo

- Alterar o `--radius` (arredondamento de cantos) — mantém o valor atual, que já é próximo do usado nos mockups aprovados.
- Estado "seguir sistema" reversível depois de escolher manualmente (uma vez que o usuário alterna, fica só light/dark — não volta a seguir o sistema automaticamente). Pode virar uma melhoria futura se for pedida.
- Qualquer mudança de layout/estrutura das telas — é só paleta, tipografia e tema.

## Verificação

1. `npx tsc --noEmit` limpo.
2. `npm run build` local sem erros.
3. Teste visual manual (Playwright ou navegador) em pelo menos 3 telas (Dashboard, Visão Geral, Saldos) nos dois temas, conferindo contraste e legibilidade das cores de status e das cores categóricas (tags).
4. Confirmar que o toggle persiste a escolha entre reloads e que a primeira visita respeita a preferência do sistema.
5. Deploy pro `main` (EasyPanel redeploya automaticamente) e verificação em produção, igual ao fluxo já usado nas features anteriores.
