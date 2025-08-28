CREATE TABLE "settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb,
	"is_encrypted" boolean DEFAULT false,
	"description" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "unique_category_key" UNIQUE("category","key")
);
--> statement-breakpoint
CREATE INDEX "idx_settings_category_key" ON "settings" USING btree ("category","key");