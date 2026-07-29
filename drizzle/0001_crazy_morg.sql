CREATE TABLE "campaign_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"campaign_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"daily_budget" numeric(10, 2),
	"spend" numeric(10, 2) DEFAULT 0 NOT NULL,
	"leads" integer DEFAULT 0 NOT NULL,
	"forms" integer DEFAULT 0 NOT NULL,
	"cpl" numeric(10, 2),
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_snapshots_client_campaign_key" UNIQUE("client_id","campaign_id")
);
--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "cpl_min" SET DEFAULT 6;--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "cpl_max" SET DEFAULT 12;--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "monthly_budget" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "metrics_daily" ALTER COLUMN "spend" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "campaign_snapshots" ADD CONSTRAINT "campaign_snapshots_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;