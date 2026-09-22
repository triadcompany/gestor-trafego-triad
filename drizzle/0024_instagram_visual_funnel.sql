CREATE TABLE "instagram_funnel_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"funnel_id" uuid NOT NULL,
	"source_node_id" uuid NOT NULL,
	"source_handle" text,
	"target_node_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instagram_funnel_edges_source_key" UNIQUE("source_node_id","source_handle")
);
--> statement-breakpoint
CREATE TABLE "instagram_funnel_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"funnel_id" uuid NOT NULL,
	"type" text NOT NULL,
	"position_x" integer DEFAULT 0 NOT NULL,
	"position_y" integer DEFAULT 0 NOT NULL,
	"message" text,
	"condition_keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instagram_funnel_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"ig_user_id" text NOT NULL,
	"funnel_id" uuid NOT NULL,
	"current_node_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instagram_funnel_sessions_user_key" UNIQUE("organization_id","ig_user_id")
);
--> statement-breakpoint
CREATE TABLE "instagram_funnels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instagram_funnel_rules" ADD COLUMN "funnel_id" uuid;--> statement-breakpoint
ALTER TABLE "instagram_funnel_edges" ADD CONSTRAINT "instagram_funnel_edges_funnel_id_instagram_funnels_id_fk" FOREIGN KEY ("funnel_id") REFERENCES "public"."instagram_funnels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_funnel_edges" ADD CONSTRAINT "instagram_funnel_edges_source_node_id_instagram_funnel_nodes_id_fk" FOREIGN KEY ("source_node_id") REFERENCES "public"."instagram_funnel_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_funnel_edges" ADD CONSTRAINT "instagram_funnel_edges_target_node_id_instagram_funnel_nodes_id_fk" FOREIGN KEY ("target_node_id") REFERENCES "public"."instagram_funnel_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_funnel_nodes" ADD CONSTRAINT "instagram_funnel_nodes_funnel_id_instagram_funnels_id_fk" FOREIGN KEY ("funnel_id") REFERENCES "public"."instagram_funnels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_funnel_sessions" ADD CONSTRAINT "instagram_funnel_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_funnel_sessions" ADD CONSTRAINT "instagram_funnel_sessions_funnel_id_instagram_funnels_id_fk" FOREIGN KEY ("funnel_id") REFERENCES "public"."instagram_funnels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_funnel_sessions" ADD CONSTRAINT "instagram_funnel_sessions_current_node_id_instagram_funnel_nodes_id_fk" FOREIGN KEY ("current_node_id") REFERENCES "public"."instagram_funnel_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_funnel_sessions" ADD CONSTRAINT "instagram_funnel_sessions_lead_id_instagram_funnel_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."instagram_funnel_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_funnels" ADD CONSTRAINT "instagram_funnels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_funnel_rules" ADD CONSTRAINT "instagram_funnel_rules_funnel_id_instagram_funnels_id_fk" FOREIGN KEY ("funnel_id") REFERENCES "public"."instagram_funnels"("id") ON DELETE set null ON UPDATE no action;