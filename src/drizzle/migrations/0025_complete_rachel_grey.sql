CREATE TABLE "product_sellers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"first_name" varchar(100),
	"last_name" varchar(100),
	"phone_number" varchar(20),
	"college_id" integer,
	"latitude" numeric(10, 8),
	"longitude" numeric(11, 8),
	"address" text,
	"bio" text,
	"profile_image_url" varchar(500),
	"is_profile_complete" boolean DEFAULT false,
	"rating" numeric(3, 2) DEFAULT '0.00',
	"completed_sales" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "seller_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "image_urls" text[];--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "condition" varchar(50);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "is_active" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "product_sellers" ADD CONSTRAINT "product_sellers_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_sellers" ADD CONSTRAINT "product_sellers_college_id_colleges_id_fk" FOREIGN KEY ("college_id") REFERENCES "public"."colleges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_seller_id_product_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."product_sellers"("id") ON DELETE no action ON UPDATE no action;