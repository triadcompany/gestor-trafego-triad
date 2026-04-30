# Contexto Compactado — Gestor de Tráfego Meta Ads

**Data da compactação:** 2026-04-30  
**Chat original:** ~60 mensagens (sessão anterior compactada + sessão atual)

---

## 1. Objetivo

Evoluir o sistema interno "Gestor de Tráfego" — um painel React para gestão de campanhas Meta Ads de múltiplos clientes (imobiliárias, construtoras, concessionárias). Nesta sessão: corrigir erros de API Meta, melhorar busca de localização, criar gestão de templates de conversa WhatsApp, e implementar a página de controle de cobranças PIX.

---

## 2. Decisões Tomadas

- **Meta API — bid_strategy obrigatório:** Campanhas CBO na v21.0 exigem `bid_strategy: "LOWEST_COST_WITHOUT_CAP"` explícito na criação. Sem isso → erro `is_adset_budget_sharing_enabled`. Aplicado em `createCampaignFromScratch` e `duplicateCampaign`.
- **Meta API — advantage_audience sempre desabilitado:** Sempre enviar `targeting_automation: { advantage_audience: 0 }`. Instrução explícita do usuário ("DEIXA SEMPRE DESABILITADO").
- **Meta API — call_to_action sem `message`:** A chave `message` é inválida em `call_to_action[value]`. Solução: encodar a mensagem na URL wa.me como `?text=encodeURIComponent(msg)`. O CTA só recebe `app_destination` e `whatsapp_number`.
- **Localização — SelectedLocation com radius:** Interface própria substitui `MetaLocationResult[]`. Cidades ganham seletor de raio (só cidade / +30km / +50km / +80km). Regiões não têm raio.
- **Localização — click-outside:** Usar `useRef` + `useEffect` com `document.addEventListener("mousedown")`. A solução com `onBlur` não funcionava.
- **Templates de conversa:** CRUD inline na tela de nova campanha — criar/editar/duplicar templates salvos no Supabase (`conversation_templates`). Quando a tabela não existe, mostra o SQL de criação inline.
- **PIX — página dedicada `/pix`:** Escolha B (página separada) sobre adicionar colunas em Saldos. Tabela já tinha 5 colunas; workflows são diferentes.
- **PIX — sem histórico de pagamentos:** Escopo final: só mostrar ciclo, valor da parcela e próximo vencimento. Sem marcar como pago, sem histórico.
- **PIX — campos no cliente:** 4 campos novos em `clients`: `monthly_budget`, `pix_cycle`, `pix_reference_day`, `pix_active`.
- **PIX — cálculo de parcela:** semanal = monthly_budget ÷ 4 · quinzenal = ÷ 2 · mensal = valor cheio.
- **PIX — pix_reference_day semântico:** Para `semanal`: 1–7 onde 1=Segunda, 7=Domingo. Para `quinzenal`: 1–16 (ocorre no dia X e X+15). Para `mensal`: 1–28.
- **Supabase tipos duplicados:** O cliente Supabase usa `src/integrations/supabase/types.ts` (não `src/lib/database.types.ts`). Ambos precisam ser atualizados a cada mudança de schema.
- **Segurança — token-optimizer rejeitado:** Repositório `alexgreensh/token-optimizer` não foi instalado. Motivo: autor desconhecido, instala hooks automáticos em todos os projetos, licença não-comercial (PolyForm), risco de supply chain.

---

## 3. Estado Atual

**Código:** Tudo implementado e commitado. Branch `main` no GitHub (`triadcompany/gestor-trafego-triad`), último commit `a262fd3`.

**Banco de dados (Supabase):** ⚠️ **Duas migrations pendentes — não rodaram ainda.**

| Migration | Status |
|-----------|--------|
| PIX fields em `clients` | ❌ Não rodou |
| Tabela `conversation_templates` | ❌ Não rodou |

**App:** TypeScript compila sem erros. Funcionalidades novas só funcionam após rodar as migrations.

---

## 4. Arquivos e Artefatos Relevantes

| Arquivo | Status | Descrição |
|---------|--------|-----------|
| `src/lib/meta.ts` | Editado | Fix bid_strategy, advantage_audience, call_to_action, SelectedLocation, radius geo |
| `src/routes/campaigns.new.tsx` | Editado | Location search com radius + template de conversa CRUD |
| `src/routes/pix.tsx` | Criado | Página /pix com tabela de vencimentos e cards de resumo |
| `src/routes/clients.$id.tsx` | Editado | Seção "Cobrança PIX" com toggle + campos |
| `src/routes/clients.index.tsx` | Editado | Modal "Editar cliente" com campos PIX |
| `src/components/AppShell.tsx` | Editado | Item "PIX" adicionado na sidebar (entre Saldos e Tarefas) |
| `src/lib/queries.ts` | Editado | `fetchPixClients`, `updateClientPix`, `upsertClient` atualizado, `ConversationTemplate` |
| `src/lib/database.types.ts` | Editado | PIX fields + conversation_templates |
| `src/integrations/supabase/types.ts` | Editado | PIX fields + conversation_templates |
| `src/routeTree.gen.ts` | Auto-gerado | Rota /pix registrada automaticamente pelo TanStack Router |
| `docs/migrations/2026-04-29-pix-fields.sql` | Criado | Migration PIX para rodar no Supabase |
| `docs/superpowers/specs/2026-04-29-pix-management-design.md` | Criado | Design doc do feature PIX |

