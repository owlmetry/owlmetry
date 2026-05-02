CREATE TABLE "ad_adgroup_lifetime" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"app_id" uuid NOT NULL,
	"network" varchar(32) NOT NULL,
	"campaign_id" varchar(64) NOT NULL,
	"ad_group_id" varchar(64) NOT NULL,
	"ad_group_name" varchar(500),
	"ad_group_status" varchar(32),
	"ad_group_start_date" date,
	"ad_group_end_date" date,
	"total_spend_usd_cents" bigint,
	"spend_currency" varchar(8),
	"spend_local_micros" bigint,
	"total_impressions" bigint DEFAULT 0 NOT NULL,
	"total_taps" bigint DEFAULT 0 NOT NULL,
	"total_installs" bigint DEFAULT 0 NOT NULL,
	"last_synced_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_campaign_lifetime" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"app_id" uuid NOT NULL,
	"apple_app_store_id" bigint NOT NULL,
	"network" varchar(32) NOT NULL,
	"campaign_id" varchar(64) NOT NULL,
	"campaign_name" varchar(500),
	"campaign_status" varchar(32),
	"campaign_start_date" date,
	"campaign_end_date" date,
	"total_spend_usd_cents" bigint,
	"spend_currency" varchar(8),
	"spend_local_micros" bigint,
	"total_impressions" bigint DEFAULT 0 NOT NULL,
	"total_taps" bigint DEFAULT 0 NOT NULL,
	"total_installs" bigint DEFAULT 0 NOT NULL,
	"last_synced_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_adgroup_lifetime" ADD CONSTRAINT "ad_adgroup_lifetime_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_adgroup_lifetime" ADD CONSTRAINT "ad_adgroup_lifetime_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_adgroup_lifetime" ADD CONSTRAINT "ad_adgroup_lifetime_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_campaign_lifetime" ADD CONSTRAINT "ad_campaign_lifetime_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_campaign_lifetime" ADD CONSTRAINT "ad_campaign_lifetime_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_campaign_lifetime" ADD CONSTRAINT "ad_campaign_lifetime_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ad_adgroup_lifetime_project_network_adgroup_idx" ON "ad_adgroup_lifetime" USING btree ("project_id","network","ad_group_id");--> statement-breakpoint
CREATE INDEX "ad_adgroup_lifetime_project_network_campaign_idx" ON "ad_adgroup_lifetime" USING btree ("project_id","network","campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_campaign_lifetime_project_network_campaign_idx" ON "ad_campaign_lifetime" USING btree ("project_id","network","campaign_id");--> statement-breakpoint
CREATE INDEX "ad_campaign_lifetime_project_app_network_idx" ON "ad_campaign_lifetime" USING btree ("project_id","app_id","network");--> statement-breakpoint
CREATE INDEX "ad_campaign_lifetime_team_network_idx" ON "ad_campaign_lifetime" USING btree ("team_id","network");