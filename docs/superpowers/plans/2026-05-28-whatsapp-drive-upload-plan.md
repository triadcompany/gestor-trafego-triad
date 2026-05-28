# Plano de Implementação — WhatsApp → Google Drive Upload
**Spec:** [2026-05-28-whatsapp-drive-upload-design.md](../specs/2026-05-28-whatsapp-drive-upload-design.md)
**Data:** 2026-05-28

---

## Pré-requisitos (fazer antes de começar)

- [ ] Criar pasta `_temp` manualmente dentro de "Gestor Thiago Lisboa" no Google Drive e anotar o ID
- [ ] Anotar o ID da pasta raiz "Gestor Thiago Lisboa" no Google Drive
- [ ] Executar SQL no Supabase:
  ```sql
  CREATE TABLE drive_uploads (
    id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    file_id    text        NOT NULL,
    car_name   text        NOT NULL,
    folders    jsonb       NOT NULL,
    status     text        DEFAULT 'aguardando',
    folder_id  text,
    created_at timestamptz DEFAULT now()
  );
  ```
- [ ] Confirmar a URL base da Evolution API e o `apikey`
- [ ] Confirmar o número autorizado (remetente) exato como aparece no webhook da Evolution API (formato: `5547988620003@s.whatsapp.net`)

---

## Fase 1 — Workflow 1: Receber Vídeo

### Passo 1.1 — Criar workflow e webhook trigger
- Criar novo workflow no n8n chamado **"WA Drive — Receber Vídeo"**
- Adicionar nó **Webhook**:
  - Method: POST
  - Path: `wa-drive-receber`
  - Response mode: `Immediately`
- Configurar a Evolution API para disparar webhook nessa URL para o evento `messages.upsert`

### Passo 1.2 — Filtrar mensagem válida
- Adicionar nó **IF** chamado "Filtrar Mensagem":
  - Condição 1: `{{ $json.data.messageType }}` equals `videoMessage`
  - Condição 2: `{{ $json.data.key.remoteJid }}` equals `5547988620003@s.whatsapp.net` (número autorizado)
  - Condição 3: `{{ $json.data.message.videoMessage.caption }}` matches regex `^.+\s*-\s*.+$`
  - Operador entre condições: AND

### Passo 1.3 — Extrair campos do caption
- Adicionar nó **Code** chamado "Extrair Campos":
  ```javascript
  const caption = $input.first().json.data.message.videoMessage.caption.trim();
  const match = caption.match(/^(.+?)\s*-\s*(.+)$/);
  const clientRaw = match[1].trim();
  const carName = match[2].trim();
  const mediaUrl = $input.first().json.data.message.videoMessage.url;
  const remoteJid = $input.first().json.data.key.remoteJid;

  return [{ json: { clientRaw, carName, mediaUrl, remoteJid } }];
  ```

### Passo 1.4 — Baixar o vídeo da Evolution API
- Adicionar nó **HTTP Request** chamado "Baixar Mídia":
  - Method: GET
  - URL: `={{ $('Extrair Campos').item.json.mediaUrl }}`
  - Header: `apikey: <sua_apikey_evolution>`
  - Response format: `File`
- Isso retorna o binário do vídeo

### Passo 1.5 — Upload para pasta _temp no Drive
- Adicionar nó **Google Drive** chamado "Upload _temp":
  - Operation: Upload
  - Drive: My Drive
  - Folder ID: `<ID da pasta _temp>`
  - File name: `={{ $('Extrair Campos').item.json.carName }}_{{ $now.toFormat('yyyyMMdd_HHmmss') }}.mp4`
  - Input binary field: `data` (vem do nó anterior)

