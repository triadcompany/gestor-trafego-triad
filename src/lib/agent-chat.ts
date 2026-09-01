"use server";
import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { db } from "@/db/client";
import { agentConversations, agentMessages } from "@/db/schema";
import { getSessionUserId } from "@/server/session";
import { fetchClients } from "./queries";
import { getOpenAIKey } from "./meta";
import { TOOL_DEFINITIONS, WRITE_TOOLS, executeTool, executeConfirmedAction, describeAction, type JsonArgs } from "./agent-tools";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface PendingAction {
  tool: string;
  args: JsonArgs;
  description: string;
}

export type AgentResponse =
  | { type: "message"; content: string; conversation_id: string }
  | { type: "confirmation_required"; pending_action: PendingAction; conversation_id: string; partial_response?: string }
  | { type: "error"; message: string };

// ── Validators ────────────────────────────────────────────────────────────────

const pendingActionSchema = z.object({
  tool: z.string(),
  args: z.record(z.union([z.string(), z.number(), z.boolean(), z.null(), z.undefined()])),
  description: z.string(),
});

const AGENT_MODES = ["trafego", "copy_automotivo", "roteiro_automotivo"] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

const sendMessageSchema = z.object({
  message: z.string(),
  conversation_id: z.string().nullable(),
  mode: z.enum(AGENT_MODES).optional(),
});

const executeActionSchema = z.object({
  pending_action: pendingActionSchema,
  conversation_id: z.string(),
});

const loadMessagesSchema = z.object({
  conversation_id: z.string(),
});

// ── System prompt builder ─────────────────────────────────────────────────────

const COPY_AUTOMOTIVO_PROMPT = `Você é um especialista em copywriting para anúncios de veículos (Meta Ads/Instagram), focado em campanhas que levam o cliente para o WhatsApp.

Modelo de estrutura (varie o gancho pra não deixar todos os anúncios iguais):
gancho → desejo/benefício → informações → CTA de baixa fricção.

Exemplo de referência:

🚘 Quer entrar no segmento premium sem precisar pagar o preço de um 0km?

BMW 320i 2.0 Active 2017/2017
📍 97 mil km
💰 R$ 119.990

Uma opção para quem procura BMW, desempenho, conforto e presença, por R$ 119.990.

🔄 Pegamos seu carro na troca
💳 Consulte as condições de financiamento

📲 Chame no WhatsApp e veja quanto ficaria para você trocar de carro.

Quando eu enviar os dados de um veículo (modelo, versão, ano, km, preço, diferenciais, condições comerciais), crie a copy seguindo esse modelo — sempre em português brasileiro, tom comercial e persuasivo, sem parecer texto escrito por IA. Se eu pedir mais de uma copy pro mesmo veículo, varie o gancho entre elas.`;

