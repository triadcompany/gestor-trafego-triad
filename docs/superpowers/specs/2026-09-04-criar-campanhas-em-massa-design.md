# Criar campanhas em massa — Design Spec

**Data:** 2026-09-04
**Status:** Aprovado pelo usuário

---

## Contexto

O usuário sobe campanhas de carro em carro, uma de cada vez, mesmo quando 5+ carros compartilham exatamente a mesma configuração de campanha (mesmo objetivo, orçamento, segmentação, posicionamento, número de WhatsApp e modelo de conversa) — só o criativo (imagem/vídeo) e a copy (texto principal, título, descrição) mudam de carro pra carro. Ele quer poder preencher a configuração compartilhada uma única vez e então subir várias campanhas de uma vez, uma por carro.

## Objetivo

Adicionar um terceiro modo na tela de criar campanha ("Criar em massa", ao lado de "Criar do zero" e "Duplicar") que:
1. Coleta a configuração compartilhada uma única vez.
2. Permite adicionar N "carros", cada um com seu próprio nome, mídia e copy.
3. Cria N campanhas na Meta, sequencialmente, cada uma com a configuração compartilhada + os dados daquele carro.
4. Reporta claramente o que deu certo e o que falhou, sem travar o lote inteiro por causa de 1 erro.

## Fora de escopo (v1)

- Orçamento, número de WhatsApp, segmentação ou posicionamento diferentes por carro — tudo isso é compartilhado por todo o lote nessa primeira versão.
- Botão de "tentar de novo" automático por carro que falhou — o usuário recria manualmente com os mesmos dados usando o modo "Criar do zero" normal.
- Importação via planilha/CSV — a lista de carros é preenchida direto na tela, um por um.
- Qualquer alteração em banco de dados — o recurso só orquestra chamadas à API da Meta que já existem hoje; nada novo é persistido.

## Design

### Onde fica

Na tela `/campaigns/new`, o seletor de modo (hoje "Criar do zero" / "Duplicar") ganha uma terceira opção: **"Criar em massa"**.

### Fluxo

**1. Cliente** — igual ao que já existe hoje (seleção do cliente, que já traz `meta_ad_account_id`, `meta_page_id`, `meta_whatsapp_number` como padrão).

**2. Configuração compartilhada** — reaproveita exatamente os mesmos campos e componentes já usados no modo "Criar do zero" hoje:
- Tipo de campanha (Engajamento → WhatsApp / Vendas → WhatsApp)
- Orçamento/dia (aplicado a cada uma das N campanhas — não dividido entre elas)
- Configuração de posicionamento (Advantage+ ou manual, com posições FB/IG)
- Segmentação: faixa etária, gênero, localização (cidade/estado + raio), interesses
- Número de WhatsApp Business + modelo de conversa (saudação/pré-mensagem, reaproveitando os "modelos de conversa" já existentes)

**3. Carros** — uma lista, começando com 1 linha vazia, com botão "+ Adicionar carro". Cada linha tem:
- Nome do carro (texto livre, ex: "Onix 2022")
- Mídia (upload de imagem ou vídeo — mesmo componente/validação de tamanho já usado hoje)
- Texto principal, Título, Descrição (mesmos campos de copy do criativo já usados hoje)
- Botão de remover a linha (exceto quando só resta 1)

Botão principal: **"Criar N campanhas"** — desabilitado até toda linha ter nome + mídia + texto principal + título, e a configuração compartilhada estar válida (mesma validação que já existe hoje pro modo "Criar do zero").

### Nomenclatura automática

O usuário só digita o nome do carro; o sistema monta o resto, seguindo o padrão já observado na maioria das contas reais:

| Campo | Padrão |
|---|---|
| Nome da campanha | `[ENG-MSG] [<NOME DO CARRO>]` (engajamento) ou `[VENDAS-WHATS] [<NOME DO CARRO>]` (vendas) |
| Nome do conjunto | `CA1 - ABERTO` (fixo, igual pra todas) |
| Nome do anúncio | `AD1 - VIDEO` (mídia é vídeo) ou `AD1 - ARTE` (mídia é imagem) |

### Processamento

Ao clicar em "Criar N campanhas":
1. As campanhas são criadas **uma de cada vez, em sequência** (nunca em paralelo) — evita sobrecarregar limites de taxa da Meta e mantém o progresso fácil de acompanhar.
2. Cada carro reaproveita **exatamente a mesma lógica de criação já usada hoje pelo modo "Criar do zero"**: `createCampaignFromScratch` → `createAdCreative` → `createAd` (ou, se o webhook do n8n estiver configurado, o mesmo caminho via n8n usado hoje pra vídeos grandes) — nenhuma função nova de criação é necessária, só um laço que chama a lógica existente uma vez por carro, trocando nome/mídia/copy a cada chamada.
3. Uma lista de progresso ao vivo mostra, por carro: pendente → enviando mídia/criando → ✓ criada (com link "Abrir campanha") ou ✗ falhou (com a mensagem de erro específica daquele carro).
4. Um erro num carro **não interrompe os demais** — o laço continua pro próximo carro independente do resultado do anterior.
5. Ao final, um resumo: "X de N campanhas criadas com sucesso", com a lista completa de sucessos (com link) e falhas (com motivo) permanecendo visível na tela.

### Dados e persistência

Nenhuma tabela ou coluna nova no banco — o recurso só orquestra chamadas à Marketing API da Meta que a aplicação já faz hoje pra uma campanha. O único estado é local ao componente React (lista de carros, progresso do lote), perdido se a página for recarregada no meio do processo (aceitável — cada campanha já criada com sucesso permanece na Meta independentemente).

### Tratamento de erros

Mesmos tipos de erro que já podem ocorrer hoje na criação de 1 campanha (token expirado, arquivo grande demais, número de WhatsApp não cadastrado, falha de upload de vídeo, limite de taxa da Meta) — a diferença é que, em massa, cada erro fica isolado ao carro que falhou e é reportado com o nome daquele carro, sem abortar os demais.

## Plano de teste

1. Criar em massa 2 carros pro mesmo cliente de teste (1 com imagem, 1 com vídeo), com a mesma configuração compartilhada.
2. Confirmar que as 2 campanhas aparecem corretas na Meta (mesma segmentação, orçamento, WhatsApp; nomes automáticos corretos; mídia/copy do carro certo em cada uma).
3. Forçar uma falha proposital num dos carros (ex: arquivo inválido) e confirmar que o outro carro do lote continua sendo criado normalmente, com a falha reportada claramente.
4. Confirmar que as campanhas nascem pausadas e o conjunto/anúncio ativos, igual ao comportamento já existente do modo "Criar do zero".