### Passo 1.6 — Listar pastas do cliente no Drive
- Adicionar nó **Google Drive** chamado "Listar Pastas Cliente":
  - Operation: Search Files
  - Query: `'<ID de "Gestor Thiago Lisboa">' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  - Fields: `id, name`

### Passo 1.7 — Montar lista numerada
- Adicionar nó **Code** chamado "Montar Lista":
  ```javascript
  const files = $input.all();
  const folders = files
    .map(item => ({ name: item.json.name, id: item.json.id }))
    .filter(f => f.name !== '_temp')
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((f, i) => ({ index: i + 1, name: f.name, id: f.id }));

  const listText = folders.map(f => `${f.index}. ${f.name}`).join('\n');
  const carName = $('Extrair Campos').item.json.carName;
  const fileId = $('Upload _temp').item.json.id;
  const remoteJid = $('Extrair Campos').item.json.remoteJid;

  const message = `📁 Recebi o vídeo! Qual é a pasta do cliente?\n\n${listText}\n\nResponda com o número da pasta.\n(Carro: ${carName})`;

  return [{ json: { folders, message, fileId, carName, remoteJid } }];
  ```

### Passo 1.8 — Salvar no Supabase
- Adicionar nó **Supabase** chamado "Salvar Supabase":
  - Operation: Insert
  - Table: `drive_uploads`
  - Fields:
    - `file_id`: `={{ $json.fileId }}`
    - `car_name`: `={{ $json.carName }}`
    - `folders`: `={{ JSON.stringify($json.folders) }}`
    - `status`: `aguardando`

### Passo 1.9 — Enviar lista no WhatsApp
- Adicionar nó **HTTP Request** chamado "Enviar Lista WA":
  - Method: POST
  - URL: `<url_evolution_api>/message/sendText/<instancia>`
  - Header: `apikey: <sua_apikey_evolution>`
  - Body (JSON):
    ```json
    {
      "number": "{{ $('Montar Lista').item.json.remoteJid }}",
      "text": "{{ $('Montar Lista').item.json.message }}"
    }
    ```

---

## Fase 2 — Workflow 2: Confirmar e Mover

### Passo 2.1 — Criar workflow e webhook trigger
- Criar novo workflow no n8n chamado **"WA Drive — Confirmar e Mover"**
- Adicionar nó **Webhook**:
  - Method: POST
  - Path: `wa-drive-confirmar`
  - Response mode: `Immediately`
- Configurar a Evolution API para disparar webhook nessa URL também (ou usar o mesmo e filtrar por tipo)

> **Nota:** Se a Evolution API suporta múltiplos webhooks por instância, use endpoints separados. Se não, use um único webhook e bifurque com IFs no início de cada workflow.

### Passo 2.2 — Filtrar resposta numérica
- Adicionar nó **IF** chamado "Filtrar Resposta":
  - Condição 1: `{{ $json.data.key.remoteJid }}` equals `5547988620003@s.whatsapp.net`
  - Condição 2: `{{ $json.data.messageType }}` equals `conversation` ou `extendedTextMessage`
  - Condição 3: texto da mensagem corresponde a regex `^\d+$`
  - Operador: AND

### Passo 2.3 — Buscar registro pendente no Supabase
- Adicionar nó **Supabase** chamado "Buscar Pendente":
  - Operation: Select
  - Table: `drive_uploads`
  - Filter: `status` equals `aguardando`
  - Order by: `created_at` DESC
  - Limit: 1

### Passo 2.4 — Checar se há registro
- Adicionar nó **IF** chamado "Tem Registro?":
  - Condição: `{{ $json.id }}` is not empty
  - Se não: encerrar silenciosamente

### Passo 2.5 — Validar número digitado
- Adicionar nó **Code** chamado "Validar e Selecionar":
  ```javascript
  const escolha = parseInt($('Filtrar Resposta').item.json.data.message.conversation || $('Filtrar Resposta').item.json.data.message.extendedTextMessage?.text);
  const registro = $('Buscar Pendente').item.json;
  const folders = registro.folders; // já é array parseado pelo Supabase

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
      fileId: registro.file_id,
      registroId: registro.id
    }
  }];
  ```

### Passo 2.6 — Tratar número inválido
- Adicionar nó **IF** chamado "Número Válido?":
  - Condição: `{{ $json.valido }}` equals `true`
  - Branch FALSE → nó **HTTP Request** "Enviar Erro WA":
    - Mensagem: `❌ Número inválido. Responda com um número entre 1 e {{ $('Validar e Selecionar').item.json.total }}.`

### Passo 2.7 — Criar subpasta do carro
- Adicionar nó **Google Drive** chamado "Criar Subpasta":
  - Operation: Create Folder
  - Folder name: `={{ $json.carName }}`
  - Parent folder ID: `={{ $json.pastaClienteId }}`

### Passo 2.8 — Mover arquivo do _temp para subpasta
- Adicionar nó **Google Drive** chamado "Mover Arquivo":
  - Operation: Move File
  - File ID: `={{ $('Validar e Selecionar').item.json.fileId }}`
  - Destination folder ID: `={{ $('Criar Subpasta').item.json.id }}`

### Passo 2.9 — Atualizar Supabase
- Adicionar nó **Supabase** chamado "Atualizar Supabase":
  - Operation: Update
  - Table: `drive_uploads`
  - Filter: `id` equals `={{ $('Validar e Selecionar').item.json.registroId }}`
  - Fields:
    - `status`: `concluido`
    - `folder_id`: `={{ $('Criar Subpasta').item.json.id }}`

### Passo 2.10 — Enviar link no WhatsApp
- Adicionar nó **HTTP Request** chamado "Enviar Link WA":
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
2. Criar pasta `_temp` no Drive e anotar ID
3. Anotar ID da pasta "Gestor Thiago Lisboa"
4. Construir e ativar Workflow 1
5. Testar Workflow 1 com um vídeo real no WhatsApp
6. Construir e ativar Workflow 2
7. Testar fluxo completo: enviar vídeo → receber lista → responder número → receber link

---

## Valores a substituir

| Placeholder | Onde encontrar |
|-------------|---------------|
| `<ID da pasta _temp>` | URL do Drive ao abrir a pasta |
| `<ID de "Gestor Thiago Lisboa">` | URL do Drive ao abrir a pasta raiz |
| `<url_evolution_api>` | Painel da Evolution API |
| `<instancia>` | Nome da instância na Evolution API |
| `<sua_apikey_evolution>` | Painel da Evolution API → API Keys |
| `5547988620003@s.whatsapp.net` | Confirmar formato exato no payload do webhook |
