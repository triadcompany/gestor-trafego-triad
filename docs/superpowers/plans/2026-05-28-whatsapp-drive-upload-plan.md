# Plano de Implementação — WhatsApp → Google Drive Upload
**Spec:** [2026-05-28-whatsapp-drive-upload-design.md](../specs/2026-05-28-whatsapp-drive-upload-design.md)
**Data:** 2026-05-28

---

## Pré-requisitos (fazer antes de começar)

- [ ] Anotar o **ID da pasta "Gestor Thiago Lisboa"** no Google Drive (copiar da URL ao abrir a pasta)
- [ ] Executar SQL no Supabase:
  ```sql
  CREATE TABLE drive_uploads (
    id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    media_url  text        NOT NULL,
    car_name   text        NOT NULL,
    folders    jsonb       NOT NULL,
    status     text        DEFAULT 'aguardando',
    folder_id  text,
    created_at timestamptz DEFAULT now()
  );
  ```
- [ ] Confirmar a URL base da Evolution API, o `apikey` e o nome da instância
- [ ] Confirmar o número autorizado exato como aparece no webhook (ex: `5547988620003@s.whatsapp.net`)

---

## Fase 1 — Workflow 1: Receber Vídeo

### Passo 1.1 — Criar workflow e webhook trigger
- Criar novo workflow no n8n: **"WA Drive — Receber Vídeo"**
- Adicionar nó **Webhook**:
  - Method: POST
  - Path: `wa-drive-receber`
  - Response mode: `Immediately`
- Configurar a Evolution API para disparar webhook nessa URL para o evento `messages.upsert`

### Passo 1.2 — Filtrar mensagem válida
- Adicionar nó **IF** "Filtrar Mensagem" com todas as condições AND:
  - `{{ $json.data.messageType }}` equals `videoMessage`
  - `{{ $json.data.key.remoteJid }}` equals `5547988620003@s.whatsapp.net`
  - `{{ $json.data.message.videoMessage.caption }}` matches regex `^.+\s*-\s*.+$`

### Passo 1.3 — Extrair campos do caption
- Adicionar nó **Code** "Extrair Campos":
  ```javascript
  const data = $input.first().json.data;
  const caption = data.message.videoMessage.caption.trim();
  const match = caption.match(/^(.+?)\s*-\s*(.+)$/);
  const carName = match[2].trim();
  const mediaUrl = data.message.videoMessage.url;
  const remoteJid = data.key.remoteJid;

  return [{ json: { carName, mediaUrl, remoteJid } }];
  ```