const ROTEIRO_AUTOMOTIVO_PROMPT = `Você é um especialista em marketing automotivo, copywriting, tráfego pago e vendas de veículos seminovos.

Sua função é criar roteiros de vídeos para anúncios de lojas de veículos, principalmente para Meta Ads, Instagram Reels e campanhas que levam o cliente para o WhatsApp.

O principal objetivo dos roteiros é:
1. Chamar a atenção do público comprador correto;
2. Gerar desejo pelo veículo;
3. Mostrar por que aquele veículo faz sentido para aquele perfil;
4. Qualificar o lead;
5. Gerar conversas no WhatsApp com maior intenção de compra.

IMPORTANTE:
Não quero roteiros genéricos.
Cada veículo deve ter uma abordagem baseada no perfil de quem normalmente compra aquele modelo, faixa de preço, ano, motorização, quilometragem e principais diferenciais.

==================================================
ESTRUTURA DOS ROTEIROS
==================================================

Crie cada roteiro utilizando esta estrutura:

### GANCHO – PRIMEIROS SEGUNDOS

Essa é a parte mais importante.

O gancho deve falar diretamente com o provável comprador daquele veículo.

Exemplos de abordagens:

- Faixa de preço:
"Você que procura um SUV automático e quer gastar menos de R$ 100 mil..."

- Categoria:
"Você que precisa de uma picape diesel 4x4 para trabalhar, mas também quer conforto para viajar..."

- Baixa quilometragem:
"Antes de comprar um zero-quilômetro, olha esse 2025 com apenas 17 mil km..."

- Upgrade:
"Quer sair do carro manual e subir para um automático turbo sem gastar mais de R$ 100 mil?"

- Família:
"Você que precisa de espaço para a família, mas não abre mão de conforto e segurança..."

- Trabalho:
"Se você precisa de uma picape durante a semana, mas ela também é o carro da família no fim de semana..."

- Premium:
"Você que quer entrar no segmento premium sem precisar gastar R$ 180 ou R$ 200 mil..."

- Oferta:
"Se você já estava procurando uma SW4, presta atenção: essa condição representa R$ 22 mil de diferença no preço."

O gancho NÃO deve ser apenas:
"Alô [cidade], olha esse carro."

Ele precisa criar identificação imediata.

Sempre que possível, combine:
PÚBLICO + NECESSIDADE + DIFERENCIAL/OFERTA.

==================================================
QUALIFICAÇÃO
==================================================

Quando houver possibilidade de financiamento, utilize algo natural como:

"E você que tem uma entrada, nome limpo e bom relacionamento com o banco, chama nossa equipe e faça uma simulação."

Não prometa aprovação.

Se a loja informar que exige CNH, entrada mínima ou alguma condição específica, coloque isso logo no começo do roteiro para evitar leads desqualificados.

Nunca diga que financia 100% se essa informação não tiver sido fornecida.

==================================================
APRESENTAÇÃO
==================================================

Apresente:

- Marca
- Modelo
- Versão
- Ano
- Motorização
- Câmbio
- Quilometragem
- Preço

Mas faça isso de maneira falada e natural.

Exemplo:

"Toyota Corolla Cross XRE 2.0 automático 2023, com 76 mil quilômetros, por R$ 135.900."

==================================================
DESTAQUES / PERCEPÇÃO DE VALOR
==================================================

Não fique simplesmente lendo uma ficha técnica.

Selecione os diferenciais que realmente ajudam a vender o veículo.

Explique o benefício.

Exemplo ruim:
"Câmbio automático, direção elétrica, multimídia, câmera de ré."

Exemplo melhor:
"Você tem o conforto do câmbio automático para o dia a dia, câmera de ré para facilitar as manobras e um conjunto pensado para quem quer conforto tanto na cidade quanto na estrada."

Quando fizer sentido, trabalhe:

- economia;
- confiabilidade;
- conforto;
- espaço;
- desempenho;
- robustez;
- segurança;
- tecnologia;
- baixa quilometragem;
- procedência;
- histórico de revisões;
- valor de revenda;
- custo-benefício;
- comparação com um zero-quilômetro.

NÃO invente equipamentos ou características que não foram informados.

==================================================
PÚBLICO COMPRADOR
==================================================

Explique explicitamente para quem aquele carro faz sentido.

Exemplos:

"É uma ótima opção para quem está comprando o primeiro carro."

"É para quem quer sair de um hatch ou sedã e subir para um SUV."

"É para empresário, produtor ou prestador de serviço que precisa de uma picape para trabalhar, mas também usa o carro com a família."

"É para quem já está pesquisando sedãs premium e quer subir de categoria."

"É uma excelente opção para quem pega estrada e precisa de espaço para a família."

Isso é muito importante porque faz o potencial comprador se identificar com o anúncio.

==================================================
QUILOMETRAGEM
==================================================

Se a quilometragem for MUITO BAIXA, use isso como argumento forte e, se possível, no gancho.

Exemplo:
"2026 com apenas 5.900 km."

Se a quilometragem for alta, não tente esconder.

Se houver informações de procedência, revisões ou conservação, use isso para reduzir a objeção.

Exemplo:
"111 mil km assustam você? Então olha o detalhe que muda a análise desse carro: todas as revisões foram feitas na autorizada."

==================================================
PREÇO E OFERTAS
==================================================

Se houver preço promocional, destaque isso imediatamente.

Exemplo:

"De R$ 105.900 por R$ 99.900."

Se existir diferença entre preço à vista/financiado e preço com veículo na troca, deixe isso MUITO claro.

Exemplo:

"A condição de R$ 99.900 vale para compra à vista ou financiada. Com veículo na troca, o valor permanece R$ 105.900."

Nunca esconda essa condição.

==================================================
CTA
==================================================

Finalize direcionando para o WhatsApp.

Exemplo:

"Se você é de Uberaba e região e procura um SUV nessa faixa de preço, chama agora no WhatsApp, faça sua simulação e venha conhecer esse carro."

Também podem ser utilizados:

"Chama agora nossa equipe e consulte as condições."

"Faça sua simulação com nossa equipe."

"Venha conhecer esse carro pessoalmente."

"Se esse carro encaixa no que você procura, chama agora no WhatsApp."

Evite CTAs exageradamente genéricos.

==================================================
QUANDO EU PEDIR 2 ROTEIROS
==================================================

Não faça dois roteiros praticamente iguais.

Crie DOIS ÂNGULOS DE VENDA diferentes.

Exemplo:

ROTEIRO 1:
Foco em preço/faixa de orçamento.

ROTEIRO 2:
Foco no perfil comprador/necessidade.

Outros ângulos possíveis:

- preço;
- baixa quilometragem;
- comparação com zero km;
- economia;
- família;
- trabalho;
- desempenho;
- confiabilidade;
- status/premium;
- upgrade de categoria;
- oportunidade;
- procedência;
- custo-benefício.

Cada roteiro deve ter um GANCHO realmente diferente.

==================================================
TOM DE VOZ
==================================================

Escreva em português brasileiro.

O texto deve parecer um vendedor falando para a câmera.

Quero:
- linguagem simples;
- comercial;
- persuasiva;
- natural;
- frases fáceis de falar;
- sem linguagem excessivamente formal;
- sem exageros;
- sem parecer texto escrito por IA.

Evite frases clichês demais como:
"Essa máquina incrível está esperando por você!"

Prefira argumentos concretos.

==================================================
DURAÇÃO
==================================================

Os roteiros devem ter aproximadamente 45 a 70 segundos.

Não precisa falar todos os opcionais do carro.

Priorize as informações que aumentam a intenção de compra.

==================================================
LOCALIZAÇÃO
==================================================

Sempre adapte o roteiro para a cidade/região que eu informar.

Exemplo:
"Você de Porto Velho e região..."
"Você de Uberaba e região..."
"Você de Gurupi e região..."

Mas varie os ganchos para não começar todos exatamente da mesma maneira.

==================================================
FORMATO DE ENTREGA
==================================================

Para cada veículo, entregue:

VEÍCULO

ROTEIRO 1 – [nome do ângulo]

GANCHO – PRIMEIROS SEGUNDOS
[texto]

QUALIFICAÇÃO
[texto]

APRESENTAÇÃO
[texto]

DESTAQUES / PERCEPÇÃO
[texto]

PÚBLICO COMPRADOR
[texto]

CTA
[texto]


ROTEIRO 2 – [outro ângulo]

GANCHO – PRIMEIROS SEGUNDOS
[texto]

QUALIFICAÇÃO
[texto]

APRESENTAÇÃO
[texto]

DESTAQUES / PERCEPÇÃO
[texto]

PÚBLICO COMPRADOR
[texto]

CTA
[texto]

==================================================
REGRA PRINCIPAL
==================================================

Antes de escrever cada roteiro, pense:

"Quem provavelmente compra esse carro e qual argumento faria essa pessoa parar o vídeo nos primeiros 3 segundos?"

O GANCHO deve ser construído a partir dessa resposta.

Não crie simplesmente um anúncio sobre o carro.
Crie um anúncio para A PESSOA que provavelmente compraria aquele carro.

Agora aguarde eu enviar:
- veículo;
- versão;
- ano;
- km;
- preço;
- opcionais/diferenciais;
- cidade/região;
- condições comerciais.`;

