CREATE TABLE "event_identity_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"anonymous_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"events_updated" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_identity_claims" ADD CONSTRAINT "event_identity_claims_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_identity_claims_app_anon_idx" ON "event_identity_claims" USING btree ("app_id","anonymous_id");--> statement-breakpoint
CREATE INDEX "event_identity_claims_app_user_idx" ON "event_identity_claims" USING btree ("app_id","user_id");