CREATE TABLE "meta_lead_attributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"remote_jid" text NOT NULL,
	"contact_name" text,
	"ctwa_clid" text NOT NULL,
	"ad_id" text NOT NULL,
	"ad_name" text,
	"adset_id" text,
	"adset_name" text,
	"campaign_id" text,
	"campaign_name" text,
	"first_message_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"qualified_at" timestamp with time zone,
	"label_name" text,
	"conversion_sent_at" timestamp with time zone,
	"conversion_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meta_lead_attributions_dedupe_key" UNIQUE("client_id","remote_jid","first_message_at")
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "qualified_lead_label" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "meta_capi_dataset_id" text;--> statement-breakpoint
ALTER TABLE "meta_lead_attributions" ADD CONSTRAINT "meta_lead_attributions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_meta_lead_attributions_client_status" ON "meta_lead_attributions" USING btree ("client_id","status");