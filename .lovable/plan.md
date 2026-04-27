## Objetivo

Criar uma página de diagnóstico da Meta para mostrar, com clareza, se o token atual está correto, quais permissões foram concedidas, qual chamada da Meta está falhando e o que precisa ser corrigido no app/Business Manager para liberar duplicação e criação de campanhas.

## Situação atual confirmada

- O sistema está usando o token salvo no Supabase, atualmente com final `n3kEZB`.
- O token tem `ads_management` e `ads_read` concedidos.
- A duplicação falha na chamada `POST /{campaign_id}/copies` com erro Meta `(#3) Application does not have the capability to make this API call`.
- Isso indica que o problema provavelmente não é só permissão do token; pode ser capacidade/aprovação do app Meta, modo do app, Business Manager, permissões avançadas, acesso à conta de anúncio, ou combinação entre app/token/conta.

## Plano de implementação

### 1. Criar uma camada de diagnóstico Meta

Adicionar funções específicas para diagnóstico em `src/lib/meta.ts` ou em um novo módulo, reutilizando o token salvo.

Essas funções vão consultar:

- `GET /me` para confirmar qual usuário está autenticado.
- `GET /me/permissions` para listar permissões concedidas, recusadas e ausentes.
- `GET /me/adaccounts` para confirmar se a conta de anúncios aparece para o token.
- Uma chamada controlada de teste para a API de campanha, sem expor o token na UI.

O resultado será normalizado para uma estrutura como:

```text
Token
- válido/inválido
- usuário conectado
- final mascarado

Permissões
- ads_read: concedida/recusada/ausente
- ads_management: concedida/recusada/ausente
- business_management: concedida/recusada/ausente
- pages_manage_ads: concedida/recusada/ausente

Conta de anúncios
- encontrada/não encontrada
- status da conta
- nome/id

Teste de escrita
- endpoint testado
- status HTTP
- código Meta
- mensagem Meta
- interpretação provável
```

### 2. Armazenar a última resposta de erro da Meta

Atualizar as funções de criação/duplicação para registrar a última resposta da API em `app_config`, por exemplo:

- `last_meta_api_error`
- `last_meta_api_error_at`
- `last_meta_api_endpoint`

Importante: salvar apenas dados seguros, como endpoint, status, código, mensagem e `fbtrace_id`. Nunca salvar nem renderizar o token completo.

Isso permitirá que a página de diagnóstico mostre exatamente a última falha real, inclusive se ela aconteceu em duplicação ou criação do zero.

### 3. Criar a rota `/diagnostico-meta`

Adicionar uma nova página no app com layout profissional e direto, em português:

- Cabeçalho: “Diagnóstico Meta Ads”
- Card “Token atual” com usuário conectado, validade e token mascarado.
- Card “Permissões do token” com badges:
  - Concedida
  - Recusada
  - Ausente
- Card “Conta de anúncios” mostrando se a conta usada pelo cliente selecionado está acessível.
- Card “Última resposta da API” mostrando:
  - endpoint
  - erro Meta
  - código
  - `fbtrace_id`
  - horário
- Card “Diagnóstico provável” com orientação prática:
  - se `ads_management` estiver ausente/recusada: gerar novo token com essa permissão.
  - se `business_management` estiver ausente: solicitar/adicionar essa permissão quando o fluxo exigir Business Manager.
  - se `(#3) Application does not have the capability...`: revisar capacidade do app Meta/Marketing API e nível de acesso da permissão no App Review.
  - se a conta não aparecer em `/me/adaccounts`: revisar acesso do usuário/system user à conta de anúncios.

### 4. Adicionar ação “Executar diagnóstico agora”

Na página, incluir um botão para rodar novamente as verificações.

O botão deve:

- buscar o token salvo;
- consultar permissões;
- consultar contas de anúncio;
- mostrar resultado atualizado;
- não disparar criação real de campanha por padrão.

Se necessário, podemos incluir um “teste avançado” opcional depois, mas o diagnóstico inicial deve evitar criar ou duplicar campanha acidentalmente.

### 5. Integrar com a tela de Configurações e Nova Campanha

Adicionar links para a página de diagnóstico em pontos úteis:

- `/settings`: botão “Ver diagnóstico Meta”.
- `/campaigns/new`: quando a API falhar, além do toast, mostrar/permitir abrir “Ver diagnóstico”.

Também melhorar a mensagem de erro para explicar que o token pode estar com `ads_management` concedido, mas o app Meta ainda pode estar sem capacidade/aprovação para escrita.

### 6. Corrigir arquitetura de chamadas sensíveis

Hoje o token e chamadas Meta estão sendo usados no cliente. Para diagnóstico e operações sensíveis, o ideal é mover as chamadas Meta para server functions (`createServerFn`).

Fase inicial:

- implementar o diagnóstico via server function para evitar expor detalhes sensíveis;
- manter compatibilidade com o fluxo atual.

Fase seguinte recomendada:

- migrar duplicação/criação de campanhas para server functions;
- centralizar logging de erro Meta;
- evitar que o token trafegue para o browser.

## Critérios de sucesso

A correção estará concluída quando:

- `/diagnostico-meta` mostrar o token atual mascarado e o usuário conectado.
- A página listar claramente `ads_read`, `ads_management`, `business_management` e permissões relacionadas.
- A última resposta real da Meta aparecer na página, incluindo `(#3)` quando ocorrer.
- A UI explicar se o bloqueio é token, conta de anúncios, permissão recusada/ausente ou capacidade do app Meta.
- Build passar sem erros.

## Próximo passo fora do código, se o diagnóstico confirmar bloqueio de app Meta

Se o diagnóstico continuar mostrando `(#3) Application does not have the capability to make this API call` mesmo com `ads_management: granted`, o ajuste provavelmente será no painel da Meta:

1. Abrir o app em Meta for Developers.
2. Confirmar que o produto Marketing API está adicionado ao app.
3. Verificar se o app está em modo Live quando necessário.
4. Conferir App Review/Advanced Access para `ads_management` e permissões relacionadas.
5. Conferir se o usuário/system user do token tem permissão de anunciante/admin na conta `act_...` dentro do Business Manager.
6. Se estiver usando token de usuário comum, considerar trocar para System User Token do Business Manager para produção.