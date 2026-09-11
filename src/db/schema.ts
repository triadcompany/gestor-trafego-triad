import { sql } from "drizzle-orm";
import { relations } from "drizzle-orm/relations";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp as pgTimestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// timestamptz que devolve string ISO (não Date) e numeric que devolve number —
// mantém os mesmos tipos que o app já espera vindos do PostgREST/Supabase.
function timestamp(name: string) {
  return pgTimestamp(name, { withTimezone: true, mode: "string" });
}
function numericMoney(name: string, precision: number, scale: number) {
  return numeric(name, { precision, scale, mode: "number" });
}

// Unidade de isolamento multi-tenant — uma agência/empresa que assina o produto.
// Todo dado do sistema pendura, direta ou indiretamente (via clients), numa organização.
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Substitui auth.users do Supabase. Guarda credenciais próprias (bcrypt).
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // Acesso de suporte fora do conceito de organização — lista/entra em qualquer uma.
  // Não faz parte de nenhuma organização por padrão (profiles.organizationId fica nulo).
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  // Desativado = login bloqueado. Usado pelo admin da organização pra remover
  // acesso de um colega sem apagar o histórico (tarefas/campanhas criadas por ele).
  active: boolean("active").notNull().default(true),
});

export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    role: text("role").notNull().default("member"),
    // Nulo só pro platform admin puro (users.isPlatformAdmin), que não pertence a
    // nenhuma organização. Todo outro usuário deve ter isso preenchido (garantido
    // na aplicação, não no banco, pra permitir esse caso especial).
    organizationId: uuid("organization_id").references(() => organizations.id),
  },
  (t) => [check("profiles_role_check", sql`${t.role} IN ('admin', 'member')`)]
);

