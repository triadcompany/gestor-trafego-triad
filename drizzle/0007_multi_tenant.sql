-- Multi-tenant: organizations, meta_tokens, whatsapp_instances, e organization_id
-- nas tabelas de topo. Migra os dados atuais para a organização "Triad Company"
-- sem perda. Ver docs/superpowers/specs/2026-09-08-multi-tenant-design.md.
--
-- Gerado por `drizzle-kit generate` e depois ajustado à mão para: (a) trocar os
-- `ADD COLUMN ... NOT NULL` sem default (que quebrariam em tabelas não-vazias) por
-- `DEFAULT '<uuid da Triad>'` + `DROP DEFAULT` logo em seguida — backfilla as linhas
-- existentes e não deixa default nenhum pra frente, forçando organizationId
-- explícito em todo INSERT novo; (b) inserir a organização "Triad Company" e migrar
-- a config global atual (meta_access_token, evolution_*) pra meta_tokens/whatsapp_instances.
BEGIN;

CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "organizations" ("id", "name") VALUES
	('c8f7908d-df29-49a4-993b-10b2dbca8a67', 'Triad Company');
--> statement-breakpoint
CREATE TABLE "meta_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"label" text NOT NULL,
	"access_token" text NOT NULL,
	"expires_at" timestamp with time zone,
	"assigned_user_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"label" text NOT NULL,
	"evolution_url" text NOT NULL,
	"evolution_key" text NOT NULL,
	"instance_name" text NOT NULL,
	"assigned_user_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_config" DROP CONSTRAINT "app_config_key_unique";
--> statement-breakpoint
ALTER TABLE "agent_conversations" ADD COLUMN "organization_id" uuid DEFAULT 'c8f7908d-df29-49a4-993b-10b2dbca8a67' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_conversations" ALTER COLUMN "organization_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "app_config" ADD COLUMN "organization_id" uuid DEFAULT 'c8f7908d-df29-49a4-993b-10b2dbca8a67' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_config" ALTER COLUMN "organization_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "organization_id" uuid DEFAULT 'c8f7908d-df29-49a4-993b-10b2dbca8a67' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "organization_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "meta_token_id" uuid;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "whatsapp_instance_id" uuid;--> statement-breakpoint
-- drive_uploads é escrito diretamente por um workflow externo do n8n (upload de
-- fotos de carro), que essa etapa não atualiza — por isso, ao contrário das
-- outras tabelas, o default NÃO é removido: fica valendo Triad Company até o
-- workflow do n8n ser ajustado pra mandar o organization_id certo.
ALTER TABLE "drive_uploads" ADD COLUMN "organization_id" uuid DEFAULT 'c8f7908d-df29-49a4-993b-10b2dbca8a67' NOT NULL;--> statement-breakpoint
ALTER TABLE "n8n_jobs" ADD COLUMN "organization_id" uuid DEFAULT 'c8f7908d-df29-49a4-993b-10b2dbca8a67' NOT NULL;--> statement-breakpoint
ALTER TABLE "n8n_jobs" ALTER COLUMN "organization_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
UPDATE "profiles" SET "organization_id" = 'c8f7908d-df29-49a4-993b-10b2dbca8a67', "role" = 'admin';--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD COLUMN "organization_id" uuid DEFAULT 'c8f7908d-df29-49a4-993b-10b2dbca8a67' NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ALTER COLUMN "organization_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD COLUMN "whatsapp_instance_id" uuid;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "organization_id" uuid DEFAULT 'c8f7908d-df29-49a4-993b-10b2dbca8a67' NOT NULL;--> statement-breakpoint
ALTER TABLE "tags" ALTER COLUMN "organization_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "organization_id" uuid DEFAULT 'c8f7908d-df29-49a4-993b-10b2dbca8a67' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "organization_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_platform_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "meta_tokens" ADD CONSTRAINT "meta_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_tokens" ADD CONSTRAINT "meta_tokens_assigned_user_id_profiles_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_instances" ADD CONSTRAINT "whatsapp_instances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_instances" ADD CONSTRAINT "whatsapp_instances_assigned_user_id_profiles_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_config" ADD CONSTRAINT "app_config_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_meta_token_id_meta_tokens_id_fk" FOREIGN KEY ("meta_token_id") REFERENCES "public"."meta_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_whatsapp_instance_id_whatsapp_instances_id_fk" FOREIGN KEY ("whatsapp_instance_id") REFERENCES "public"."whatsapp_instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_uploads" ADD CONSTRAINT "drive_uploads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "n8n_jobs" ADD CONSTRAINT "n8n_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_whatsapp_instance_id_whatsapp_instances_id_fk" FOREIGN KEY ("whatsapp_instance_id") REFERENCES "public"."whatsapp_instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_config" ADD CONSTRAINT "app_config_organization_id_key_key" UNIQUE("organization_id","key");--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_role_check" CHECK ("profiles"."role" IN ('admin', 'member'));
--> statement-breakpoint

