CREATE TABLE "scheduled_message_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"base64" text NOT NULL,
	"mimetype" text NOT NULL,
	"filename" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduled_message_media" ADD CONSTRAINT "scheduled_message_media_message_id_scheduled_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."scheduled_messages"("id") ON DELETE cascade ON UPDATE no action;