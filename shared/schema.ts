import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Product types
export const PRODUCTS = ["PitCrew", "AutoTrace", "WorkWatch", "ExpressLane"] as const;
export type Product = typeof PRODUCTS[number];

export const transcripts = pgTable("transcripts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  product: text("product").default("PitCrew").notNull(),
  name: text("name"), // Meeting/transcript name - user editable
  companyName: text("company_name").notNull(), // Legacy field, kept for backward compatibility
  companyId: varchar("company_id"), // New normalized field
  contentType: text("content_type").default("transcript").notNull(), // "transcript" or "notes"
  transcript: text("transcript"), // Can be null if contentType is "notes"
  leverageTeam: text("leverage_team").notNull(),
  customerNames: text("customer_names").notNull(),
  companyDescription: text("company_description"),
  numberOfStores: text("number_of_stores"),
  contactJobTitle: text("contact_job_title"),
  mainInterestAreas: text("main_interest_areas"),
  mainMeetingTakeaways: text("main_meeting_takeaways"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const companies = pgTable("companies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  product: text("product").default("PitCrew").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  notes: text("notes"),
  companyDescription: text("company_description"),
  numberOfStores: text("number_of_stores"),
  stage: text("stage"),
  pilotStartDate: timestamp("pilot_start_date"),
  serviceTags: text("service_tags").array(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const contacts = pgTable("contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  product: text("product").default("PitCrew").notNull(),
  companyId: varchar("company_id").notNull(),
  name: text("name").notNull(),
  nameInTranscript: text("name_in_transcript"),
  jobTitle: text("job_title"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const categories = pgTable("categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  product: text("product").default("PitCrew").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const features = pgTable("features", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  product: text("product").default("PitCrew").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  value: text("value"),
  videoLink: text("video_link"),
  helpGuideLink: text("help_guide_link"),
  categoryId: varchar("category_id"),
  releaseDate: timestamp("release_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const productInsights = pgTable("product_insights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  product: text("product").default("PitCrew").notNull(),
  transcriptId: varchar("transcript_id"),
  feature: text("feature").notNull(),
  context: text("context").notNull(),
  quote: text("quote").notNull(),
  company: text("company").notNull(), // Legacy field, kept for backward compatibility
  companyId: varchar("company_id"), // New normalized field
  categoryId: varchar("category_id"),
  jiraTicketKey: varchar("jira_ticket_key"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const qaPairs = pgTable("qa_pairs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  product: text("product").default("PitCrew").notNull(),
  transcriptId: varchar("transcript_id"),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  asker: text("asker").notNull(), // Legacy field, kept for backward compatibility
  contactId: varchar("contact_id"), // New normalized field - links to contacts table
  company: text("company").notNull(), // Legacy field, kept for backward compatibility
  companyId: varchar("company_id"), // New normalized field
  categoryId: varchar("category_id"),
  isStarred: text("is_starred").default("false").notNull(), // Star to mark best-in-class answers
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const posSystems = pgTable("pos_systems", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  product: text("product").default("PitCrew").notNull(),
  name: text("name").notNull(),
  websiteLink: text("website_link"),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const posSystemCompanies = pgTable("pos_system_companies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  posSystemId: varchar("pos_system_id").notNull(),
  companyId: varchar("company_id").notNull(),
});

// From Replit Auth integration (blueprint:javascript_log_in_with_replit)
// Session storage table - mandatory for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table - mandatory for Replit Auth
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  currentProduct: text("current_product").default("PitCrew").notNull(), // Current selected product
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

const customerSchema = z.object({
  name: z.string().min(1, "Customer name is required"),
  jobTitle: z.string().optional(),
});

export const insertTranscriptSchema = createInsertSchema(transcripts).omit({
  id: true,
  customerNames: true,
}).extend({
  product: z.enum(PRODUCTS).default("PitCrew"),
  contentType: z.enum(["transcript", "notes"]).default("transcript"),
  transcript: z.string().optional(),
  mainMeetingTakeaways: z.string().optional(),
  createdAt: z.string().or(z.date()).optional(),
  customerNames: z.string().min(1, "At least one customer is required"),
  customers: z.array(customerSchema).min(1, "At least one customer is required"),
}).refine(
  (data) => {
    // If contentType is "transcript", transcript field must be provided
    if (data.contentType === "transcript") {
      return data.transcript && data.transcript.trim().length > 0;
    }
    // If contentType is "notes", mainMeetingTakeaways field must be provided
    if (data.contentType === "notes") {
      return data.mainMeetingTakeaways && data.mainMeetingTakeaways.trim().length > 0;
    }
    return true;
  },
  {
    message: "Transcript content is required when content type is 'transcript', and meeting notes are required when content type is 'notes'",
    path: ["transcript"],
  }
);

export const insertProductInsightSchema = createInsertSchema(productInsights).omit({
  id: true,
  createdAt: true,
}).extend({
  product: z.enum(PRODUCTS).default("PitCrew"),
});

export const insertQAPairSchema = createInsertSchema(qaPairs).omit({
  id: true,
  createdAt: true,
}).extend({
  product: z.enum(PRODUCTS).default("PitCrew"),
});

export const insertCategorySchema = createInsertSchema(categories).omit({
  id: true,
  createdAt: true,
}).extend({
  product: z.enum(PRODUCTS).default("PitCrew"),
});

export const insertFeatureSchema = createInsertSchema(features).omit({
  id: true,
  createdAt: true,
}).extend({
  product: z.enum(PRODUCTS).default("PitCrew"),
});

export const insertCompanySchema = createInsertSchema(companies).omit({
  id: true,
  createdAt: true,
}).extend({
  product: z.enum(PRODUCTS).default("PitCrew"),
  stage: z.enum(["Prospect", "Pilot", "Rollout", "Scale"]).optional(),
  serviceTags: z.array(z.enum(["tire services", "oil & express services", "commercial truck services", "full services"])).optional(),
});

export const insertContactSchema = createInsertSchema(contacts).omit({
  id: true,
  createdAt: true,
}).extend({
  product: z.enum(PRODUCTS).default("PitCrew"),
});

export const insertPOSSystemSchema = createInsertSchema(posSystems).omit({
  id: true,
  createdAt: true,
}).extend({
  product: z.enum(PRODUCTS).default("PitCrew"),
  companyIds: z.array(z.string()).optional(),
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

export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contacts.$inferSelect;

export type InsertFeature = z.infer<typeof insertFeatureSchema>;
export type Feature = typeof features.$inferSelect;

export type InsertPOSSystem = z.infer<typeof insertPOSSystemSchema>;
export type POSSystem = typeof posSystems.$inferSelect;

export type POSSystemWithCompanies = POSSystem & {
  companies: Company[];
};

// Extended type for UI with category name
export type ProductInsightWithCategory = ProductInsight & {
  categoryName: string | null;
  transcriptDate?: Date | null;
};

export type QAPairWithCategory = QAPair & {
  categoryName: string | null;
  contactName?: string | null;
  contactJobTitle?: string | null;
  transcriptDate?: Date | null;
};

export type FeatureWithCategory = Feature & {
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
  transcripts: Transcript[];
  contacts: Contact[];
};

// Category overview type for category pages
export type CategoryOverview = {
  category: Category;
  insightCount: number;
  qaCount: number;
  insights: ProductInsightWithCategory[];
  qaPairs: QAPairWithCategory[];
};

// From Replit Auth integration (blueprint:javascript_log_in_with_replit)
// User types for authentication
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
