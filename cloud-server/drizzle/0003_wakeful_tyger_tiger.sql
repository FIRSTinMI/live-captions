CREATE TYPE "public"."admin_credential_role" AS ENUM('client', 'admin');--> statement-breakpoint
CREATE TYPE "public"."phrase_set_state" AS ENUM('unknown', 'synced', 'pending', 'drifted', 'missing');--> statement-breakpoint
CREATE TABLE "google_credential_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"role" "admin_credential_role" NOT NULL,
	"project_id" text NOT NULL,
	"scopes" text DEFAULT 'https://www.googleapis.com/auth/cloud-platform' NOT NULL,
	"credentials" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phrase_set_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phrases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phrase_set_deployments" (
	"id" serial PRIMARY KEY NOT NULL,
	"definition_id" integer NOT NULL,
	"admin_credential_profile_id" integer NOT NULL,
	"project_id" text NOT NULL,
	"location" text DEFAULT 'global' NOT NULL,
	"resource_name" text NOT NULL,
	"state" "phrase_set_state" DEFAULT 'unknown' NOT NULL,
	"last_verified_at" timestamp,
	"imported_from" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "phrase_set_deployments" ADD CONSTRAINT "phrase_set_deployments_definition_id_phrase_set_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."phrase_set_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phrase_set_deployments" ADD CONSTRAINT "phrase_set_deployments_admin_credential_profile_id_google_credential_profiles_id_fk" FOREIGN KEY ("admin_credential_profile_id") REFERENCES "public"."google_credential_profiles"("id") ON DELETE restrict ON UPDATE no action;