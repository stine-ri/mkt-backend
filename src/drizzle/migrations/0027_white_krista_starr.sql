CREATE TABLE "request_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" integer NOT NULL,
	"url" varchar(500) NOT NULL,
	"public_id" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "request_images" ADD CONSTRAINT "request_images_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;