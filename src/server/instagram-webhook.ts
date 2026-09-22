import OpenAI from "openai";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  appConfig,
  instagramConnections,
  instagramFunnelLeads,
  instagramFunnelRules,
  instagramFunnels,
  instagramFunnelNodes,
  instagramFunnelEdges,
  instagramFunnelSessions,
} from "@/db/schema";

// Recebe os webhooks do Instagram (campo `comments`) — não passa por sessão,
// a conta do Instagram (via `entry[].id`) identifica a organização. Ver spec
// docs/superpowers/specs/2026-09-21-funil-instagram-design.md.
//
// A forma do payload é bem documentada pela Meta (ao contrário da Evolution
// API), mas ainda assim extraída com checagens defensivas — webhook nunca
// deve derrubar por causa de um campo faltando.

// Mesmo host de instagram-funnel.ts — contas conectadas via "Instagram
// Login" usam graph.instagram.com, não graph.facebook.com.
const BASE_URL = "https://graph.instagram.com";

interface CommentChangeValue {
  id?: string; // comment id
  text?: string;
  from?: { id?: string; username?: string };
  media?: { id?: string };
}

interface MessagingEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  message?: { text?: string; is_echo?: boolean };
}

interface InstagramWebhookEntry {
  id?: string; // instagram business account id que recebeu o evento
  changes?: Array<{ field?: string; value?: CommentChangeValue }>;
  messaging?: MessagingEvent[]; // mensagem direta nova (formato separado dos "changes")
}

export interface InstagramWebhookBody {
  object?: string;
  entry?: InstagramWebhookEntry[];
}

export interface WebhookResult {
  handled: boolean;
  reason?: string;
  leadsCreated?: number;
}

export async function handleInstagramWebhook(body: InstagramWebhookBody): Promise<WebhookResult> {
  if (body.object !== "instagram") return { handled: false, reason: "object não é instagram" };

  let leadsCreated = 0;
  for (const entry of body.entry ?? []) {
    const igBusinessAccountId = entry.id;
    if (!igBusinessAccountId) continue;

    for (const change of entry.changes ?? []) {
      if (change.field !== "comments") continue;
      const value = change.value;
      if (!value?.id || !value.text || !value.from?.id || !value.media?.id) continue;
      const created = await processComment(igBusinessAccountId, {
        commentId: value.id,
        text: value.text,
        fromId: value.from.id,
        fromUsername: value.from.username ?? null,
        mediaId: value.media.id,
      });
      if (created) leadsCreated++;
    }

    for (const event of entry.messaging ?? []) {
      const senderId = event.sender?.id;
      const text = event.message?.text;
      // Eco da nossa própria mensagem enviada (sender = a própria conta) —
      // ignora, senão o funil reagiria à mensagem que ele mesmo mandou.
      if (!senderId || !text || event.message?.is_echo || senderId === igBusinessAccountId) continue;
      await processIncomingMessage(igBusinessAccountId, senderId, text);
    }
  }

  return { handled: true, leadsCreated };
}