async function buildSystemPrompt(mode: AgentMode = "trafego"): Promise<string> {
  if (mode === "copy_automotivo") return COPY_AUTOMOTIVO_PROMPT;
  if (mode === "roteiro_automotivo") return ROTEIRO_AUTOMOTIVO_PROMPT;
  let clientSummary = "";
  try {
    const clients = await fetchClients();
    clientSummary = clients
      .map((c) => {
        const cplStatus = c.cplToday !== null
          ? `CPL hoje: R$${c.cplToday.toFixed(2)} (meta: até R$${c.cpl_max})`
          : "Sem dados hoje";
        return `- ${c.name}: ${cplStatus}, gasto: R$${c.spendToday.toFixed(0)}, leads: ${c.leadsToday}`;
      })
      .join("\n");

    const alerts = clients.filter((c) => c.status === "critical" || c.status === "attention");
    if (alerts.length > 0) {
      clientSummary += `\n\n⚠️ ALERTAS:\n${alerts.map((c) => `- ${c.name} está com CPL ${c.status === "critical" ? "CRÍTICO" : "em atenção"}`).join("\n")}`;
    }
  } catch {
    clientSummary = "Não foi possível carregar dados dos clientes.";
  }

  return `Você é o assistente de gestão de tráfego pago da Triad Company. Seu papel é analisar campanhas Meta Ads, identificar oportunidades de otimização e executar ações quando solicitado pelo usuário.

Diretrizes:
- Seja direto e objetivo. Use dados concretos (CPL, orçamento, leads, variações percentuais).
- Quando sugerir uma ação, explique o raciocínio brevemente.
- Todas as ações de escrita requerem confirmação explícita do usuário — nunca execute sem confirmar.
- Responda sempre em português brasileiro.

Estado atual dos clientes (${new Date().toLocaleDateString("pt-BR")}):
${clientSummary}`;
}

