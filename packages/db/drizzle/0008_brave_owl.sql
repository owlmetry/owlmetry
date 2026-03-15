DROP TABLE "event_identity_claims";--> statement-breakpoint
CREATE TABLE "app_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"is_anonymous" boolean NOT NULL,
	"claimed_from" jsonb,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_users" ADD CONSTRAINT "app_users_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_users_app_user_idx" ON "app_users" USING btree ("app_id","user_id");--> statement-breakpoint
CREATE INDEX "app_users_app_anonymous_idx" ON "app_users" USING btree ("app_id","is_anonymous");--> statement-breakpoint
CREATE INDEX "app_users_app_last_seen_idx" ON "app_users" USING btree ("app_id","last_seen_at");