---

## 5. Código e Configurações Críticas

### Migration PIX (rodar no Supabase Dashboard → SQL Editor)

```sql
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS monthly_budget    numeric(10,2),
  ADD COLUMN IF NOT EXISTS pix_cycle         text CHECK (pix_cycle IN ('semanal','quinzenal','mensal')),
  ADD COLUMN IF NOT EXISTS pix_reference_day integer CHECK (pix_reference_day BETWEEN 1 AND 31),
  ADD COLUMN IF NOT EXISTS pix_active        boolean NOT NULL DEFAULT false;
```

### Migration conversation_templates (rodar no Supabase Dashboard → SQL Editor)

```sql
CREATE TABLE IF NOT EXISTS conversation_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  greeting   text,
  pre_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### SelectedLocation (interface em src/lib/meta.ts)

```typescript
export interface SelectedLocation {
  key: string;
  name: string;
  type: string; // "city" | "region"
  region?: string;
  radius?: number; // km, só para cidades
}
```

### Geo targeting com radius (em meta.ts)

```typescript
const cityLocs = t.locations.filter((l) => l.type === "city");
const regionLocs = t.locations.filter((l) => l.type !== "city");
if (cityLocs.length) {
  geoLocations.cities = cityLocs.map((l) => ({
    key: l.key,
    ...(l.radius ? { radius: l.radius, distance_unit: "kilometer" } : {}),
  }));
}
if (regionLocs.length) {
  geoLocations.regions = regionLocs.map((l) => ({ key: l.key }));
}
```

### Call to action WhatsApp (sem message key)

```typescript
const waLink = opts.whatsappMessage
  ? `https://wa.me/${opts.whatsappNumber}?text=${encodeURIComponent(opts.whatsappMessage)}`
  : `https://wa.me/${opts.whatsappNumber}`;
const callToAction = {
  type: "WHATSAPP_MESSAGE",
  value: { app_destination: "WHATSAPP", whatsapp_number: opts.whatsappNumber },
};
// link vai em page_link / link da campanha, não no CTA value
```

---

## 6. Erros e Armadilhas Conhecidas

- **`bid_amount` em ad sets de CBO:** Remover. CBO não aceita bid_amount no ad set — gera erro. Só `bid_strategy` na campanha.
- **`targeting_automation` fora de `targeting`:** O campo deve ir dentro do objeto `targeting` do ad set, não no nível raiz.
- **`message` em call_to_action[value]:** Campo inválido na API v21.0. Usar `?text=` na URL wa.me.
- **`explore_home` sem `explore`:** O placement `explore_home` requer que `explore` também esteja na lista — senão a API rejeita.
- **Supabase types:** Sempre atualizar AMBOS `src/lib/database.types.ts` E `src/integrations/supabase/types.ts`. O cliente tipado usa o segundo; o primeiro é só a definição de domínio.
- **routeTree.gen.ts:** Não editar manualmente. O TanStack Router regenera automaticamente ao criar/deletar arquivos de rota.
- **Click-outside com onBlur:** Não funciona para dropdowns com elementos filhos clicáveis. Usar `useRef` + `mousedown` listener.

---

## 7. Próximos Passos

- [ ] Rodar migration PIX no Supabase Dashboard
- [ ] Rodar migration `conversation_templates` no Supabase Dashboard
- [ ] Testar página `/pix` com dados reais (configurar pelo menos 1 cliente)
- [ ] Testar templates de conversa (criar, editar, duplicar)
- [ ] Verificar se a busca de localização com raio está enviando corretamente para a API Meta

---

## 8. Informações Pendentes

- O campo `daily_budget` mostrado na tela do cliente (`clients.$id.tsx`) — de onde vem? Não parece estar em `ClientRow`. Pode ser um resquício ou campo legado. [A CONFIRMAR]
- O comportamento de `pix_reference_day` para clientes semanais que pagam em um dia específico da semana (ex: toda terça) — o UI atual usa 1–7 como dia da semana. Confirmar se o usuário entendeu essa convenção.

---

> **Instrução para o próximo chat:** Este arquivo contém o contexto compactado de um chat anterior sobre o sistema "Gestor de Tráfego Meta Ads" (React + TanStack Router + Supabase + shadcn/ui). Use-o como base para continuar o trabalho. Não peça ao usuário para repetir informações que já estão aqui. Comece confirmando brevemente que entendeu o contexto e pergunte por onde o usuário quer continuar. **Atenção especial:** as duas migrations de banco de dados ainda não foram executadas — qualquer feature de PIX ou templates de conversa depende disso.
