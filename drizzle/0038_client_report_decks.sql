CREATE TABLE "client_report_decks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"cover_logo_base64" text,
	"cover_logo_mimetype" text,
	"meta_custo_venda" text,
	"meta_faturamento" text,
	"meta_vendas" text,
	"meta_roi" text,
	"meta_seguidores" text,
	"diagnostico_items" text[] DEFAULT '{}' NOT NULL,
	"creatives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"funil_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"plano_acao_items" text[] DEFAULT '{}' NOT NULL,
	"consideracoes_items" text[] DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "client_report_decks_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
ALTER TABLE "client_report_decks" ADD CONSTRAINT "client_report_decks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_report_decks" ADD CONSTRAINT "client_report_decks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;