// Token de acesso à Meta Marketing API. Uma organização pode ter vários (um por
// gestor de tráfego que tenha seu próprio acesso à Business Manager); cada
// cliente aponta pra um específico (clients.metaTokenId).
export const metaTokens = pgTable("meta_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  accessToken: text("access_token").notNull(),
  expiresAt: timestamp("expires_at"),
  assignedUserId: uuid("assigned_user_id").references(() => profiles.id, { onDelete: "set null" }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Instância da Evolution API (um número de WhatsApp conectado). Uma organização
// pode ter várias; cada mensagem agendada e cada cliente monitorado aponta pra uma.
export const whatsappInstances = pgTable("whatsapp_instances", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  evolutionUrl: text("evolution_url").notNull(),
  evolutionKey: text("evolution_key").notNull(),
  instanceName: text("instance_name").notNull(),
  assignedUserId: uuid("assigned_user_id").references(() => profiles.id, { onDelete: "set null" }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  metaAdAccountId: text("meta_ad_account_id").notNull().unique(),
  metaPageId: text("meta_page_id"),
  metaTokenId: uuid("meta_token_id").references(() => metaTokens.id, { onDelete: "set null" }),
  segment: text("segment").notNull().default("popular"),
  cplMin: numericMoney("cpl_min", 10, 2).notNull().default(6),
  cplMax: numericMoney("cpl_max", 10, 2).notNull().default(12),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  metaBalance: integer("meta_balance"),
  paymentMethod: text("payment_method").notNull().default("pix"),
  metaWhatsappNumber: text("meta_whatsapp_number"),
  monthlyBudget: numericMoney("monthly_budget", 10, 2).notNull().default(0),
  pixCycle: text("pix_cycle"),
  pixReferenceDay: integer("pix_reference_day"),
  pixActive: boolean("pix_active").notNull().default(false),
  whatsappGroupId: text("whatsapp_group_id"),
  whatsappGroupName: text("whatsapp_group_name"),
  whatsappInstanceId: uuid("whatsapp_instance_id").references(() => whatsappInstances.id, { onDelete: "set null" }),
  // Gestor responsável — membro (role 'member') só vê clientes de que é dono;
  // admin da organização vê todos. Nulo = "sem responsável" (só admin vê).
  ownerUserId: uuid("owner_user_id").references(() => profiles.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const metricsDaily = pgTable(
  "metrics_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    spend: numericMoney("spend", 10, 2).notNull().default(0),
    leads: integer("leads").notNull().default(0),
    cpl: numericMoney("cpl", 10, 2).generatedAlwaysAs(
      sql`CASE WHEN leads > 0 THEN round(spend / leads::numeric, 2) ELSE NULL END`
    ),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    forms: integer("forms").notNull().default(0),
  },
  (t) => [
    unique("metrics_daily_client_id_date_key").on(t.clientId, t.date),
    index("idx_metrics_daily_client_date").on(t.clientId, t.date.desc()),
  ]
);

export const campaignSnapshots = pgTable(
  "campaign_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull(),
    dailyBudget: numericMoney("daily_budget", 10, 2),
    spend: numericMoney("spend", 10, 2).notNull().default(0),
    leads: integer("leads").notNull().default(0),
    forms: integer("forms").notNull().default(0),
    cpl: numericMoney("cpl", 10, 2),
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    syncedAt: timestamp("synced_at").defaultNow().notNull(),
  },
  (t) => [unique("campaign_snapshots_client_campaign_key").on(t.clientId, t.campaignId)]
);

export const syncLog = pgTable(
  "sync_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    syncedAt: timestamp("synced_at").defaultNow().notNull(),
    status: text("status").notNull(),
    message: text("message"),
  },
  (t) => [index("idx_sync_log_client").on(t.clientId, t.syncedAt.desc())]
);

export const appConfig = pgTable(
  "app_config",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
  },
  (t) => [unique("app_config_organization_id_key_key").on(t.organizationId, t.key)]
);

export const clientNotes = pgTable(
  "client_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("idx_client_notes_client").on(t.clientId, t.createdAt.desc())]
);

export const reportLog = pgTable(
  "report_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    periodType: text("period_type").notNull(),
    periodStart: date("period_start").notNull(),
    status: text("status").notNull().default("pendente"),
    sentAt: timestamp("sent_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("idx_report_log_client").on(t.clientId, t.createdAt.desc()),
    index("idx_report_log_status").on(t.status, t.periodType),
  ]
);

export const sales = pgTable(
  "sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    date: date("date").notNull(),
    value: numericMoney("value", 12, 2),
    obs: text("obs"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("sales_client_id_idx").on(t.clientId), index("sales_date_idx").on(t.date)]
);

export const salesGoals = pgTable(
  "sales_goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    month: text("month").notNull(),
    goal: integer("goal").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [unique("sales_goals_client_id_month_key").on(t.clientId, t.month)]
);

export const tags = pgTable("tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull().default("blue"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const clientTags = pgTable(
  "client_tags",
  {
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.clientId, t.tagId] })]
);

export const conversationTemplates = pgTable("conversation_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  greeting: text("greeting"),
  preMessage: text("pre_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  status: text("status").notNull().default("pendente"),
  dueDate: date("due_date"),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
  assignedTo: uuid("assigned_to").references(() => profiles.id, { onDelete: "set null" }),
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const agentConversations = pgTable("agent_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title"),
  mode: text("mode").notNull().default("trafego"),
  pinned: boolean("pinned").notNull().default(false),
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastMsgAt: timestamp("last_msg_at").defaultNow().notNull(),
});

