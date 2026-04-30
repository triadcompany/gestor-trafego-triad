"use server";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { supabase } from "./supabase";
import { fetchClients } from "./queries";
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

const sendMessageSchema = z.object({
  message: z.string(),
  conversation_id: z.string().nullable(),
  user_id: z.string(),
});

const executeActionSchema = z.object({
  pending_action: pendingActionSchema,
  conversation_id: z.string(),
  user_id: z.string(),
});

const loadMessagesSchema = z.object({
  conversation_id: z.string(),
});

// ── System prompt builder ─────────────────────────────────────────────────────

async function buildSystemPrompt(): Promise<string> {
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

async function ensureConversation(conversationId: string | null, userId: string): Promise<string> {
  if (conversationId) return conversationId;
  const { data, error } = await supabase
    .from("agent_conversations")
    .insert({ created_by: userId, last_msg_at: new Date().toISOString() })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function loadHistory(conversationId: string): Promise<ChatCompletionMessageParam[]> {
  const { data } = await supabase
    .from("agent_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(40);
  return ((data ?? []) as { role: string; content: string | null }[])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content ?? "" }));
}

async function saveMessages(
  conversationId: string,
  messages: Array<{ role: string; content: string | null }>
): Promise<void> {
  if (messages.length === 0) return;
  await supabase.from("agent_messages").insert(
    messages.map((m) => ({ conversation_id: conversationId, role: m.role, content: m.content }))
  );
  await supabase
    .from("agent_conversations")
    .update({ last_msg_at: new Date().toISOString() })
    .eq("id", conversationId);
}

async function updateConversationTitle(conversationId: string, firstUserMessage: string): Promise<void> {
  const { data } = await supabase
    .from("agent_conversations")
    .select("title")
    .eq("id", conversationId)
    .single();
  if (data?.title) return;
  const title = firstUserMessage.slice(0, 60).trim() + (firstUserMessage.length > 60 ? "..." : "");
  await supabase.from("agent_conversations").update({ title }).eq("id", conversationId);
}

// ── Server functions ──────────────────────────────────────────────────────────

export const agentSendMessage = createServerFn({ method: "POST" })
  .inputValidator(sendMessageSchema)
  .handler(async ({ data }): Promise<AgentResponse> => {
    const openaiKey = process.env["OPENAI_API_KEY"];
    if (!openaiKey) return { type: "error", message: "Chave OpenAI não configurada." };

    const openai = new OpenAI({ apiKey: openaiKey });

    try {
      const convId = await ensureConversation(data.conversation_id, data.user_id);
      const history = await loadHistory(convId);
      const systemPrompt = await buildSystemPrompt();

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
        tools: TOOL_DEFINITIONS,
        tool_choice: "auto",
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
    const openaiKey = process.env["OPENAI_API_KEY"];
    if (!openaiKey) return { type: "error", message: "Chave OpenAI não configurada." };

    const openai = new OpenAI({ apiKey: openaiKey });

    try {
      const result = await executeConfirmedAction(data.pending_action.tool, data.pending_action.args);
      if (result.type === "error") return { type: "error", message: result.message };

      const confirmationPrompt = `O usuário confirmou e a seguinte ação foi executada com sucesso: "${data.pending_action.description}". Informe o usuário de forma direta em português.`;
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
  async (): Promise<Array<{ id: string; title: string | null; last_msg_at: string }>> => {
    const { data } = await supabase
      .from("agent_conversations")
      .select("id, title, last_msg_at")
      .order("last_msg_at", { ascending: false })
      .limit(30);
    return (data ?? []) as Array<{ id: string; title: string | null; last_msg_at: string }>;
  }
);

export const agentLoadMessages = createServerFn({ method: "GET" })
  .inputValidator(loadMessagesSchema)
  .handler(async ({ data }): Promise<ChatMessage[]> => {
    const { data: msgs } = await supabase
      .from("agent_messages")
      .select("role, content")
      .eq("conversation_id", data.conversation_id)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: true });
    return ((msgs ?? []) as { role: string; content: string | null }[]).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content ?? "",
    }));
  });
