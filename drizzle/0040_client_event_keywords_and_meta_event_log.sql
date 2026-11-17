CREATE TABLE "client_event_keywords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"keyword" text NOT NULL,
	"keyword_normalized" text NOT NULL,
	"source" text DEFAULT 'team' NOT NULL,
	"default_value" numeric(12, 2),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_event_keywords_unique" UNIQUE("client_id","event_type","keyword_normalized")
);
--> statement-breakpoint
CREATE TABLE "meta_event_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"trigger" text NOT NULL,
	"keyword" text,
	"message_excerpt" text,
	"dataset_id" text,
	"page_id" text,
	"event_id" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_event_keywords" ADD CONSTRAINT "client_event_keywords_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_event_log" ADD CONSTRAINT "meta_event_log_lead_id_meta_lead_attributions_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."meta_lead_attributions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_client_event_keywords_client" ON "client_event_keywords" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_meta_event_log_lead" ON "meta_event_log" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_meta_event_log_created" ON "meta_event_log" USING btree ("created_at");