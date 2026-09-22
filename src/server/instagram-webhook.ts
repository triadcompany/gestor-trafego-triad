import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { instagramConnections, instagramFunnelLeads, instagramFunnelRules } from "@/db/schema";

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

interface InstagramWebhookEntry {
  id?: string; // instagram business account id que recebeu o evento
  changes?: Array<{ field?: string; value?: CommentChangeValue }>;
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

  return !!inserted;
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
