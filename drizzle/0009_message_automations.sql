CREATE TABLE "message_automation_destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"remote_jid" text,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_automation_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" uuid NOT NULL,
	"base64" text NOT NULL,
	"mimetype" text NOT NULL,
	"filename" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"content_type" text NOT NULL,
	"body" text,
	"client_id" uuid,
	"report_period_days" integer DEFAULT 7 NOT NULL,
	"recurrence_type" text NOT NULL,
	"recurrence_days" integer[] DEFAULT '{}' NOT NULL,
	"send_hour" integer NOT NULL,
	"send_minute" integer NOT NULL,
	"whatsapp_instance_id" uuid,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_automation_destinations" ADD CONSTRAINT "message_automation_destinations_automation_id_message_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."message_automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_automation_media" ADD CONSTRAINT "message_automation_media_automation_id_message_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."message_automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_automations" ADD CONSTRAINT "message_automations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_automations" ADD CONSTRAINT "message_automations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_automations" ADD CONSTRAINT "message_automations_whatsapp_instance_id_whatsapp_instances_id_fk" FOREIGN KEY ("whatsapp_instance_id") REFERENCES "public"."whatsapp_instances"("id") ON DELETE set null ON UPDATE no action;