async function processComment(
  igBusinessAccountId: string,
  comment: { commentId: string; text: string; fromId: string; fromUsername: string | null; mediaId: string }
): Promise<boolean> {
  const connection = await db.query.instagramConnections.findFirst({
    where: eq(instagramConnections.instagramBusinessAccountId, igBusinessAccountId),
  });
  if (!connection?.active) return false;

  const rules = await db.query.instagramFunnelRules.findMany({
    where: eq(instagramFunnelRules.postId, comment.mediaId),
  });
  const textLower = comment.text.toLowerCase();
  const rule = rules.find((r) => r.active && textLower.includes(r.keyword.toLowerCase()));
  if (!rule) return false;

  let status: "sent" | "failed" = "sent";
  let errorMessage: string | null = null;
  try {
    await sendPrivateReply(connection.accessToken, igBusinessAccountId, comment.commentId, rule.message);
  } catch (err) {
    status = "failed";
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  // Resposta pública embaixo do comentário — opcional, best-effort: exige a
  // permissão instagram_business_manage_comments (o DM sozinho não precisa),
  // então uma falha aqui não deve derrubar o registro do lead nem sobrescrever
  // o status/erro do DM, que é a parte principal do funil.
  if (rule.publicReply) {
    try {
      await replyToCommentPublicly(connection.accessToken, comment.commentId, rule.publicReply);
    } catch (err) {
      console.error("[instagram-webhook] falha ao responder comentário publicamente:", err);
    }
  }

  const [inserted] = await db
    .insert(instagramFunnelLeads)
    .values({
      ruleId: rule.id,
      commentId: comment.commentId,
      igUsername: comment.fromUsername,
      igUserId: comment.fromId,
      commentText: comment.text.slice(0, 500),
      status,
      errorMessage,
    })
    .onConflictDoNothing({ target: [instagramFunnelLeads.ruleId, instagramFunnelLeads.commentId] })
    .returning({ id: instagramFunnelLeads.id });

  // Sem inserted = webhook reentregue pro mesmo comentário (já processado
  // antes) — não entra no funil de novo, senão duplicaria as mensagens.
  if (inserted && rule.funnelId) {
    const trigger = await db.query.instagramFunnelNodes.findFirst({
      where: and(eq(instagramFunnelNodes.funnelId, rule.funnelId), eq(instagramFunnelNodes.type, "trigger")),
    });
    if (trigger) {
      const edge = await db.query.instagramFunnelEdges.findFirst({ where: eq(instagramFunnelEdges.sourceNodeId, trigger.id) });
      if (edge) {
        await advanceFunnel(connection.accessToken, igBusinessAccountId, comment.fromId, rule.funnelId, inserted.id, edge.targetNodeId);
      }
    }
  }

  return !!inserted;
}

async function processIncomingMessage(igBusinessAccountId: string, senderId: string, text: string): Promise<void> {
  const connection = await db.query.instagramConnections.findFirst({
    where: eq(instagramConnections.instagramBusinessAccountId, igBusinessAccountId),
  });
  if (!connection?.active) return;

  const session = await db.query.instagramFunnelSessions.findFirst({
    where: and(eq(instagramFunnelSessions.organizationId, connection.organizationId), eq(instagramFunnelSessions.igUserId, senderId)),
  });
  if (!session) return; // mensagem fora de qualquer funil — nada a fazer

  const node = await db.query.instagramFunnelNodes.findFirst({ where: eq(instagramFunnelNodes.id, session.currentNodeId) });
  // Sempre apaga a sessão antes de seguir — se não achar nó/aresta, o funil
  // só termina aqui, não fica uma sessão órfã esperando pra sempre.
  await db.delete(instagramFunnelSessions).where(eq(instagramFunnelSessions.id, session.id));
  if (!node || node.type !== "condition") return;

  const keywords = (node.conditionKeywords as { id: string; keyword: string }[] | null) ?? [];
  const handle = node.conditionUseAi
    ? await classifyReplyWithAI(connection.organizationId, text, keywords)
    : matchByKeyword(text, keywords);

  const edge = await db.query.instagramFunnelEdges.findFirst({
    where: and(eq(instagramFunnelEdges.sourceNodeId, node.id), eq(instagramFunnelEdges.sourceHandle, handle)),
  });
  if (!edge) return; // saída não conectada a nada — funil acaba aqui pra essa pessoa

  await advanceFunnel(connection.accessToken, igBusinessAccountId, senderId, session.funnelId, session.leadId, edge.targetNodeId);
}

function matchByKeyword(text: string, keywords: { id: string; keyword: string }[]): string {
  const textLower = text.toLowerCase();
  const matched = keywords.find((k) => textLower.includes(k.keyword.toLowerCase()));
  return matched?.id ?? "default";
}

// Classifica a resposta usando a chave OpenAI já configurada em
// Configurações → API Key do Agente — entende variações de texto que
// "contém a palavra" não pegaria (ex: "com certeza!" bater com a opção
// "sim"). Cai pro casamento literal se a chave não estiver configurada ou a
// chamada falhar — nunca trava o funil por causa disso.
async function classifyReplyWithAI(organizationId: string, text: string, keywords: { id: string; keyword: string }[]): Promise<string> {
  if (keywords.length === 0) return "default";
  try {
    const row = await db.query.appConfig.findFirst({
      where: and(eq(appConfig.organizationId, organizationId), eq(appConfig.key, "openai_api_key")),
    });
    if (!row?.value) return matchByKeyword(text, keywords);

    const openai = new OpenAI({ apiKey: row.value });
    const optionsList = keywords.map((k, i) => `${i + 1}. ${k.keyword}`).join("\n");
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 5,
      messages: [
        {
          role: "system",
          content: `Você classifica a resposta de um lead num funil de vendas do Instagram. Escolha qual das opções abaixo melhor representa a intenção da mensagem da pessoa, mesmo que as palavras usadas sejam diferentes. Responda só com o número da opção. Se nenhuma se encaixar, responda "0".\n\nOpções:\n${optionsList}`,
        },
        { role: "user", content: text },
      ],
    });
    const answer = response.choices[0]?.message?.content?.trim() ?? "0";
    const idx = parseInt(answer, 10);
    if (Number.isInteger(idx) && idx >= 1 && idx <= keywords.length) return keywords[idx - 1].id;
    return "default";
  } catch (err) {
    console.error("[instagram-webhook] falha ao classificar resposta com IA, usando casamento literal:", err);
    return matchByKeyword(text, keywords);
  }
}

