CREATE TYPE "public"."service_request_status" AS ENUM('pending', 'accepted', 'declined', 'completed');--> statement-breakpoint
CREATE TYPE "public"."service_request_urgency" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TABLE "service_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"provider_id" integer NOT NULL,
	"service_id" integer NOT NULL,
	"request_title" text NOT NULL,
	"description" text,
	"budget_min" numeric(10, 2),
	"budget_max" numeric(10, 2),
	"deadline" timestamp,
	"status" "service_request_status" DEFAULT 'pending' NOT NULL,
	"urgency" "service_request_urgency" DEFAULT 'normal' NOT NULL,
	"location" text,
	"client_notes" text,
	"provider_response" text,
	"chat_room_id" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"responded_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "chat_rooms" ALTER COLUMN "request_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_client_id_users_user_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_chat_room_id_chat_rooms_id_fk" FOREIGN KEY ("chat_room_id") REFERENCES "public"."chat_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_service_requests_client_id" ON "service_requests" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_service_requests_provider_id" ON "service_requests" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "idx_service_requests_status" ON "service_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_service_requests_created_at" ON "service_requests" USING btree ("created_at");