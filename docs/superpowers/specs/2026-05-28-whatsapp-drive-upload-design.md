# WhatsApp → Google Drive Upload — Design Spec
**Data:** 2026-05-28
**Status:** Aprovado pelo usuário

---

## Visão Geral

Fluxo conversacional no WhatsApp (via Evolution API + n8n) para organizar vídeos no Google Drive. O usuário inicia com a palavra-chave "Drive", seleciona a pasta do cliente, envia o vídeo com o nome do carro na legenda, confirma, e recebe o link da pasta criada.

---

## Contexto

- Pasta raiz no Drive: **"Gestor Thiago Lisboa"**
- Estrutura: `Gestor Thiago Lisboa / [cliente] / [carro] / video.mp4`
- Pastas de clientes já existem; pastas de carro são criadas pelo fluxo
- Número WhatsApp do bot: **+55 47 98862-0003** (Evolution API)
- Remetente autorizado: apenas o próprio usuário

---

## Fluxo Conversacional

```
Você: "Drive"
Bot:  "📁 Selecione a pasta do cliente:
       1. Alliance
       2. Gauchinho
       3. Roma Motors"

Você: "2"
Bot:  "✅ Gauchinho selecionado. Agora envie o vídeo com o nome do carro na legenda."

Você: [vídeo com legenda "t-cross"]
Bot:  "📋 Confirma?
       Cliente: Gauchinho
       Carro: t-cross
       Responda sim para confirmar."

Você: "sim"
Bot:  "✅ Vídeo salvo em Gauchinho / t-cross!
       📂 https://drive.google.com/drive/folders/..."
```

---

## Arquitetura

4 workflows n8n + tabela Supabase como máquina de estados.

```
"Drive"  →  [WF1] lista pastas          →  status: aguardando_pasta
número   →  [WF2] salva pasta selecionada →  status: aguardando_video
vídeo    →  [WF3] salva mídia + carro   →  status: aguardando_confirmacao
"sim"    →  [WF4] cria pasta + upload   →  status: concluido
```

---

## Tabela Supabase — `drive_uploads`

```sql
CREATE TABLE drive_uploads (
  id                 uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  status             text        DEFAULT 'aguardando_pasta',
  folders            jsonb,      -- [{ "index": 1, "name": "Gauchinho", "id": "..." }]
  pasta_cliente_id   text,       -- preenchido no WF2
  pasta_cliente_nome text,       -- preenchido no WF2
  car_name           text,       -- preenchido no WF3
  media_url          text,       -- URL da mídia na Evolution API, preenchido no WF3
  folder_id          text,       -- ID da pasta final no Drive, preenchido no WF4
  created_at         timestamptz DEFAULT now()
);
```

---

## Workflow 1 — Palavra-chave "Drive"

**Trigger:** Webhook Evolution API — evento `messages.upsert`

| # | Nó | Descrição |
|---|---|---|
| 1 | Webhook | Recebe todos os eventos |
| 2 | Filtrar | Remetente autorizado + tipo `conversation` + texto = "drive" (case-insensitive) |
| 3 | Listar Pastas | Google Drive — lista subpastas de "Gestor Thiago Lisboa" |
| 4 | Montar Lista | Code — monta array `[{ index, name, id }]` + texto numerado |
| 5 | Salvar Supabase | INSERT com `folders`, `status: aguardando_pasta` |
| 6 | Enviar Lista WA | Evolution API — manda lista numerada |

---

## Workflow 2 — Seleção da Pasta (número)

**Trigger:** Webhook Evolution API

| # | Nó | Descrição |
|---|---|---|
| 1 | Webhook | Recebe todos os eventos |
| 2 | Filtrar | Remetente autorizado + texto é número inteiro |
| 3 | Buscar Supabase | SELECT mais recente com `status = aguardando_pasta` |
| 4 | Checar Registro | IF — tem registro? Se não, descarta |
| 5 | Validar e Selecionar | Code — valida range, extrai pasta selecionada |
| 6 | Atualizar Supabase | UPDATE `pasta_cliente_id`, `pasta_cliente_nome`, `status: aguardando_video` |
| 7 | Enviar Confirmação WA | "✅ Gauchinho selecionado. Agora envie o vídeo com o nome do carro na legenda." |

---

## Workflow 3 — Receber Vídeo

**Trigger:** Webhook Evolution API

| # | Nó | Descrição |
|---|---|---|
| 1 | Webhook | Recebe todos os eventos |
| 2 | Filtrar | Remetente autorizado + `messageType = videoMessage` + caption não vazio |
| 3 | Buscar Supabase | SELECT mais recente com `status = aguardando_video` |
| 4 | Checar Registro | IF — tem registro? Se não, descarta |
| 5 | Extrair Campos | Code — extrai `car_name` da legenda e `media_url` do payload |
| 6 | Atualizar Supabase | UPDATE `car_name`, `media_url`, `status: aguardando_confirmacao` |
| 7 | Enviar Confirmação WA | Manda resumo (cliente + carro) e pede "sim" para confirmar |

---

## Workflow 4 — Confirmação e Upload

**Trigger:** Webhook Evolution API

| # | Nó | Descrição |
|---|---|---|
| 1 | Webhook | Recebe todos os eventos |
| 2 | Filtrar | Remetente autorizado + texto = "sim" (case-insensitive) |
| 3 | Buscar Supabase | SELECT mais recente com `status = aguardando_confirmacao` |
| 4 | Checar Registro | IF — tem registro? Se não, descarta |
| 5 | Criar Subpasta | Google Drive — cria pasta `car_name` dentro de `pasta_cliente_id` |
| 6 | Baixar Mídia | HTTP Request — GET na `media_url` com apikey da Evolution |
| 7 | Upload Drive | Google Drive — upload do vídeo na subpasta criada |
| 8 | Atualizar Supabase | UPDATE `folder_id`, `status: concluido` |
| 9 | Enviar Link WA | Manda link da pasta + mensagem de sucesso |

---

## Casos de Erro

| Situação | Comportamento |
|----------|--------------|
| "Drive" mas já tem `aguardando_*` ativo | WF1 cria novo registro (o mais recente sempre vence) |
| Número fora do range | WF2 responde com erro e mantém estado |
| Vídeo sem legenda | WF3 descarta silenciosamente |
| "sim" sem registro pendente | WF4 descarta silenciosamente |
| URL da mídia expirou | WF4 falha no download; status permanece `aguardando_confirmacao` |

---

## Pré-requisitos

1. **ID da pasta "Gestor Thiago Lisboa"** — copiar da URL do Drive
2. Credencial **Google Drive** configurada no n8n
3. **Evolution API** com webhook configurado apontando para os 4 endpoints
4. Tabela `drive_uploads` criada no Supabase
5. Credencial **Supabase** no n8n

---

## Fora de Escopo

- Cancelar um upload em andamento (ex: palavra "cancelar")
- Múltiplos uploads simultâneos
- Upload de imagens ou outros formatos
