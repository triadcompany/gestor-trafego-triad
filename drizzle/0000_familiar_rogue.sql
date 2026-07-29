CREATE TABLE "agent_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_msg_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text,
	"tool_calls" jsonb,
	"tool_results" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "app_config_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "client_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_tags" (
	"client_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "client_tags_client_id_tag_id_pk" PRIMARY KEY("client_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"meta_ad_account_id" text NOT NULL,
	"meta_page_id" text,
	"segment" text DEFAULT 'popular' NOT NULL,
	"cpl_min" numeric(10, 2) DEFAULT '6' NOT NULL,
	"cpl_max" numeric(10, 2) DEFAULT '12' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"meta_balance" integer,
	"payment_method" text DEFAULT 'pix' NOT NULL,
	"meta_whatsapp_number" text,
	"monthly_budget" numeric(10, 2) DEFAULT '0' NOT NULL,
	"pix_cycle" text,
	"pix_reference_day" integer,
	"pix_active" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "clients_meta_ad_account_id_unique" UNIQUE("meta_ad_account_id")
);
--> statement-breakpoint
CREATE TABLE "conversation_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"greeting" text,
	"pre_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drive_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" text,
	"car_name" text,
	"folders" jsonb NOT NULL,
	"status" text DEFAULT 'aguardando',
	"folder_id" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"pasta_cliente_id" text,
	"pasta_cliente_nome" text,
	"message_id" text,
	"remote_jid" text,
	"media_url" text,
	"media_base64" text
);
--> statement-breakpoint
CREATE TABLE "google_calendar_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "google_calendar_tokens_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "metrics_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"date" date NOT NULL,
	"spend" numeric(10, 2) DEFAULT '0' NOT NULL,
	"leads" integer DEFAULT 0 NOT NULL,
	"cpl" numeric(10, 2) GENERATED ALWAYS AS (CASE WHEN leads > 0 THEN round(spend / leads::numeric, 2) ELSE NULL END) STORED,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"forms" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "metrics_daily_client_id_date_key" UNIQUE("client_id","date")
);
--> statement-breakpoint
CREATE TABLE "n8n_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payload" jsonb,
	"campaign_id" text,
	"ad_id" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" text DEFAULT 'member' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"period_type" text NOT NULL,
	"period_start" date NOT NULL,
	"status" text DEFAULT 'pendente' NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"date" date NOT NULL,
	"value" numeric(12, 2),
	"obs" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"month" text NOT NULL,
	"goal" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_goals_client_id_month_key" UNIQUE("client_id","month")
);
--> statement-breakpoint
CREATE TABLE "sync_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"message" text
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'blue' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'pendente' NOT NULL,
	"due_date" date,
	"client_id" uuid,
	"assigned_to" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_conversation_id_agent_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_notes" ADD CONSTRAINT "client_notes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_tags" ADD CONSTRAINT "client_tags_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_tags" ADD CONSTRAINT "client_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_calendar_tokens" ADD CONSTRAINT "google_calendar_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics_daily" ADD CONSTRAINT "metrics_daily_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_log" ADD CONSTRAINT "report_log_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_goals" ADD CONSTRAINT "sales_goals_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_log" ADD CONSTRAINT "sync_log_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_profiles_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_client_notes_client" ON "client_notes" USING btree ("client_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_metrics_daily_client_date" ON "metrics_daily" USING btree ("client_id","date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_report_log_client" ON "report_log" USING btree ("client_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_report_log_status" ON "report_log" USING btree ("status","period_type");--> statement-breakpoint
CREATE INDEX "sales_client_id_idx" ON "sales" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "sales_date_idx" ON "sales" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_sync_log_client" ON "sync_log" USING btree ("client_id","synced_at" DESC NULLS LAST);--> statement-breakpoint
CREATE FUNCTION update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;--> statement-breakpoint
CREATE TRIGGER clients_updated_at BEFORE UPDATE ON "clients" FOR EACH ROW EXECUTE FUNCTION update_updated_at();