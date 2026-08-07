# Alerta de saldo baixo via WhatsApp — Design Spec

**Data:** 2026-08-05
**Status:** Aprovado pelo usuário

---

## Contexto

O usuário quer que, quando o saldo de um cliente estiver baixo, o sistema avise automaticamente via WhatsApp o grupo **"Operacional Triad Company"** — sem precisar de ninguém abrir o app pra notar.

O critério de "saldo baixo" já existe e já é usado na página Visão Geral (`fetchAttentionItems` em `src/lib/queries.ts`): saldo cobre menos de 1 dia de veiculação, calculado a partir do gasto de ontem (`estimatedDays = meta_balance / (spendToday * 100) < 1`). Este alerta reaproveita exatamente esse critério, sem inventar um novo.

A infraestrutura de envio (Evolution API, grupo fixo) já existe da feature de lista de campanhas ativas — mesmo padrão de chamada.

---

## Escopo

- Novo workflow n8n com **Schedule Trigger diário às 08:00**.
- Consulta clientes ativos com `meta_balance` definido e gasto de ontem (`metrics_daily` da data de ontem), calcula dias restantes.
- Se 1 ou mais clientes estiverem abaixo do limite (< 1 dia), envia **uma única mensagem digest** pro grupo fixo, listando todos. Se nenhum cliente estiver baixo, não envia nada.
- Sem necessidade de controle de "já alertei esse cliente" — a cadência diária (1x/dia) já evita repetição no mesmo dia, e o próprio critério recalcula do zero a cada execução.

## Fora de escopo

- Alertar mais de uma vez por dia, mesmo que o saldo mude durante o dia.
- Alertar clientes sem PIX/saldo Meta configurado (mesma exclusão já aplicada em `fetchAttentionItems`: `meta_balance IS NOT NULL`).
- Ação de resposta automática (ex: pausar campanhas) — é só aviso.
- Configurar o horário/limite pela interface do app — fica fixo no workflow por enquanto.

---

## Implementação

### Workflow n8n

Novo workflow: **Schedule Trigger (08:00 diário)** → **Postgres "Buscar Saldos"** → **Code "Filtrar Saldo Baixo"** → **IF "Tem Clientes?"** → **Code "Montar Mensagem"** → **HTTP "Enviar Mensagem"** (Evolution API, mesmo padrão dos workflows existentes).

Query Postgres:
```sql
SELECT c.name, c.meta_balance, COALESCE(m.spend, 0) AS spend_yesterday
FROM clients c
LEFT JOIN metrics_daily m ON m.client_id = c.id AND m.date = (CURRENT_DATE - INTERVAL '1 day')
WHERE c.active = true AND c.meta_balance IS NOT NULL;
```

Code "Filtrar Saldo Baixo": para cada linha, calcula `estimatedDays = meta_balance / (spend_yesterday * 100)`; mantém só onde `spend_yesterday > 0 AND estimatedDays < 1`.

IF: só segue se houver pelo menos 1 item filtrado (evita rodar os próximos nodes à toa todo dia).

Code "Montar Mensagem": monta o texto:
```
⚠️ {N} cliente(s) com saldo baixo

• {nome} — {saldo em R$} (~{dias} dias)
• ...
```

HTTP "Enviar Mensagem": `POST {evolution_api_url}/message/sendText/{evolution_instance}`, header `apikey`, body `{ number: whatsapp_group_operacional_id, text }` — mesma instância e grupo já configurados em `app_config` (reaproveitados, sem nova config).

### App

Nenhuma mudança de código no app — é só o workflow n8n, criado e ativado via API do n8n (mesmo processo já usado nos workflows anteriores).

---

## Casos de erro

| Situação | Comportamento |
|---|---|
| Nenhum cliente com saldo baixo no dia | Workflow para no IF, não envia nada |
| Evolution API fora do ar | Execução falha nesse dia; sem retry automático — próxima checagem é só no dia seguinte |
| `metrics_daily` sem registro de ontem pra um cliente | `spend_yesterday` vira 0 via `COALESCE`, cliente é ignorado (mesma regra do `fetchAttentionItems`, que também pula quando `spendToday <= 0`) |

---

## Verificação

1. Criar e ativar o workflow via API do n8n.
2. Testar manualmente: forçar um cliente de teste a ter saldo baixo (ou ajustar temporariamente o filtro pra pegar qualquer cliente) e confirmar que a mensagem chega certinha no grupo.
3. Confirmar que com filtro normal e nenhum cliente baixo, nenhuma mensagem é enviada.
4. Deixar rodando e confirmar às 08:00 do dia seguinte que dispara (ou não) conforme o saldo real dos clientes.
