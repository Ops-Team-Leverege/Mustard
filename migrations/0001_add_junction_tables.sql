-- Migration: Add junction tables for multi-company and multi-product support
-- Purpose: Enable many-to-many relationships while maintaining backward compatibility
-- Date: 2026-02-17

-- Junction table for many-to-many relationship between transcripts and companies
-- Enables multi-company meeting support while maintaining backward compatibility
-- with the legacy transcripts.companyId field
CREATE TABLE "transcript_companies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transcript_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "transcript_companies_unique" UNIQUE("transcript_id", "company_id")
);
--> statement-breakpoint

-- Create indexes for efficient querying
CREATE INDEX "transcript_companies_transcript_idx" ON "transcript_companies" USING btree ("transcript_id");
--> statement-breakpoint
CREATE INDEX "transcript_companies_company_idx" ON "transcript_companies" USING btree ("company_id");
--> statement-breakpoint

-- Junction table for many-to-many relationship between companies and products
-- Enables multi-product company support while maintaining backward compatibility
-- with the legacy companies.product field
CREATE TABLE "company_products" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"product" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "company_products_unique" UNIQUE("company_id", "product")
);
--> statement-breakpoint

-- Create indexes for efficient querying
CREATE INDEX "company_products_company_idx" ON "company_products" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "company_products_product_idx" ON "company_products" USING btree ("product");
