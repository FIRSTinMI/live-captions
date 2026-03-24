CREATE TABLE "device_group_memberships" (
	"device_id" integer NOT NULL,
	"group_id" integer NOT NULL,
	CONSTRAINT "device_group_memberships_device_id_group_id_pk" PRIMARY KEY("device_id","group_id")
);
--> statement-breakpoint
ALTER TABLE "devices" DROP CONSTRAINT "devices_group_id_device_groups_id_fk";
--> statement-breakpoint
ALTER TABLE "device_group_memberships" ADD CONSTRAINT "device_group_memberships_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_group_memberships" ADD CONSTRAINT "device_group_memberships_group_id_device_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."device_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" DROP COLUMN "group_id";