// Segue o grafo a partir de um nó: manda mensagens em sequência sem pausa
// até bater numa Condição, onde grava a sessão e para pra esperar a próxima
// resposta da pessoa.
async function advanceFunnel(
  accessToken: string,
  igBusinessAccountId: string,
  igUserId: string,
  funnelId: string,
  leadId: string,
  nodeId: string
): Promise<void> {
  const node = await db.query.instagramFunnelNodes.findFirst({ where: eq(instagramFunnelNodes.id, nodeId) });
  if (!node) return;

  if (node.type === "message") {
    try {
      if (node.fileBase64) {
        // Anexo (ex: PDF) — a Meta busca o arquivo por URL pública própria,
        // não aceita base64 direto na mensagem.
        const appUrl = process.env.APP_URL;
        if (!appUrl) throw new Error("APP_URL não configurada — necessária pra anexo de arquivo.");
        await sendFileMessage(accessToken, igBusinessAccountId, igUserId, `${appUrl.replace(/\/+$/, "")}/api/instagram-files/${node.id}`);
      } else if (node.message) {
        await sendDirectMessage(accessToken, igBusinessAccountId, igUserId, node.message);
      }
    } catch (err) {
      console.error("[instagram-webhook] falha ao enviar mensagem do funil:", err);
      return; // não segue adiante se a mensagem não saiu
    }
    const edge = await db.query.instagramFunnelEdges.findFirst({ where: eq(instagramFunnelEdges.sourceNodeId, node.id) });
    if (edge) await advanceFunnel(accessToken, igBusinessAccountId, igUserId, funnelId, leadId, edge.targetNodeId);
    return;
  }

  if (node.type === "condition") {
    const funnel = await db.query.instagramFunnels.findFirst({ where: eq(instagramFunnels.id, funnelId) });
    if (!funnel) return;
    await db
      .insert(instagramFunnelSessions)
      .values({ organizationId: funnel.organizationId, igUserId, funnelId, currentNodeId: node.id, leadId })
      .onConflictDoUpdate({
        target: [instagramFunnelSessions.organizationId, instagramFunnelSessions.igUserId],
        set: { funnelId, currentNodeId: node.id, leadId, updatedAt: new Date().toISOString() },
      });
  }
}

async function sendPrivateReply(accessToken: string, igBusinessAccountId: string, commentId: string, text: string): Promise<void> {
  const url = `${BASE_URL}/${igBusinessAccountId}/messages?access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text } }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Meta retornou ${res.status}: ${body.slice(0, 300)}`);
  }
}

async function sendDirectMessage(accessToken: string, igBusinessAccountId: string, igUserId: string, text: string): Promise<void> {
  const url = `${BASE_URL}/${igBusinessAccountId}/messages?access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: igUserId }, message: { text } }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Meta retornou ${res.status}: ${body.slice(0, 300)}`);
  }
}

async function sendFileMessage(accessToken: string, igBusinessAccountId: string, igUserId: string, fileUrl: string): Promise<void> {
  const url = `${BASE_URL}/${igBusinessAccountId}/messages?access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: igUserId }, message: { attachment: { type: "file", payload: { url: fileUrl } } } }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Meta retornou ${res.status}: ${body.slice(0, 300)}`);
  }
}

async function replyToCommentPublicly(accessToken: string, commentId: string, message: string): Promise<void> {
  const url = `${BASE_URL}/${commentId}/replies?access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Meta retornou ${res.status}: ${body.slice(0, 300)}`);
  }
}