### Passo 1.4 — Listar pastas do cliente no Drive
- Adicionar nó **Google Drive** "Listar Pastas Cliente":
  - Operation: Search Files
  - Query: `'<ID de "Gestor Thiago Lisboa">' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  - Fields: `id, name`

### Passo 1.5 — Montar lista numerada
- Adicionar nó **Code** "Montar Lista":
  ```javascript
  const files = $input.all();
  const folders = files
    .map(item => ({ name: item.json.name, id: item.json.id }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((f, i) => ({ index: i + 1, name: f.name, id: f.id }));

  const listText = folders.map(f => `${f.index}. ${f.name}`).join('\n');
  const carName = $('Extrair Campos').item.json.carName;
  const mediaUrl = $('Extrair Campos').item.json.mediaUrl;
  const remoteJid = $('Extrair Campos').item.json.remoteJid;

  const message = `📁 Recebi o vídeo! Qual é a pasta do cliente?\n\n${listText}\n\nResponda com o número da pasta.\n(Carro: ${carName})`;

  return [{ json: { folders, message, carName, mediaUrl, remoteJid } }];
  ```

### Passo 1.6 — Salvar no Supabase
- Adicionar nó **Supabase** "Salvar Supabase":
  - Operation: Insert
  - Table: `drive_uploads`
  - Fields:
    - `media_url`: `={{ $json.mediaUrl }}`
    - `car_name`: `={{ $json.carName }}`
    - `folders`: `={{ JSON.stringify($json.folders) }}`
    - `status`: `aguardando`

### Passo 1.7 — Enviar lista no WhatsApp
- Adicionar nó **HTTP Request** "Enviar Lista WA":
  - Method: POST
  - URL: `<url_evolution_api>/message/sendText/<instancia>`
  - Header: `apikey: <sua_apikey_evolution>`
  - Body (JSON):
    ```json
    {
      "number": "={{ $('Montar Lista').item.json.remoteJid }}",
      "text": "={{ $('Montar Lista').item.json.message }}"
    }
    ```

---

## Fase 2 — Workflow 2: Confirmar e Fazer Upload

### Passo 2.1 — Criar workflow e webhook trigger
- Criar novo workflow: **"WA Drive — Confirmar e Upload"**
- Adicionar nó **Webhook**:
  - Method: POST
  - Path: `wa-drive-confirmar`
  - Response mode: `Immediately`
- Configurar a Evolution API para disparar webhook nessa URL também

> **Nota:** Se a Evolution API não suporta múltiplos webhooks por instância, use um único webhook e bifurque com um IF logo no início: se tem vídeo + caption no formato → Workflow 1; se é texto numérico → Workflow 2.

### Passo 2.2 — Filtrar resposta numérica
- Adicionar nó **IF** "Filtrar Resposta" (AND):
  - `{{ $json.data.key.remoteJid }}` equals `5547988620003@s.whatsapp.net`
  - `{{ $json.data.messageType }}` equals `conversation` OR `extendedTextMessage`
  - Texto corresponde a regex `^\d+$`

### Passo 2.3 — Buscar registro pendente
- Adicionar nó **Supabase** "Buscar Pendente":
  - Operation: Select
  - Table: `drive_uploads`
  - Filter: `status` equals `aguardando`
  - Order by: `created_at` DESC
  - Limit: 1

### Passo 2.4 — Checar se há registro
- Adicionar nó **IF** "Tem Registro?":
  - `{{ $json.id }}` is not empty
  - Branch FALSE: encerrar

### Passo 2.5 — Validar número e selecionar pasta
- Adicionar nó **Code** "Validar e Selecionar":
  ```javascript
  const msgText = $('Filtrar Resposta').item.json.data.message.conversation
    || $('Filtrar Resposta').item.json.data.message.extendedTextMessage?.text || '';
  const escolha = parseInt(msgText.trim());
  const registro = $('Buscar Pendente').item.json;
  const folders = registro.folders;

  if (isNaN(escolha) || escolha < 1 || escolha > folders.length) {
    return [{ json: { valido: false, total: folders.length } }];
  }

  const pastaCliente = folders.find(f => f.index === escolha);
  return [{
    json: {
      valido: true,
      pastaClienteId: pastaCliente.id,
      pastaClienteNome: pastaCliente.name,
      carName: registro.car_name,
      mediaUrl: registro.media_url,
      registroId: registro.id
    }
  }];
  ```

### Passo 2.6 — Tratar número inválido
- Adicionar nó **IF** "Número Válido?":
  - `{{ $json.valido }}` equals `true`
  - Branch FALSE → **HTTP Request** "Enviar Erro WA":
    - Mensagem: `❌ Número inválido. Responda com um número entre 1 e {{ $('Validar e Selecionar').item.json.total }}.`

### Passo 2.7 — Criar subpasta do carro
- Adicionar nó **Google Drive** "Criar Subpasta":
  - Operation: Create Folder
  - Folder name: `={{ $json.carName }}`
  - Parent folder ID: `={{ $json.pastaClienteId }}`

### Passo 2.8 — Baixar vídeo da Evolution API
- Adicionar nó **HTTP Request** "Baixar Mídia":
  - Method: GET
  - URL: `={{ $('Validar e Selecionar').item.json.mediaUrl }}`
  - Header: `apikey: <sua_apikey_evolution>`
  - Response format: `File`

### Passo 2.9 — Upload direto na subpasta
- Adicionar nó **Google Drive** "Upload Drive":
  - Operation: Upload
  - Drive: My Drive
  - Folder ID: `={{ $('Criar Subpasta').item.json.id }}`
  - File name: `={{ $('Validar e Selecionar').item.json.carName }}_{{ $now.toFormat('yyyyMMdd_HHmmss') }}.mp4`
  - Input binary field: `data`

### Passo 2.10 — Atualizar Supabase
- Adicionar nó **Supabase** "Atualizar Supabase":
  - Operation: Update
  - Table: `drive_uploads`
  - Filter: `id` equals `={{ $('Validar e Selecionar').item.json.registroId }}`
  - Fields:
    - `status`: `concluido`
    - `folder_id`: `={{ $('Criar Subpasta').item.json.id }}`

### Passo 2.11 — Enviar link no WhatsApp
- Adicionar nó **HTTP Request** "Enviar Link WA":
  - Method: POST
  - URL: `<url_evolution_api>/message/sendText/<instancia>`
  - Header: `apikey: <sua_apikey_evolution>`
  - Body:
    ```json
    {
      "number": "5547988620003@s.whatsapp.net",
      "text": "✅ Vídeo salvo em {{ $('Validar e Selecionar').item.json.pastaClienteNome }} / {{ $('Validar e Selecionar').item.json.carName }}!\n\n📂 https://drive.google.com/drive/folders/{{ $('Criar Subpasta').item.json.id }}"
    }
    ```

---

## Ordem de execução

1. Executar SQL no Supabase
2. Anotar ID da pasta "Gestor Thiago Lisboa" no Drive
3. Construir e ativar Workflow 1
4. Testar Workflow 1: enviar vídeo com caption → confirmar que a lista chega no WhatsApp
5. Construir e ativar Workflow 2
6. Testar fluxo completo: enviar vídeo → receber lista → responder número → confirmar upload e link

---

## Valores a substituir

| Placeholder | Onde encontrar |
|-------------|---------------|
| `<ID de "Gestor Thiago Lisboa">` | URL do Drive ao abrir a pasta raiz |
| `<url_evolution_api>` | Painel da Evolution API |
| `<instancia>` | Nome da instância na Evolution API |
| `<sua_apikey_evolution>` | Painel da Evolution API → API Keys |
| `5547988620003@s.whatsapp.net` | Confirmar formato exato no payload do webhook |
