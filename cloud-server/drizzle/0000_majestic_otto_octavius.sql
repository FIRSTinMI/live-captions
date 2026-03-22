CREATE TYPE "public"."api_key_type" AS ENUM('google-v1', 'google-v2');--> statement-breakpoint
CREATE TABLE "devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"pin" text NOT NULL,
	"token_hash" text,
	"api_key" text DEFAULT '' NOT NULL,
	"api_key_type" "api_key_type" DEFAULT 'google-v2' NOT NULL,
	"settings" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp,
	"last_heartbeat_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "error_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_id" integer NOT NULL,
	"message" text NOT NULL,
	"context" jsonb,
	"occurred_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_id" integer NOT NULL,
	"settings" jsonb NOT NULL,
	"applied_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_id" integer NOT NULL,
	"minutes_used" numeric(10, 3) NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "error_logs" ADD CONSTRAINT "error_logs_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings_queue" ADD CONSTRAINT "settings_queue_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;