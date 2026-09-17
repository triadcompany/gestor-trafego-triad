ALTER TABLE "whatsapp_instances" ADD COLUMN "connect_token" text;--> statement-breakpoint
ALTER TABLE "whatsapp_instances" ADD COLUMN "connect_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "whatsapp_instances" ADD CONSTRAINT "whatsapp_instances_connect_token_unique" UNIQUE("connect_token");