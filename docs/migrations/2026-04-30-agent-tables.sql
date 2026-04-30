-- ============================================================
-- Migration: agent_conversations + agent_messages
-- Rodar no Supabase Dashboard → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text,
  created_by  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_msg_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content         text,
  tool_calls      jsonb,
  tool_results    jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agent_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_conversations_all" ON agent_conversations
  FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "agent_messages_all" ON agent_messages
  FOR ALL USING (auth.uid() IS NOT NULL);
