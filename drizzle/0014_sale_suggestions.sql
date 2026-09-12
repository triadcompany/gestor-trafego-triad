CREATE TABLE "sale_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"message_text" text NOT NULL,
	"message_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sale_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_suggestions_dedupe_key" UNIQUE("client_id","message_at","message_text")
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "last_sale_scan_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sale_suggestions" ADD CONSTRAINT "sale_suggestions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_suggestions" ADD CONSTRAINT "sale_suggestions_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sale_suggestions_client_status" ON "sale_suggestions" USING btree ("client_id","status");