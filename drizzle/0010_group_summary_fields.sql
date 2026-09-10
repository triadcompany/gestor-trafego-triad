ALTER TABLE "message_automations" ADD COLUMN "summary_turno" text;--> statement-breakpoint
ALTER TABLE "message_automations" ADD COLUMN "summary_client_ids" uuid[] DEFAULT '{}' NOT NULL;