export const agentMessages = pgTable("agent_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => agentConversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content"),
  toolCalls: jsonb("tool_calls"),
  toolResults: jsonb("tool_results"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const googleCalendarTokens = pgTable("google_calendar_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const n8nJobs = pgTable("n8n_jobs", {
  id: uuid("id").primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  payload: jsonb("payload"),
  campaignId: text("campaign_id"),
  adId: text("ad_id"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const driveUploads = pgTable("drive_uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  fileId: text("file_id"),
  carName: text("car_name"),
  folders: jsonb("folders").notNull(),
  status: text("status").default("aguardando"),
  folderId: text("folder_id"),
  createdAt: timestamp("created_at").defaultNow(),
  pastaClienteId: text("pasta_cliente_id"),
  pastaClienteNome: text("pasta_cliente_nome"),
  messageId: text("message_id"),
  remoteJid: text("remote_jid"),
  mediaUrl: text("media_url"),
  mediaBase64: text("media_base64"),
});

export const scheduledMessages = pgTable("scheduled_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  whatsappInstanceId: uuid("whatsapp_instance_id").references(() => whatsappInstances.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  // Colunas legadas — mensagens criadas antes de suportar múltiplas mídias
  // (scheduled_message_media). Mantidas só pra não quebrar histórico antigo.
  mediaBase64: text("media_base64"),
  mediaMimetype: text("media_mimetype"),
  mediaFilename: text("media_filename"),
  scheduledAt: timestamp("scheduled_at").notNull(),
  status: text("status").notNull().default("pending"), // pending | sent | partial | failed | canceled
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const scheduledMessageMedia = pgTable("scheduled_message_media", {
  id: uuid("id").primaryKey().defaultRandom(),
  messageId: uuid("message_id").notNull().references(() => scheduledMessages.id, { onDelete: "cascade" }),
  base64: text("base64").notNull(),
  mimetype: text("mimetype").notNull(),
  filename: text("filename").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const scheduledMessageRecipients = pgTable("scheduled_message_recipients", {
  id: uuid("id").primaryKey().defaultRandom(),
  messageId: uuid("message_id").notNull().references(() => scheduledMessages.id, { onDelete: "cascade" }),
  remoteJid: text("remote_jid").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("pending"), // pending | sent | failed
  sentAt: timestamp("sent_at"),
  errorMessage: text("error_message"),
});

// Regra de automação: envia conteúdo recorrente no WhatsApp. Não envia nada
// direto — um tick (endpoint /api/automations/tick, chamado por cron do n8n)
// materializa uma linha em scheduled_messages a cada ocorrência que vence.
export const messageAutomations = pgTable("message_automations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  contentType: text("content_type").notNull(), // 'text' | 'report' | 'group_summary'
  body: text("body"), // texto livre — só quando contentType='text'
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
  reportPeriodDays: integer("report_period_days").notNull().default(7), // 7 | 15 | 30
  summaryTurno: text("summary_turno"), // 'manha' | 'tarde' — só p/ group_summary
  summaryClientIds: uuid("summary_client_ids").array().notNull().default([]), // clientes cujos grupos entram no resumo
  recurrenceType: text("recurrence_type").notNull(), // 'weekly' | 'daily' | 'monthly'
  recurrenceDays: integer("recurrence_days").array().notNull().default([]), // weekly: 1..7 (1=segunda); monthly: 1..28
  sendHour: integer("send_hour").notNull(), // 0..23, fuso America/Sao_Paulo
  sendMinute: integer("send_minute").notNull(), // 0..59
  whatsappInstanceId: uuid("whatsapp_instance_id").references(() => whatsappInstances.id, { onDelete: "set null" }),
  lastRunAt: timestamp("last_run_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const messageAutomationDestinations = pgTable("message_automation_destinations", {
  id: uuid("id").primaryKey().defaultRandom(),
  automationId: uuid("automation_id")
    .notNull()
    .references(() => messageAutomations.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // 'client_group' | 'custom'
  remoteJid: text("remote_jid"), // null p/ 'client_group' — resolve em runtime via clients.whatsappGroupId
  name: text("name").notNull(),
});

export const messageAutomationMedia = pgTable("message_automation_media", {
  id: uuid("id").primaryKey().defaultRandom(),
  automationId: uuid("automation_id")
    .notNull()
    .references(() => messageAutomations.id, { onDelete: "cascade" }),
  base64: text("base64").notNull(),
  mimetype: text("mimetype").notNull(),
  filename: text("filename").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

// --- relations (usadas pelos joins via db.query.*) ---

export const organizationsRelations = relations(organizations, ({ many }) => ({
  profiles: many(profiles),
  clients: many(clients),
  metaTokens: many(metaTokens),
  whatsappInstances: many(whatsappInstances),
  tags: many(tags),
  tasks: many(tasks),
  agentConversations: many(agentConversations),
  scheduledMessages: many(scheduledMessages),
  driveUploads: many(driveUploads),
  n8nJobs: many(n8nJobs),
  appConfig: many(appConfig),
}));

export const usersRelations = relations(users, ({ one }) => ({
  profile: one(profiles, { fields: [users.id], references: [profiles.id] }),
}));

export const profilesRelations = relations(profiles, ({ one, many }) => ({
  organization: one(organizations, { fields: [profiles.organizationId], references: [organizations.id] }),
  assignedTasks: many(tasks, { relationName: "assignee" }),
  createdTasks: many(tasks, { relationName: "creator" }),
  agentConversations: many(agentConversations),
}));

export const metaTokensRelations = relations(metaTokens, ({ one, many }) => ({
  organization: one(organizations, { fields: [metaTokens.organizationId], references: [organizations.id] }),
  assignedUser: one(profiles, { fields: [metaTokens.assignedUserId], references: [profiles.id] }),
  clients: many(clients),
}));

export const whatsappInstancesRelations = relations(whatsappInstances, ({ one, many }) => ({
  organization: one(organizations, { fields: [whatsappInstances.organizationId], references: [organizations.id] }),
  assignedUser: one(profiles, { fields: [whatsappInstances.assignedUserId], references: [profiles.id] }),
  clients: many(clients),
  scheduledMessages: many(scheduledMessages),
}));

export const clientsRelations = relations(clients, ({ one, many }) => ({
  organization: one(organizations, { fields: [clients.organizationId], references: [organizations.id] }),
  metaToken: one(metaTokens, { fields: [clients.metaTokenId], references: [metaTokens.id] }),
  whatsappInstance: one(whatsappInstances, { fields: [clients.whatsappInstanceId], references: [whatsappInstances.id] }),
  owner: one(profiles, { fields: [clients.ownerUserId], references: [profiles.id] }),
  notes: many(clientNotes),
  metrics: many(metricsDaily),
  campaignSnapshots: many(campaignSnapshots),
  syncLogs: many(syncLog),
  reports: many(reportLog),
  sales: many(sales),
  salesGoals: many(salesGoals),
  tasks: many(tasks),
  clientTags: many(clientTags),
  conversationTemplates: many(conversationTemplates),
}));

export const metricsDailyRelations = relations(metricsDaily, ({ one }) => ({
  client: one(clients, { fields: [metricsDaily.clientId], references: [clients.id] }),
}));

export const campaignSnapshotsRelations = relations(campaignSnapshots, ({ one }) => ({
  client: one(clients, { fields: [campaignSnapshots.clientId], references: [clients.id] }),
}));

export const syncLogRelations = relations(syncLog, ({ one }) => ({
  client: one(clients, { fields: [syncLog.clientId], references: [clients.id] }),
}));

export const appConfigRelations = relations(appConfig, ({ one }) => ({
  organization: one(organizations, { fields: [appConfig.organizationId], references: [organizations.id] }),
}));

export const conversationTemplatesRelations = relations(conversationTemplates, ({ one }) => ({
  client: one(clients, { fields: [conversationTemplates.clientId], references: [clients.id] }),
}));

export const clientNotesRelations = relations(clientNotes, ({ one }) => ({
  client: one(clients, { fields: [clientNotes.clientId], references: [clients.id] }),
}));

export const reportLogRelations = relations(reportLog, ({ one }) => ({
  client: one(clients, { fields: [reportLog.clientId], references: [clients.id] }),
}));

export const salesRelations = relations(sales, ({ one }) => ({
  client: one(clients, { fields: [sales.clientId], references: [clients.id] }),
}));

export const salesGoalsRelations = relations(salesGoals, ({ one }) => ({
  client: one(clients, { fields: [salesGoals.clientId], references: [clients.id] }),
}));

export const tagsRelations = relations(tags, ({ one, many }) => ({
  organization: one(organizations, { fields: [tags.organizationId], references: [organizations.id] }),
  clientTags: many(clientTags),
}));

export const clientTagsRelations = relations(clientTags, ({ one }) => ({
  client: one(clients, { fields: [clientTags.clientId], references: [clients.id] }),
  tag: one(tags, { fields: [clientTags.tagId], references: [tags.id] }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  organization: one(organizations, { fields: [tasks.organizationId], references: [organizations.id] }),
  client: one(clients, { fields: [tasks.clientId], references: [clients.id] }),
  assignee: one(profiles, {
    fields: [tasks.assignedTo],
    references: [profiles.id],
    relationName: "assignee",
  }),
  creator: one(profiles, {
    fields: [tasks.createdBy],
    references: [profiles.id],
    relationName: "creator",
  }),
}));

export const agentConversationsRelations = relations(agentConversations, ({ one, many }) => ({
  organization: one(organizations, { fields: [agentConversations.organizationId], references: [organizations.id] }),
  creator: one(profiles, { fields: [agentConversations.createdBy], references: [profiles.id] }),
  messages: many(agentMessages),
}));

export const agentMessagesRelations = relations(agentMessages, ({ one }) => ({
  conversation: one(agentConversations, {
    fields: [agentMessages.conversationId],
    references: [agentConversations.id],
  }),
}));

export const googleCalendarTokensRelations = relations(googleCalendarTokens, ({ one }) => ({
  user: one(users, { fields: [googleCalendarTokens.userId], references: [users.id] }),
}));

export const n8nJobsRelations = relations(n8nJobs, ({ one }) => ({
  organization: one(organizations, { fields: [n8nJobs.organizationId], references: [organizations.id] }),
}));

export const driveUploadsRelations = relations(driveUploads, ({ one }) => ({
  organization: one(organizations, { fields: [driveUploads.organizationId], references: [organizations.id] }),
}));

export const scheduledMessagesRelations = relations(scheduledMessages, ({ one, many }) => ({
  organization: one(organizations, { fields: [scheduledMessages.organizationId], references: [organizations.id] }),
  whatsappInstance: one(whatsappInstances, {
    fields: [scheduledMessages.whatsappInstanceId],
    references: [whatsappInstances.id],
  }),
  recipients: many(scheduledMessageRecipients),
}));

export const scheduledMessageRecipientsRelations = relations(scheduledMessageRecipients, ({ one }) => ({
  message: one(scheduledMessages, { fields: [scheduledMessageRecipients.messageId], references: [scheduledMessages.id] }),
}));

export const messageAutomationsRelations = relations(messageAutomations, ({ one, many }) => ({
  organization: one(organizations, { fields: [messageAutomations.organizationId], references: [organizations.id] }),
  client: one(clients, { fields: [messageAutomations.clientId], references: [clients.id] }),
  whatsappInstance: one(whatsappInstances, {
    fields: [messageAutomations.whatsappInstanceId],
    references: [whatsappInstances.id],
  }),
  destinations: many(messageAutomationDestinations),
  media: many(messageAutomationMedia),
}));

export const messageAutomationDestinationsRelations = relations(messageAutomationDestinations, ({ one }) => ({
  automation: one(messageAutomations, {
    fields: [messageAutomationDestinations.automationId],
    references: [messageAutomations.id],
  }),
}));

export const messageAutomationMediaRelations = relations(messageAutomationMedia, ({ one }) => ({
  automation: one(messageAutomations, {
    fields: [messageAutomationMedia.automationId],
    references: [messageAutomations.id],
  }),
}));
