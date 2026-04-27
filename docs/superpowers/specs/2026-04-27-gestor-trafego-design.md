# Gestor de Tráfego — Design Spec
**Data:** 2026-04-27  
**Status:** Aprovado pelo usuário

---

## Visão Geral

Sistema web para gestão de campanhas Meta Ads de múltiplos clientes. Uso individual (solo), com possibilidade futura de múltiplos colaboradores. Até 40 clientes. Duas fases de entrega: dashboard de monitoramento (Fase 1) e agente de criação de campanhas (Fase 2).

---

## Contexto do Negócio

- Gestor de tráfego com ~15 clientes atualmente, máximo ~40
- Clientes focados em **mensagens via WhatsApp** — objetivo Meta: Engagement ou Sales (Messages)
- Principal métrica: **CPL (Custo por Lead)** — leads = conversas iniciadas no WhatsApp
- Faixas de CPL por perfil de cliente:
  - Lojas de veículos populares: R$6–R$12
  - Lojas de veículos premium: R$12–R$25
- Estrutura de campanha padrão: **1x1x1** (1 campanha → 1 conjunto → 1 anúncio)
- Posicionamento: Instagram + Facebook apenas, Advantage+ desativado
- Segmentação: aberta, sem interesses

---

## Arquitetura

**Stack:** Next.js full-stack (App Router) + PostgreSQL + Prisma  
**UI:** Tailwind CSS + shadcn/ui  
**Deploy inicial:** Lovable (scaffold visual) → GitHub → melhorias via Claude Code  
**Integração:** Meta Marketing API (Graph API v19+)  
**Agente (Fase 2):** Claude API com tool use

### Por que monolito Next.js
Escala pequena (≤40 clientes), usuário solo, integração com Meta API e Claude API funcionam bem em API routes. Evita complexidade de dois serviços. Pode ser extraído futuramente se necessário.

---

## Fase 1 — Dashboard + Gestão de Clientes

### Autenticação

- OAuth com perfil pessoal do Facebook (acesso admin a todos os clientes)
- Token de longa duração (60 dias), renovado automaticamente
- Token armazenado criptografado no banco
- Um único login acessa todos os clientes

### Modelo de Dados

```
clients
  id, name, meta_ad_account_id, meta_page_id
  cpl_min (default 6), cpl_max (default 12)
  vehicle_segment: popular | premium
  active: boolean
  created_at

metrics_daily
  id, client_id, date
  spend, leads, cpl (calculado: spend/leads)
  updated_at

app_config
  id, key, value  -- ex: default_cpl_min, default_cpl_max

sync_log
  id, client_id, synced_at, status: success|error, message
```

### Sincronização de Métricas

- Job automático a cada hora via cron (ou Vercel Cron)
- Consulta Meta Insights API: gasto + mensagens iniciadas por conta de anúncio
- Salva/atualiza `metrics_daily` para o dia corrente
- Botão "Atualizar agora" no dashboard para sync manual imediato
- Em caso de erro, registra em `sync_log` e exibe aviso no card do cliente

### Dashboard Principal

**Layout:** Grid de cards responsivo (2 colunas mobile, 4 desktop)

**Card por cliente:**
- Nome do cliente
- CPL de hoje (ex: R$8,40)
- Gasto do dia (ex: R$252,00)
- Leads do dia (ex: 30)
- Indicador de status visual:
  - 🟢 Verde: CPL dentro da faixa configurada
  - 🟡 Amarelo: CPL até 30% acima do máximo
  - 🔴 Vermelho: CPL >30% acima do máximo, ou gasto ocorrendo com 0 leads
  - ⚪ Cinza: sem dados do dia (sem gasto)

**Filtros:** Todos / Verdes / Atenção / Críticos  
**Header:** data atual, botão "Atualizar", total de clientes por status

### Tela de Cliente (detalhe)

- Histórico de CPL dos últimos 30 dias (gráfico de linha)
- Configuração da faixa de CPL (cpl_min, cpl_max)
- Lista de campanhas ativas (nome, status, gasto, leads, CPL)
- Botão de acesso rápido ao Gerenciador de Anúncios do Meta

### Gestão de Clientes (CRUD)

- Listar, adicionar, editar, desativar clientes
- Ao cadastrar: nome, ID da conta de anúncio do Meta, segmento (popular/premium)
- Segmento pré-preenche a faixa de CPL com os defaults globais, editável depois
- Desativar cliente remove do dashboard mas preserva histórico

---

## Fase 2 — Agente de Campanhas

### Fluxo de Criação

**Para clientes com campanha existente (90% dos casos):**
1. Usuário abre formulário "Nova Campanha"
2. Seleciona o cliente
3. Sistema lista campanhas ativas do cliente para duplicar
4. Usuário seleciona a campanha-base
5. Preenche campos do novo anúncio:
   - Nome da campanha (ex: "Honda Civic 2024 - Azul")
   - Orçamento diário (R$)
   - Texto principal
   - Título
   - Descrição
   - Criativo (upload de imagem/vídeo)
   - Mensagem padrão WhatsApp
6. Seção "Opções avançadas" (recolhida por padrão): posicionamento, objetivo, segmentação
7. Resumo para revisão
8. Confirmar → agente executa via Meta API

**Para clientes novos (sem campanha):**
- Mesmo formulário, mas sem seleção de campanha-base
- Campos adicionais visíveis: objetivo (Engagement/Sales), posicionamento
- Cria estrutura 1x1x1 do zero com os padrões definidos

### Padrões Fixos (aplicados automaticamente)
- Posicionamento: Instagram + Facebook
- Advantage+: desativado
- Segmentação: aberta (sem interesses)
- Estrutura: 1 campanha → 1 conjunto → 1 anúncio

### Execução via Meta API
- Agente usa Claude API (tool use) para orquestrar as chamadas
- Sequência: duplicar campanha → atualizar nome → atualizar anúncio (criativo + textos) → definir orçamento → ativar
- Em caso de erro em qualquer etapa: rollback e exibição clara do erro

---

## Fora de Escopo (por ora)

- Relatórios em PDF para clientes
- Multi-usuário / controle de permissões
- Notificações por email ou WhatsApp
- Integração com outras plataformas (Google Ads, TikTok)
- Faturamento / controle financeiro da agência

---

## Ordem de Implementação

1. Scaffold visual no Lovable (layout, componentes UI, navegação)
2. Autenticação Meta OAuth
3. CRUD de clientes
4. Integração Meta Insights API + sync de métricas
5. Dashboard com status por cliente
6. Tela de detalhe do cliente
7. Formulário de criação de campanha
8. Integração Meta API para execução (agente)
