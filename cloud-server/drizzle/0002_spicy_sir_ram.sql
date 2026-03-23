DROP TABLE "settings_queue" CASCADE;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "pushed_settings" jsonb;