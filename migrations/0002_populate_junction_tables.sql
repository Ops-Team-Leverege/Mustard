-- Migration: Populate junction tables from existing data
-- Purpose: Migrate existing single-company and single-product relationships to junction tables
-- Date: 2026-02-17
-- Note: This migration is idempotent and can be run multiple times safely

-- Populate transcript_companies from existing transcripts.companyId
-- Only insert if companyId is not null and the association doesn't already exist
INSERT INTO "transcript_companies" ("transcript_id", "company_id", "created_at")
SELECT 
	t."id" as "transcript_id",
	t."company_id" as "company_id",
	t."created_at" as "created_at"
FROM "transcripts" t
WHERE t."company_id" IS NOT NULL
ON CONFLICT ("transcript_id", "company_id") DO NOTHING;
--> statement-breakpoint

-- Populate company_products from existing companies.product
-- Only insert if the association doesn't already exist
INSERT INTO "company_products" ("company_id", "product", "created_at")
SELECT 
	c."id" as "company_id",
	c."product" as "product",
	c."created_at" as "created_at"
FROM "companies" c
ON CONFLICT ("company_id", "product") DO NOTHING;
--> statement-breakpoint

-- Log migration progress
-- Note: PostgreSQL doesn't have a built-in logging mechanism in migrations,
-- but we can use RAISE NOTICE for visibility during execution
DO $$
DECLARE
	transcript_count INTEGER;
	company_count INTEGER;
BEGIN
	SELECT COUNT(*) INTO transcript_count FROM "transcript_companies";
	SELECT COUNT(*) INTO company_count FROM "company_products";
	
	RAISE NOTICE 'Migration complete: % transcript-company associations created', transcript_count;
	RAISE NOTICE 'Migration complete: % company-product associations created', company_count;
END $$;
