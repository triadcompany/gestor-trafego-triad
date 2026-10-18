ALTER TABLE "sales" DROP CONSTRAINT "sales_client_id_clients_id_fk";
--> statement-breakpoint
ALTER TABLE "sales_goals" DROP CONSTRAINT "sales_goals_client_id_clients_id_fk";
--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_goals" ADD CONSTRAINT "sales_goals_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;