-- Converte a config global atual (uma linha por chave, sem dono) na primeira
-- meta_tokens / whatsapp_instances da Triad — só roda se a chave existir.
INSERT INTO "meta_tokens" ("organization_id", "label", "access_token", "expires_at")
SELECT
	'c8f7908d-df29-49a4-993b-10b2dbca8a67',
	'Principal',
	(SELECT "value" FROM "app_config" WHERE "key" = 'meta_access_token' AND "organization_id" = 'c8f7908d-df29-49a4-993b-10b2dbca8a67'),
	(SELECT "value" FROM "app_config" WHERE "key" = 'meta_token_expires_at' AND "organization_id" = 'c8f7908d-df29-49a4-993b-10b2dbca8a67')::timestamptz
WHERE EXISTS (
	SELECT 1 FROM "app_config" WHERE "key" = 'meta_access_token' AND "organization_id" = 'c8f7908d-df29-49a4-993b-10b2dbca8a67'
);
--> statement-breakpoint
INSERT INTO "whatsapp_instances" ("organization_id", "label", "evolution_url", "evolution_key", "instance_name")
SELECT
	'c8f7908d-df29-49a4-993b-10b2dbca8a67',
	'Principal',
	(SELECT "value" FROM "app_config" WHERE "key" = 'evolution_api_url' AND "organization_id" = 'c8f7908d-df29-49a4-993b-10b2dbca8a67'),
	(SELECT "value" FROM "app_config" WHERE "key" = 'evolution_api_key' AND "organization_id" = 'c8f7908d-df29-49a4-993b-10b2dbca8a67'),
	(SELECT "value" FROM "app_config" WHERE "key" = 'evolution_instance' AND "organization_id" = 'c8f7908d-df29-49a4-993b-10b2dbca8a67')
WHERE EXISTS (
	SELECT 1 FROM "app_config" WHERE "key" = 'evolution_api_url' AND "organization_id" = 'c8f7908d-df29-49a4-993b-10b2dbca8a67'
);
--> statement-breakpoint

-- Aponta os clientes/mensagens existentes pro token/instância únicos recém-criados.
UPDATE "clients" SET "meta_token_id" = (
	SELECT "id" FROM "meta_tokens" WHERE "organization_id" = 'c8f7908d-df29-49a4-993b-10b2dbca8a67' LIMIT 1
) WHERE "organization_id" = 'c8f7908d-df29-49a4-993b-10b2dbca8a67';
--> statement-breakpoint
UPDATE "clients" SET "whatsapp_instance_id" = (
	SELECT "id" FROM "whatsapp_instances" WHERE "organization_id" = 'c8f7908d-df29-49a4-993b-10b2dbca8a67' LIMIT 1
) WHERE "organization_id" = 'c8f7908d-df29-49a4-993b-10b2dbca8a67';
--> statement-breakpoint
UPDATE "scheduled_messages" SET "whatsapp_instance_id" = (
	SELECT "id" FROM "whatsapp_instances" WHERE "organization_id" = 'c8f7908d-df29-49a4-993b-10b2dbca8a67' LIMIT 1
) WHERE "organization_id" = 'c8f7908d-df29-49a4-993b-10b2dbca8a67';

COMMIT;
