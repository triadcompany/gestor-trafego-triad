# Resumidor de grupo (WhatsApp) — Design Spec

**Data:** 2026-08-20
**Status:** Aprovado pelo usuário

**Atualização (2026-08-31):** a classificação via OpenAI (gpt-4o) descrita abaixo foi
substituída por um Code node de regras de palavra-chave, pra eliminar o custo de API —
ver `## Atualização: classificação sem LLM` no final deste documento. O restante do
spec (fontes de mensagem, vínculo de grupo, formato da mensagem, horários) continua
valendo como está.

---

## Contexto

O usuário conversa com cada cliente (concessionária) por um grupo dedicado do WhatsApp, na mesma instância Evolution API (`drive`) já usada pros outros avisos automatizados (alerta de saldo baixo, lista de campanhas ativas). Ele quer um resumo automático, duas vezes por dia, do que os clientes disseram nesses grupos — pra não precisar ler grupo por grupo manualmente pra saber se teve venda, pedido de pausar veículo, ou assunto de CRM/marketing/tráfego pendente.

O resumo é enviado pro grupo **"Operacional Triad Company"** (mesmo grupo fixo já usado nos outros alertas), duas vezes ao dia:
- **12:00** — resume as mensagens da manhã (00:00–12:00)
- **17:30** — resume as mensagens da tarde (12:00–17:30)

Não existe hoje nenhum vínculo entre cliente e grupo do WhatsApp no sistema — isso precisa ser criado.

---

## Escopo

### 1. Vínculo cliente ↔ grupo do WhatsApp (app)

- Novos campos em `clients`: `whatsapp_group_id` (remoteJid do grupo, ex: `123456789@g.us`) e `whatsapp_group_name` (nome do grupo, só pra exibição — não usado pra lógica).
- No `ClientFormDialog`, um seletor de grupo reaproveitando o componente de busca de contatos/grupos já usado em "Mensagens Agendadas" (`searchEvolutionRecipients`, mas filtrado só pra grupos).
- Vínculo é manual — o usuário vai associando os clientes aos poucos, não precisa configurar todos de uma vez pro recurso funcionar.

### 2. Workflow n8n "Resumidor de Grupo"

- Dois **Schedule Triggers**, um pras 12:00 e outro pras 17:30 (horário local Brasília — aplicar o mesmo ajuste de fuso de +4h já identificado nesta sessão pros outros workflows agendados).
- **Postgres**: busca todos os clientes ativos, incluindo `whatsapp_group_id`/`whatsapp_group_name` (nulo quando não vinculado).
- **Code (loop por cliente com grupo vinculado)**: chama `POST {evolution_api_url}/chat/findMessages/{instance}` com `{ where: { key: { remoteJid: whatsapp_group_id } }, limit: 100 }`, filtra as mensagens com `key.fromMe === false` (só o que o cliente mandou, não nossas próprias mensagens) e com `messageTimestamp` dentro da janela do período (manhã ou tarde, conforme qual trigger disparou).
- **HTTP → OpenAI** (`gpt-4o`, mesmo modelo do Agente IA do sistema, key em `app_config.openai_api_key`): uma única chamada com as mensagens de todos os clientes (que tiveram pelo menos 1 mensagem no período) agrupadas por cliente, pedindo classificação em até 6 categorias + frase curta por categoria acionada. Ver prompt abaixo.
- **Code "Montar Mensagem"**: monta o texto final (formato abaixo).
- **HTTP "Enviar Mensagem"**: `POST {evolution_api_url}/message/sendText/{instance}`, mesmo padrão dos workflows existentes, pro grupo Operacional Triad Company.
- **Retry on Fail**: habilitado nos nodes de busca de mensagens, chamada à OpenAI e envio da mensagem final — 2 tentativas extras, 10s de intervalo. Se mesmo assim falhar, a rodada é perdida e fica pro próximo horário agendado (sem retry manual/cross-run).

### Categorias de classificação

| Categoria | Emoji | Quando se aplica |
|---|---|---|
| Venda | 🟢 | Cliente informou que vendeu um veículo |
| Pausar veículo | ⏸️ | Cliente pediu pra pausar/remover anúncio de um veículo específico |
| Pedido/tarefa | 📌 | Pedido de ação geral que não se encaixa nas outras categorias |
| CRM | 🎯 | Assunto de CRM (leads parados, follow-up, etc.) |
| Marketing | 📄 | Assunto de marketing/criativos/conteúdo |
| Tráfego | 📈 | Assunto de tráfego pago (verba, campanha, performance) |

Uma mensagem do cliente pode acionar mais de uma categoria.

### Prompt (estrutura)

```
Você recebe mensagens de clientes de uma agência de tráfego para concessionárias de veículos.
Para cada cliente, classifique as mensagens do período em até 6 categorias e escreva uma frase
curta por categoria acionada:
- venda: cliente informou que vendeu um veículo
- pausar_veiculo: cliente pediu pra pausar/remover anúncio de um veículo específico
- pedido: pediu alguma tarefa/ação geral que não se encaixa nas outras
- crm: assunto relacionado a CRM (leads parados, follow-up, etc.)
- marketing: assunto de marketing/criativos/conteúdo
- trafego: assunto de tráfego pago (verba, campanha, performance)

Cliente: {nome}
Mensagens:
[{hora}] {texto}
...

Responda em JSON: { "clientes": [{ "nome": "...", "categorias": [{ "tipo": "venda", "resumo": "..." }, ...] }] }
```

