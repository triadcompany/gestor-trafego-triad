ALTER TABLE "message_automations" ADD COLUMN "send_hour_2" integer;--> statement-breakpoint
ALTER TABLE "message_automations" ADD COLUMN "send_minute_2" integer;--> statement-breakpoint
ALTER TABLE "message_automations" ADD COLUMN "last_run_at_2" timestamp with time zone;