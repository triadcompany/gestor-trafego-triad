import { sql } from "drizzle-orm";
import { relations } from "drizzle-orm/relations";
import {
  boolean,
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

// Substitui auth.users do Supabase. Guarda credenciais próprias (bcrypt).
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const profiles = pgTable("profiles", {
  id: uuid("id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  fullName: text("full_name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  role: text("role").notNull().default("member"),
});

export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  metaAdAccountId: text("meta_ad_account_id").notNull().unique(),
  metaPageId: text("meta_page_id"),
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

export const appConfig = pgTable("app_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
});

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
  name: text("name").notNull(),
  greeting: text("greeting"),
  preMessage: text("pre_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
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
  title: text("title"),
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

// --- relations (usadas pelos joins via db.query.*) ---

export const usersRelations = relations(users, ({ one }) => ({
  profile: one(profiles, { fields: [users.id], references: [profiles.id] }),
}));

export const profilesRelations = relations(profiles, ({ many }) => ({
  assignedTasks: many(tasks, { relationName: "assignee" }),
  createdTasks: many(tasks, { relationName: "creator" }),
  agentConversations: many(agentConversations),
}));

export const clientsRelations = relations(clients, ({ many }) => ({
  notes: many(clientNotes),
  metrics: many(metricsDaily),
  syncLogs: many(syncLog),
  reports: many(reportLog),
  sales: many(sales),
  salesGoals: many(salesGoals),
  tasks: many(tasks),
  clientTags: many(clientTags),
}));

export const metricsDailyRelations = relations(metricsDaily, ({ one }) => ({
  client: one(clients, { fields: [metricsDaily.clientId], references: [clients.id] }),
}));

export const syncLogRelations = relations(syncLog, ({ one }) => ({
  client: one(clients, { fields: [syncLog.clientId], references: [clients.id] }),
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

export const tagsRelations = relations(tags, ({ many }) => ({
  clientTags: many(clientTags),
}));

export const clientTagsRelations = relations(clientTags, ({ one }) => ({
  client: one(clients, { fields: [clientTags.clientId], references: [clients.id] }),
  tag: one(tags, { fields: [clientTags.tagId], references: [tags.id] }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
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
