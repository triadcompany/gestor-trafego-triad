# Plano de Implementação — WhatsApp → Google Drive Upload
**Spec:** [2026-05-28-whatsapp-drive-upload-design.md](../specs/2026-05-28-whatsapp-drive-upload-design.md)
**Data:** 2026-05-28

---

## Pré-requisitos (fazer antes de começar)

- [ ] Anotar o **ID da pasta "Gestor Thiago Lisboa"** no Drive (URL ao abrir a pasta)
- [ ] Confirmar URL base da Evolution API, `apikey` e nome da instância
- [ ] Confirmar formato exato do `remoteJid` do seu número no webhook (ex: `5547988620003@s.whatsapp.net`)
- [ ] Executar SQL no Supabase:

```sql
CREATE TABLE drive_uploads (
  id                 uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  status             text        DEFAULT 'aguardando_pasta',
  folders            jsonb,
  pasta_cliente_id   text,
  pasta_cliente_nome text,
  car_name           text,
  media_url          text,
  folder_id          text,
  created_at         timestamptz DEFAULT now()
);
```

---

## Workflow 1 — Palavra-chave "Drive"

**Nome no n8n:** `WA Drive — 1. Listar Pastas`

### 1.1 — Webhook
- Method: POST | Path: `wa-drive-1-listar`
- Response mode: `Immediately`

### 1.2 — Filtrar Mensagem (IF, todas AND)
- `{{ $json.data.key.remoteJid }}` equals `5547988620003@s.whatsapp.net`
- `{{ $json.data.messageType }}` equals `conversation`
- `{{ $json.data.message.conversation.toLowerCase() }}` equals `drive`

### 1.3 — Listar Pastas (Google Drive)
- Operation: Search Files
- Query: `'ID_PASTA_RAIZ' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
- Fields: `id, name`

### 1.4 — Montar Lista (Code)
```javascript
const files = $input.all();
const folders = files
  .map(item => ({ name: item.json.name, id: item.json.id }))
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((f, i) => ({ index: i + 1, name: f.name, id: f.id }));

const listText = folders.map(f => `${f.index}. ${f.name}`).join('\n');
const message = `📁 Selecione a pasta do cliente:\n\n${listText}`;

return [{ json: { folders, message } }];
```

### 1.5 — Salvar Supabase
- Operation: Insert | Table: `drive_uploads`
- `folders`: `={{ JSON.stringify($json.folders) }}`
- `status`: `aguardando_pasta`

### 1.6 — Enviar Lista WhatsApp (HTTP Request)
- Method: POST
- URL: `URL_EVOLUTION/message/sendText/INSTANCIA`
- Header: `apikey: APIKEY`
- Body:
```json
{
  "number": "5547988620003@s.whatsapp.net",
  "text": "={{ $('Montar Lista').item.json.message }}"
}
```

---

## Workflow 2 — Seleção da Pasta

**Nome no n8n:** `WA Drive — 2. Selecionar Pasta`

### 2.1 — Webhook
- Method: POST | Path: `wa-drive-2-selecionar`
- Response mode: `Immediately`

### 2.2 — Filtrar Resposta (IF, todas AND)
- `{{ $json.data.key.remoteJid }}` equals `5547988620003@s.whatsapp.net`
- `{{ $json.data.messageType }}` equals `conversation`
- `{{ $json.data.message.conversation }}` matches regex `^\d+$`

### 2.3 — Buscar Supabase
- Operation: Select | Table: `drive_uploads`
- Filter: `status` eq `aguardando_pasta`
- Order: `created_at` DESC | Limit: 1

### 2.4 — Checar Registro (IF)
- `{{ $json.id }}` is not empty
- Branch FALSE: encerrar

### 2.5 — Validar e Selecionar (Code)
```javascript
const escolha = parseInt($('Filtrar Resposta').item.json.data.message.conversation.trim());
const registro = $('Buscar Supabase').item.json;
const folders = registro.folders;

if (isNaN(escolha) || escolha < 1 || escolha > folders.length) {
  return [{ json: { valido: false, total: folders.length, registroId: registro.id } }];
}

const pasta = folders.find(f => f.index === escolha);
return [{ json: {
  valido: true,
  pastaClienteId: pasta.id,
  pastaClienteNome: pasta.name,
  registroId: registro.id
} }];
```

### 2.6 — Número Válido? (IF)
- `{{ $json.valido }}` equals `true`
- Branch FALSE → HTTP Request "Erro WA": `❌ Número inválido. Responda com um número entre 1 e {{ $json.total }}.`

### 2.7 — Atualizar Supabase
- Operation: Update | Table: `drive_uploads`
- Filter: `id` eq `={{ $json.registroId }}`
- `pasta_cliente_id`: `={{ $json.pastaClienteId }}`
- `pasta_cliente_nome`: `={{ $json.pastaClienteNome }}`
- `status`: `aguardando_video`

### 2.8 — Confirmar Seleção WhatsApp (HTTP Request)
```json
{
  "number": "5547988620003@s.whatsapp.net",
  "text": "✅ {{ $('Validar e Selecionar').item.json.pastaClienteNome }} selecionado.\n\nAgora envie o vídeo com o nome do carro na legenda."
}
```

---

## Workflow 3 — Receber Vídeo

**Nome no n8n:** `WA Drive — 3. Receber Vídeo`

### 3.1 — Webhook
- Method: POST | Path: `wa-drive-3-video`
- Response mode: `Immediately`

### 3.2 — Filtrar Vídeo (IF, todas AND)
- `{{ $json.data.key.remoteJid }}` equals `5547988620003@s.whatsapp.net`
- `{{ $json.data.messageType }}` equals `videoMessage`
- `{{ $json.data.message.videoMessage.caption }}` is not empty

### 3.3 — Buscar Supabase
- Operation: Select | Table: `drive_uploads`
- Filter: `status` eq `aguardando_video`
- Order: `created_at` DESC | Limit: 1

### 3.4 — Checar Registro (IF)
- `{{ $json.id }}` is not empty
- Branch FALSE: encerrar

### 3.5 — Extrair Campos (Code)
```javascript
const data = $('Filtrar Vídeo').item.json.data;
const carName = data.message.videoMessage.caption.trim();
const mediaUrl = data.message.videoMessage.url;
const registro = $('Buscar Supabase').item.json;

