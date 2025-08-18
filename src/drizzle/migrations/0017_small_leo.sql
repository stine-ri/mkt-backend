CREATE TYPE "public"."testimonial_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "testimonials" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"request_id" integer NOT NULL,
	"provider_id" integer,
	"user_name" varchar(255) NOT NULL,
	"user_email" varchar(255),
	"user_role" "role" DEFAULT 'client' NOT NULL,
	"user_avatar_url" varchar(500),
	"rating" integer NOT NULL,
	"review_text" text NOT NULL,
	"service_category" varchar(255),
	"service_name" varchar(255),
	"status" "testimonial_status" DEFAULT 'pending' NOT NULL,
	"is_public" boolean DEFAULT true,
	"moderated_by" integer,
	"moderation_notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_moderated_by_users_user_id_fk" FOREIGN KEY ("moderated_by") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_testimonials_user_id" ON "testimonials" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_testimonials_request_id" ON "testimonials" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "idx_testimonials_status_public" ON "testimonials" USING btree ("status","is_public");--> statement-breakpoint
CREATE INDEX "idx_testimonials_created_at" ON "testimonials" USING btree ("created_at");