Só entram no prompt os clientes que tiveram pelo menos 1 mensagem do cliente no período — economiza tokens e evita ruído.

### Formato da mensagem final

Todos os clientes ativos com grupo vinculado aparecem sempre, nessa ordem: primeiro os com algo classificado, depois os sem novidade. No fim, uma lista de aviso com os clientes ainda sem grupo vinculado.

```
🌞 *Resumo da manhã — 20/08*

*AB Veículos*
🟢 Venda: Onix 2022 fechado
⏸️ Pausar veículo: Corolla 2019 (vendido)

*Alliance Multimarcas*
📈 Tráfego: cliente pediu aumentar verba

*Auto Motors*
_Sem mensagens relevantes_

(+ demais clientes com grupo vinculado...)

⚠️ Sem grupo vinculado: Barak Seminovos, DVTEAM
```

Resumo da tarde usa o mesmo formato, trocando o emoji/título pra "🌆 *Resumo da tarde — 20/08*".

---

## Fora de escopo

- Analisar conversas individuais (DM) — só grupos.
- Responder ou agir automaticamente em cima do que foi identificado (ex: pausar o veículo sozinho) — é só um resumo informativo.
- Configurar horários/categorias pela interface do app — fica fixo no workflow, igual aos outros alertas.
- Vincular automaticamente cliente↔grupo por nome — vínculo é sempre manual.
- Deduplicar/evitar reclassificar a mesma mensagem entre rodadas — cada rodada olha só a janela de horário correspondente, sem sobreposição.

---

## Casos de erro

| Situação | Comportamento |
|---|---|
| Cliente sem `whatsapp_group_id` | Não entra no loop de busca; aparece na lista de aviso "Sem grupo vinculado" no fim da mensagem |
| Grupo sem mensagens do cliente no período | Não entra no prompt da OpenAI; aparece como "_Sem mensagens relevantes_" na mensagem final |
| Falha ao buscar mensagens de um grupo específico | Registra o erro, pula esse cliente, continua os demais (não trava o workflow) |
| Falha ao interpretar o JSON de resposta da OpenAI | Fallback: envia mensagem simplificada listando só os nomes dos clientes que tiveram mensagem no período, sem categorização, com uma nota de que a classificação falhou |
| Falha completa do workflow (Evolution API ou OpenAI fora do ar) | Retry automático (2x, 10s de intervalo) nos nodes críticos; se persistir, a rodada é perdida e o próximo envio é no horário agendado seguinte |

---

## Verificação

1. Aplicar migration (`whatsapp_group_id`, `whatsapp_group_name` em `clients`), rodar `npx tsc --noEmit` e `npm run build`.
2. Vincular pelo menos 2-3 clientes de teste a grupos reais (ou um grupo de teste) pela UI.
3. Criar e ativar o workflow via API do n8n.
4. Disparar manualmente (ajustando o trigger temporariamente, mesmo processo usado no teste do Alerta de Saldo) e conferir que a mensagem chega certinha no grupo Operacional, com categorização correta pra mensagens de teste conhecidas.
5. Confirmar que clientes sem grupo vinculado aparecem na lista de aviso.
6. Deixar rodando e conferir os dois horários (12:00 e 17:30) no dia seguinte.

---

## Atualização: classificação sem LLM (2026-08-31)

Motivo: eliminar o custo recorrente da API da OpenAI.

**O que mudou**: os nodes "Montar Prompt", "Tem Mensagens?", "Classificar" (HTTP → OpenAI)
e as duas variantes de "Montar Mensagem" foram substituídos por um único Code node
("Classificar e Montar Mensagem"), que roda direto depois de "Buscar Mensagens" —
sem chamada de API externa nenhuma.

**Como classifica**: por palavra-chave (case-insensitive, substring), na mensagem do
cliente:

| Categoria | Emoji | Palavras-chave |
|---|---|---|
| Venda | 🟢 | vendi, vendeu, fechou, fechei |
| Pausar veículo | ⏸️ | pausa, pausar, pausado, retirar, tirar do ar |
| CRM | 🎯 | crm, kommo, follow-up, followup, lead parado, leads parados |
| Marketing | 📄 | criativo, vídeo, video, foto, arte, marketing |
| Tráfego | 📈 | verba, orçamento, orcamento, budget, tráfego, trafego, performance, aumentar campanha, aumentar a verba |
| Pedido/tarefa | 📌 | fallback: mensagem sem categoria acima que contém "?" ou começa com "pode ", "preciso", "por favor" |

O resumo de cada categoria é o próprio trecho da mensagem que bateu com a regra
(truncado em 140 caracteres), não uma frase reescrita como fazia a IA.

**Trade-off aceito explicitamente pelo usuário**: perde entendimento de linguagem
natural — frases indiretas sem as palavras-chave exatas não são classificadas (ficam
em "sem mensagens relevantes" mesmo tendo conteúdo relevante). Testado com mensagens
reais do grupo do José Orlando Veículos: pegou "Fechou" → Venda e menções a "kommo" →
CRM corretamente, mas não pegou uma frase longa sobre mudança de conta de anúncio que
não continha nenhuma palavra-chave de tráfego cadastrada.

**Validado em produção** com dados reais de ~24 clientes já vinculados (execução via
webhook de teste temporário, removido depois), sem erros.
