CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"key" text NOT NULL,
	"key_type" "api_key_type" DEFAULT 'google-v2' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "tag" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "api_key_id" integer;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" DROP COLUMN "api_key";--> statement-breakpoint
ALTER TABLE "devices" DROP COLUMN "api_key_type";