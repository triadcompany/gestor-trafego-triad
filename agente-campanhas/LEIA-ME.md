# Agente criador de campanhas (Claude Code)

## O que vem nesta pasta

```
agente-campanhas/
├── .claude/agents/criador-campanhas.md   ← o agente (regras e fluxo)
├── docs/modelo-copy.md                   ← seu modelo de copy
├── transcricoes/                         ← o agente salva as transcrições aqui
└── LEIA-ME.md
```

## Instalação (uma vez)

1. **Copie a pasta** para o seu PC, por exemplo `Documentos/agente-campanhas`.
2. **Vibe com API:** abra o Vibe em modo servidor (`vibe --server`). A API fica em `http://localhost:3022` e a documentação em `http://localhost:3022/docs`. Abra esse endereço no navegador para confirmar que o servidor está rodando.
3. **Acesso ao Meta**, de um destes dois jeitos:
   - **Conector Meta Ads no Claude Code:** se ele aparecer no `/mcp` do Claude Code, o agente usa o conector.
   - **Token da Graph API:** gere um token de usuário do sistema no Business Manager com as permissões `ads_management`, `ads_read` e `pages_read_engagement`. Depois coloque o token numa variável de ambiente:
     - Windows (PowerShell): `setx META_ACCESS_TOKEN "seu_token"`
     - Mac/Linux: adicione `export META_ACCESS_TOKEN="seu_token"` no `~/.zshrc`.

   Para **subir os vídeos do PC** para a conta, o token é necessário. O upload de arquivo local do conector só funciona dentro do app do Claude.
4. Abra o Claude Code **dentro da pasta**: `cd agente-campanhas` e depois `claude`.

## Como usar

No Claude Code, escreva por exemplo:

> Usa o criador-campanhas. Conta CA - AB VEÍCULOS (reserva), Campinas SP 30 km, R$ 11/dia cada.
> Vídeos: C:\Users\voce\Videos\AB\Onix 2023.mp4, C:\Users\voce\Videos\AB\Nivus Highline 2023.mp4

O agente:
1. transcreve cada vídeo no Vibe;
2. tira preço, km e condições do que foi falado;
3. escreve o texto principal e o título no seu modelo;
4. sobe vídeo, campanha, conjunto e anúncio no seu padrão, tudo **pausado**;
5. confere tudo, mostra um resumo e pergunta se pode ativar.

## Padrões já configurados

- Nome: `[ENG-MSG] [MODELO EM MAIÚSCULAS]`
- Engajamento → WhatsApp, meta por conversa, orçamento diário na campanha
- Público de 25 a 55 anos, todos os gêneros, sem interesses, Advantage+ público desligado
- Só Facebook + Instagram, com **todos** os posicionamentos das duas plataformas
- Sem "gasto limitado em posicionamentos excluídos" (5%) e sem limite de gasto no conjunto
- Mensagem pronta: `Olá tenho interesse no: <modelo>`

Para mudar algum padrão, edite `.claude/agents/criador-campanhas.md` ou peça ao próprio Claude Code para editar.

## Painel local (Agente Triad)

Painel que roda só no Mac do dono, em `http://localhost:3055`, usando o Claude logado + conector Meta Ads.

```
cd agente-campanhas/painel
npm ci
./iniciar.command        # ou: node server.mjs
```

- A tela do gestor `/agente-triad` (só org Triad Company) conversa com este painel e envia a lista de clientes.
- O painel só aceita pedidos do gestor (CORS/Origin) e pede aprovação para ativar, apagar ou mexer em status/orçamento.
- Nunca roda no servidor do gestor; está fora do build (`.dockerignore`).
