CREATE TABLE "scheduled_message_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"remote_jid" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "scheduled_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"body" text NOT NULL,
	"media_base64" text,
	"media_mimetype" text,
	"media_filename" text,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduled_message_recipients" ADD CONSTRAINT "scheduled_message_recipients_message_id_scheduled_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."scheduled_messages"("id") ON DELETE cascade ON UPDATE no action;