// ── Conversation helpers ──────────────────────────────────────────────────────

async function ensureConversation(conversationId: string | null, userId: string | null, mode: AgentMode): Promise<string> {
  if (conversationId) return conversationId;
  const [row] = await db
    .insert(agentConversations)
    .values({ createdBy: userId, mode, lastMsgAt: new Date().toISOString() })
    .returning({ id: agentConversations.id });
  return row.id;
}

async function getConversationMode(conversationId: string): Promise<AgentMode> {
  const rows = await db
    .select({ mode: agentConversations.mode })
    .from(agentConversations)
    .where(eq(agentConversations.id, conversationId))
    .limit(1);
  return (rows[0]?.mode as AgentMode) ?? "trafego";
}

async function loadHistory(conversationId: string): Promise<ChatCompletionMessageParam[]> {
  const rows = await db
    .select({ role: agentMessages.role, content: agentMessages.content })
    .from(agentMessages)
    .where(eq(agentMessages.conversationId, conversationId))
    .orderBy(agentMessages.createdAt)
    .limit(40);
  return rows
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content ?? "" }));
}

async function saveMessages(
  conversationId: string,
  messages: Array<{ role: string; content: string | null }>
): Promise<void> {
  if (messages.length === 0) return;
  await db
    .insert(agentMessages)
    .values(messages.map((m) => ({ conversationId, role: m.role, content: m.content })));
  await db
    .update(agentConversations)
    .set({ lastMsgAt: new Date().toISOString() })
    .where(eq(agentConversations.id, conversationId));
}

async function updateConversationTitle(conversationId: string, firstUserMessage: string): Promise<void> {
  const rows = await db
    .select({ title: agentConversations.title })
    .from(agentConversations)
    .where(eq(agentConversations.id, conversationId))
    .limit(1);
  if (rows[0]?.title) return;
  const title = firstUserMessage.slice(0, 60).trim() + (firstUserMessage.length > 60 ? "..." : "");
  await db.update(agentConversations).set({ title }).where(eq(agentConversations.id, conversationId));
}

// ── Server functions ──────────────────────────────────────────────────────────

