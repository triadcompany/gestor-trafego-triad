ALTER TABLE "meta_lead_attributions" ADD COLUMN "sale_id" uuid;--> statement-breakpoint
ALTER TABLE "meta_lead_attributions" ADD COLUMN "purchase_event_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meta_lead_attributions" ADD COLUMN "purchase_event_error" text;--> statement-breakpoint
ALTER TABLE "meta_lead_attributions" ADD CONSTRAINT "meta_lead_attributions_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE set null ON UPDATE no action;