return [{ json: {
  carName,
  mediaUrl,
  registroId: registro.id,
  pastaClienteNome: registro.pasta_cliente_nome
} }];
```

### 3.6 — Atualizar Supabase
- Operation: Update | Table: `drive_uploads`
- Filter: `id` eq `={{ $json.registroId }}`
- `car_name`: `={{ $json.carName }}`
- `media_url`: `={{ $json.mediaUrl }}`
- `status`: `aguardando_confirmacao`

### 3.7 — Pedir Confirmação WhatsApp (HTTP Request)
```json
{
  "number": "5547988620003@s.whatsapp.net",
  "text": "📋 Confirma?\n\nCliente: {{ $('Extrair Campos').item.json.pastaClienteNome }}\nCarro: {{ $('Extrair Campos').item.json.carName }}\n\nResponda *sim* para confirmar."
}
```

---

## Workflow 4 — Confirmação e Upload

**Nome no n8n:** `WA Drive — 4. Upload Final`

### 4.1 — Webhook
- Method: POST | Path: `wa-drive-4-confirmar`
- Response mode: `Immediately`

### 4.2 — Filtrar "sim" (IF, todas AND)
- `{{ $json.data.key.remoteJid }}` equals `5547988620003@s.whatsapp.net`
- `{{ $json.data.messageType }}` equals `conversation`
- `{{ $json.data.message.conversation.toLowerCase().trim() }}` equals `sim`

### 4.3 — Buscar Supabase
- Operation: Select | Table: `drive_uploads`
- Filter: `status` eq `aguardando_confirmacao`
- Order: `created_at` DESC | Limit: 1

### 4.4 — Checar Registro (IF)
- `{{ $json.id }}` is not empty
- Branch FALSE: encerrar

### 4.5 — Criar Subpasta (Google Drive)
- Operation: Create Folder
- Folder name: `={{ $json.car_name }}`
- Parent folder ID: `={{ $json.pasta_cliente_id }}`

### 4.6 — Baixar Mídia (HTTP Request)
- Method: GET
- URL: `={{ $('Buscar Supabase').item.json.media_url }}`
- Header: `apikey: APIKEY`
- Response format: `File`

### 4.7 — Upload Drive (Google Drive)
- Operation: Upload
- Folder ID: `={{ $('Criar Subpasta').item.json.id }}`
- File name: `={{ $('Buscar Supabase').item.json.car_name }}_{{ $now.toFormat('yyyyMMdd_HHmmss') }}.mp4`
- Input binary field: `data`

### 4.8 — Atualizar Supabase
- Operation: Update | Table: `drive_uploads`
- Filter: `id` eq `={{ $('Buscar Supabase').item.json.id }}`
- `folder_id`: `={{ $('Criar Subpasta').item.json.id }}`
- `status`: `concluido`

### 4.9 — Enviar Link WhatsApp (HTTP Request)
```json
{
  "number": "5547988620003@s.whatsapp.net",
  "text": "✅ Vídeo salvo em {{ $('Buscar Supabase').item.json.pasta_cliente_nome }} / {{ $('Buscar Supabase').item.json.car_name }}!\n\n📂 https://drive.google.com/drive/folders/{{ $('Criar Subpasta').item.json.id }}"
}
```

---

## Configuração da Evolution API

Os 4 webhooks precisam ser registrados na Evolution API. Se ela só suporta 1 URL por instância, use uma única URL de webhook no n8n que bifurca internamente com IFs:

| Condição | Encaminha para |
|----------|---------------|
| texto = "drive" | WF1 lógica |
| texto = número inteiro + `aguardando_pasta` | WF2 lógica |
| tem vídeo + `aguardando_video` | WF3 lógica |
| texto = "sim" + `aguardando_confirmacao` | WF4 lógica |

---

## Valores a substituir

| Placeholder | Onde encontrar |
|-------------|---------------|
| `ID_PASTA_RAIZ` | URL do Drive ao abrir "Gestor Thiago Lisboa" |
| `URL_EVOLUTION` | Painel da Evolution API |
| `INSTANCIA` | Nome da instância na Evolution API |
| `APIKEY` | Painel Evolution API → API Keys |
| `5547988620003@s.whatsapp.net` | Verificar no payload do primeiro webhook recebido |

---

## Ordem de execução e testes

1. Executar SQL no Supabase
2. Criar os 4 workflows no n8n (desativados)
3. Configurar webhook na Evolution API
4. Ativar WF1 → testar: mandar "Drive" → confirmar que lista chega
5. Ativar WF2 → testar: responder número → confirmar mensagem de seleção
6. Ativar WF3 → testar: enviar vídeo com legenda → confirmar mensagem de resumo
7. Ativar WF4 → testar: responder "sim" → confirmar upload e link
