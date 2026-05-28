# WhatsApp → Google Drive Upload — Design Spec
**Data:** 2026-05-28
**Status:** Aprovado pelo usuário

---

## Visão Geral

Fluxo n8n que permite enviar um vídeo para um número WhatsApp (Evolution API) com uma mensagem no formato `cliente - carro`, e automaticamente organiza o arquivo no Google Drive na estrutura correta, com uma etapa de confirmação interativa para evitar erros de digitação no nome da pasta do cliente.

---

## Contexto

- Pasta raiz no Drive: **"Gestor Thiago Lisboa"**
- Estrutura: `Gestor Thiago Lisboa / [cliente] / [carro] / video.mp4`
- As pastas de clientes já existem; pastas de carro são criadas pelo fluxo
- Número WhatsApp do bot: **+55 47 98862-0003** (Evolution API)
- Remetente autorizado: apenas o próprio usuário (mesmo número)

---

## Arquitetura

Dois workflows n8n independentes + tabela Supabase como estado compartilhado.

```
[Você] → envia vídeo + "gauchinho - t-cross" → [Evolution API]
           ↓ webhook
    [Workflow 1 — Receber Vídeo]
      → baixa vídeo → upload para _temp no Drive
      → lista pastas do cliente → salva no Supabase
      → envia lista numerada no WhatsApp
           ↓
[Você] → responde "2" → [Evolution API]
           ↓ webhook
    [Workflow 2 — Confirmar e Mover]
      → lê registro do Supabase → seleciona pasta
      → cria subpasta do carro → move arquivo
      → atualiza Supabase → envia link no WhatsApp
```

---

## Tabela Supabase — `drive_uploads`

```sql
CREATE TABLE drive_uploads (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  file_id    text        NOT NULL,   -- ID do arquivo no Drive (pasta _temp)
  car_name   text        NOT NULL,   -- nome da subpasta a criar
  folders    jsonb       NOT NULL,   -- [{ "index": 1, "name": "gauchinho", "id": "abc" }]
  status     text        DEFAULT 'aguardando',  -- aguardando | concluido | erro
  folder_id  text,                   -- ID da pasta final (preenchido após mover)
  created_at timestamptz DEFAULT now()
);
```

---

## Workflow 1 — Receber Vídeo

**Trigger:** Webhook POST da Evolution API (evento `messages.upsert`)

### Nós

| # | Nome | Tipo | Descrição |
|---|------|------|-----------|
| 1 | Webhook — Evolution | Webhook | Recebe todos os eventos de mensagem |
| 2 | Filtrar Mensagem | IF | Passa apenas se: `messageType = videoMessage`, remetente = número autorizado, texto (`caption`) corresponde ao padrão `X - Y` |
| 3 | Extrair Campos | Code | Extrai `clientName` e `carName` do caption via regex `^(.+)\s*-\s*(.+)$` |
| 4 | Baixar Mídia | HTTP Request | GET na URL da mídia da Evolution API com header `apikey` |
| 5 | Upload para _temp | Google Drive | Faz upload do vídeo binário para a pasta `_temp` dentro de "Gestor Thiago Lisboa" |
| 6 | Listar Pastas do Cliente | Google Drive | Lista subpastas de "Gestor Thiago Lisboa", filtra excluindo `_temp` |
| 7 | Montar Lista | Code | Monta array `[{ index, name, id }]` e texto numerado para WhatsApp |
| 8 | Salvar no Supabase | Supabase | INSERT em `drive_uploads` com `file_id`, `car_name`, `folders`, `status: aguardando` |
| 9 | Enviar Lista WhatsApp | HTTP Request (Evolution API) | Envia mensagem com lista numerada + instrução |

### Mensagem enviada (exemplo)
```
📁 Recebi o vídeo! Qual é a pasta do cliente?

1. Alliance
2. Gauchinho
3. Roma Motors

Responda com o número da pasta.
(Carro: t-cross)
```

---

## Workflow 2 — Confirmar e Mover

**Trigger:** Webhook POST da Evolution API (mesmo endpoint ou endpoint separado)

### Nós

| # | Nome | Tipo | Descrição |
|---|------|------|-----------|
| 1 | Webhook — Evolution | Webhook | Recebe todos os eventos de mensagem |
| 2 | Filtrar Resposta | IF | Passa apenas se: remetente = número autorizado, texto é número inteiro |
| 3 | Buscar Registro | Supabase | SELECT mais recente com `status = aguardando` |
| 4 | Validar Número | IF | Checa se número digitado está dentro do range da lista (1 a N); se inválido, responde com erro e encerra |
| 5 | Selecionar Pasta | Code | Usa o índice digitado para extrair `{ name, id }` da pasta do cliente do JSON salvo |
| 6 | Criar Subpasta | Google Drive | Cria pasta `car_name` dentro da pasta selecionada; se já existe, usa a existente |
| 7 | Mover Arquivo | Google Drive | Move arquivo de `_temp` para a nova subpasta |
| 8 | Atualizar Supabase | Supabase | UPDATE `status: concluido`, `folder_id` |
| 9 | Enviar Link WhatsApp | HTTP Request (Evolution API) | Envia `✅ Vídeo salvo!\n📂 drive.google.com/drive/folders/{folder_id}` |

### Mensagem de erro (número inválido)
```
❌ Número inválido. Responda com um número entre 1 e N.
```

---

## Fluxo de Dados

```
Evolution API webhook body
  └── message.key.remoteJid         → remetente
  └── message.messageType           → "videoMessage"
  └── message.message.videoMessage.caption → "gauchinho - t-cross"
  └── message.message.videoMessage.url     → URL da mídia (com auth)
```

---

## Configuração Necessária (pré-requisitos)

1. **Pasta `_temp`** criada manualmente dentro de "Gestor Thiago Lisboa" no Drive
2. **Credencial Google Drive** já configurada no n8n
3. **Evolution API** configurada para disparar webhook no n8n ao receber mensagens
4. **Tabela `drive_uploads`** criada no Supabase (SQL acima)
5. **Credencial Supabase** no n8n (já usada em outros workflows)

---

## Casos de Erro

| Situação | Comportamento |
|----------|--------------|
| Mensagem sem vídeo | Filtro descarta silenciosamente |
| Caption fora do formato `X - Y` | Filtro descarta silenciosamente |
| Número digitado fora do range | Workflow 2 responde com mensagem de erro |
| Nenhum registro `aguardando` no Supabase | Workflow 2 descarta silenciosamente |
| Falha no upload do Drive | Não salva no Supabase, não envia lista (fluxo para) |

---

## Fora de Escopo

- Suporte a múltiplos uploads simultâneos pendentes (o SELECT pega sempre o mais recente)
- Cancelamento de um upload pendente
- Upload de imagens ou outros tipos de mídia
