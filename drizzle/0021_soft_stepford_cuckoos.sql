ALTER TABLE "clients" ADD COLUMN "public_tracking_token" text;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_public_tracking_token_unique" UNIQUE("public_tracking_token");