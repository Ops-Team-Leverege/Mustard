import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const transcripts = pgTable("transcripts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyName: text("company_name").notNull(), // Legacy field, kept for backward compatibility
  companyId: varchar("company_id"), // New normalized field
  transcript: text("transcript").notNull(),
  leverageTeam: text("leverage_team").notNull(),
  customerNames: text("customer_names").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const companies = pgTable("companies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const categories = pgTable("categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const productInsights = pgTable("product_insights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  transcriptId: varchar("transcript_id"),
  feature: text("feature").notNull(),
  context: text("context").notNull(),
  quote: text("quote").notNull(),
  company: text("company").notNull(), // Legacy field, kept for backward compatibility
  companyId: varchar("company_id"), // New normalized field
  categoryId: varchar("category_id"),
});

export const qaPairs = pgTable("qa_pairs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  transcriptId: varchar("transcript_id"),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  asker: text("asker").notNull(),
  company: text("company").notNull(), // Legacy field, kept for backward compatibility
  companyId: varchar("company_id"), // New normalized field
  categoryId: varchar("category_id"),
});

export const insertTranscriptSchema = createInsertSchema(transcripts).omit({
  id: true,
  createdAt: true,
});

export const insertProductInsightSchema = createInsertSchema(productInsights).omit({
  id: true,
});

export const insertQAPairSchema = createInsertSchema(qaPairs).omit({
  id: true,
});

export const insertCategorySchema = createInsertSchema(categories).omit({
  id: true,
  createdAt: true,
});

export const insertCompanySchema = createInsertSchema(companies).omit({
  id: true,
  createdAt: true,
});

export type InsertTranscript = z.infer<typeof insertTranscriptSchema>;
export type Transcript = typeof transcripts.$inferSelect;

export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companies.$inferSelect;

export type InsertProductInsight = z.infer<typeof insertProductInsightSchema>;
export type ProductInsight = typeof productInsights.$inferSelect;

export type InsertQAPair = z.infer<typeof insertQAPairSchema>;
export type QAPair = typeof qaPairs.$inferSelect;

export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type Category = typeof categories.$inferSelect;

// Extended type for UI with category name
export type ProductInsightWithCategory = ProductInsight & {
  categoryName: string | null;
};

export type QAPairWithCategory = QAPair & {
  categoryName: string | null;
};

// Company overview type for dashboard
export type CompanyOverview = {
  company: Company;
  transcriptCount: number;
  insightCount: number;
  qaCount: number;
  insights: ProductInsightWithCategory[];
  qaPairs: QAPairWithCategory[];
};
