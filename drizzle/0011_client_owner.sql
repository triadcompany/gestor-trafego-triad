ALTER TABLE "clients" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_owner_user_id_profiles_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Backfill: cada cliente vai pro admin mais antigo da própria organização.
UPDATE "clients" c
SET "owner_user_id" = (
  SELECT p."id" FROM "profiles" p
  WHERE p."organization_id" = c."organization_id" AND p."role" = 'admin'
  ORDER BY p."created_at" ASC
  LIMIT 1
)
WHERE c."owner_user_id" IS NULL;
