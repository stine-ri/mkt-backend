ALTER TABLE "requests" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "archived_by_client" boolean DEFAULT false;