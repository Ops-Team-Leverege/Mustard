CREATE TABLE "categories" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product" text DEFAULT 'PitCrew' NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product" text DEFAULT 'PitCrew' NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"notes" text,
	"company_description" text,
	"number_of_stores" text,
	"stage" text,
	"pilot_start_date" timestamp,
	"service_tags" text[],
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "companies_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product" text DEFAULT 'PitCrew' NOT NULL,
	"company_id" varchar NOT NULL,
	"name" text NOT NULL,
	"name_in_transcript" text,
	"job_title" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "features" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product" text DEFAULT 'PitCrew' NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"value" text,
	"video_link" text,
	"help_guide_link" text,
	"category_id" varchar,
	"release_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_system_companies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pos_system_id" varchar NOT NULL,
	"company_id" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_systems" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product" text DEFAULT 'PitCrew' NOT NULL,
	"name" text NOT NULL,
	"website_link" text,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_insights" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product" text DEFAULT 'PitCrew' NOT NULL,
	"transcript_id" varchar,
	"feature" text NOT NULL,
	"context" text NOT NULL,
	"quote" text NOT NULL,
	"company" text NOT NULL,
	"company_id" varchar,
	"category_id" varchar,
	"jira_ticket_key" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qa_pairs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product" text DEFAULT 'PitCrew' NOT NULL,
	"transcript_id" varchar,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"asker" text NOT NULL,
	"contact_id" varchar,
	"company" text NOT NULL,
	"company_id" varchar,
	"category_id" varchar,
	"is_starred" text DEFAULT 'false' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcripts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product" text DEFAULT 'PitCrew' NOT NULL,
	"name" text,
	"company_name" text NOT NULL,
	"company_id" varchar,
	"content_type" text DEFAULT 'transcript' NOT NULL,
	"transcript" text,
	"supporting_materials" text,
	"leverage_team" text NOT NULL,
	"customer_names" text NOT NULL,
	"company_description" text,
	"number_of_stores" text,
	"contact_job_title" text,
	"main_interest_areas" text,
	"main_meeting_takeaways" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"current_product" text DEFAULT 'PitCrew' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");