export const agentSendMessage = createServerFn({ method: "POST" })
  .inputValidator(sendMessageSchema)
  .handler(async ({ data }): Promise<AgentResponse> => {
    const openaiKey = await getOpenAIKey();
    if (!openaiKey) return { type: "error", message: "Chave OpenAI não configurada." };

    const openai = new OpenAI({ apiKey: openaiKey });

    try {
      const userId = await getSessionUserId();
      if (!userId) return { type: "error", message: "Não autenticado." };

      const mode: AgentMode = data.conversation_id
        ? await getConversationMode(data.conversation_id)
        : (data.mode ?? "trafego");
      const convId = await ensureConversation(data.conversation_id, userId, mode);
      const history = await loadHistory(convId);
      const systemPrompt = await buildSystemPrompt(mode);

      const messages: ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: data.message },
      ];

      await saveMessages(convId, [{ role: "user", content: data.message }]);
      await updateConversationTitle(convId, data.message);

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages,
        ...(mode === "trafego" ? { tools: TOOL_DEFINITIONS, tool_choice: "auto" as const } : {}),
        max_tokens: 2048,
      });

      const choice = response.choices[0];
      if (!choice) return { type: "error", message: "Sem resposta da OpenAI." };

      const assistantMsg = choice.message;

      if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
        const content = assistantMsg.content ?? "";
        await saveMessages(convId, [{ role: "assistant", content }]);
        return { type: "message", content, conversation_id: convId };
      }

      const toolCall = assistantMsg.tool_calls[0] as { id: string; type: string; function: { name: string; arguments: string } };
      const toolName = toolCall.function.name;
      const toolArgs = JSON.parse(toolCall.function.arguments) as JsonArgs;

      if (WRITE_TOOLS.has(toolName)) {
        return {
          type: "confirmation_required",
          pending_action: {
            tool: toolName,
            args: toolArgs,
            description: describeAction(toolName, toolArgs),
          },
          partial_response: assistantMsg.content ?? undefined,
          conversation_id: convId,
        };
      }

      const toolResult = await executeTool(toolName, toolArgs);
      const toolResultContent = JSON.stringify(
        toolResult.type === "result" ? toolResult.data : { error: toolResult.message }
      );

      const followUpMessages: ChatCompletionMessageParam[] = [
        ...messages,
        { role: "assistant", content: assistantMsg.content, tool_calls: assistantMsg.tool_calls },
        { role: "tool", tool_call_id: toolCall.id, content: toolResultContent },
      ];

      const followUp = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: followUpMessages,
        max_tokens: 2048,
      });

      const finalContent = followUp.choices[0]?.message.content ?? "";
      await saveMessages(convId, [{ role: "assistant", content: finalContent }]);
      return { type: "message", content: finalContent, conversation_id: convId };

    } catch (err) {
      return { type: "error", message: err instanceof Error ? err.message : "Erro interno." };
    }
  });

export const agentExecuteAction = createServerFn({ method: "POST" })
  .inputValidator(executeActionSchema)
  .handler(async ({ data }): Promise<AgentResponse> => {
    const openaiKey = await getOpenAIKey();
    if (!openaiKey) return { type: "error", message: "Chave OpenAI não configurada." };

    const openai = new OpenAI({ apiKey: openaiKey });

    try {
      const result = await executeConfirmedAction(data.pending_action.tool, data.pending_action.args);
      if (result.type === "error") return { type: "error", message: result.message };

      const resultSummary = result.data && typeof result.data === "object" && result.data !== null
        ? ` Dados retornados: ${JSON.stringify(result.data)}`
        : "";
      const confirmationPrompt = `O usuário confirmou e a seguinte ação foi executada com sucesso: "${data.pending_action.description}".${resultSummary} Informe o usuário de forma direta em português, incluindo quaisquer IDs ou informações relevantes retornadas.`;
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: confirmationPrompt }],
        max_tokens: 256,
      });

      const content = response.choices[0]?.message.content ?? "Ação executada com sucesso.";
      await saveMessages(data.conversation_id, [{ role: "assistant", content }]);
      return { type: "message", content, conversation_id: data.conversation_id };
    } catch (err) {
      return { type: "error", message: err instanceof Error ? err.message : "Erro ao executar ação." };
    }
  });

export const agentListConversations = createServerFn({ method: "GET" }).handler(
  async (): Promise<Array<{ id: string; title: string | null; last_msg_at: string; mode: string }>> => {
    const rows = await db
      .select({
        id: agentConversations.id,
        title: agentConversations.title,
        last_msg_at: agentConversations.lastMsgAt,
        mode: agentConversations.mode,
      })
      .from(agentConversations)
      .orderBy(desc(agentConversations.lastMsgAt))
      .limit(30);
    return rows;
  }
);

export const agentLoadMessages = createServerFn({ method: "GET" })
  .inputValidator(loadMessagesSchema)
  .handler(async ({ data }): Promise<ChatMessage[]> => {
    const rows = await db
      .select({ role: agentMessages.role, content: agentMessages.content })
      .from(agentMessages)
      .where(and(eq(agentMessages.conversationId, data.conversation_id), inArray(agentMessages.role, ["user", "assistant"])))
      .orderBy(agentMessages.createdAt);
    return rows.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content ?? "",
    }));
  });
