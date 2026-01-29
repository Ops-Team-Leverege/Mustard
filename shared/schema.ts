import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, jsonb, index, uniqueIndex, integer, boolean, real, customType } from "drizzle-orm/pg-core";

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1536)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return JSON.parse(value);
  },
});
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Product types
export const PRODUCTS = ["PitCrew", "AutoTrace", "WorkWatch", "ExpressLane"] as const;
export type Product = typeof PRODUCTS[number];

// Processing status types
export const PROCESSING_STATUSES = ["pending", "processing", "completed", "failed"] as const;
export type ProcessingStatus = typeof PROCESSING_STATUSES[number];

// Processing step types - granular steps during AI analysis
export const PROCESSING_STEPS = ["analyzing_transcript", "extracting_insights", "extracting_qa", "detecting_pos_systems", "complete"] as const;
export type ProcessingStep = typeof PROCESSING_STEPS[number];

export const transcripts = pgTable("transcripts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  product: text("product").default("PitCrew").notNull(),
  name: text("name"), // Meeting/transcript name - user editable
  companyName: text("company_name").notNull(), // Legacy field, kept for backward compatibility
  companyId: varchar("company_id"), // New normalized field
  contentType: text("content_type").default("transcript").notNull(), // "transcript" or "notes"
  transcript: text("transcript"), // Can be null if contentType is "notes"
  supportingMaterials: text("supporting_materials").array(), // Additional documents/materials that support the call
  leverageTeam: text("leverage_team").notNull(),
  customerNames: text("customer_names").notNull(),
  companyDescription: text("company_description"),
  numberOfStores: text("number_of_stores"),
  contactJobTitle: text("contact_job_title"),
  mainInterestAreas: text("main_interest_areas"),
  mainMeetingTakeaways: text("main_meeting_takeaways"),
  nextSteps: text("next_steps"),
  processingStatus: text("processing_status").default("pending").notNull(), // "pending", "processing", "completed", "failed"
  processingStep: text("processing_step"), // Granular step: "analyzing_transcript", "extracting_insights", "extracting_qa", "detecting_pos_systems", "complete"
  processingStartedAt: timestamp("processing_started_at"),
  processingCompletedAt: timestamp("processing_completed_at"),
  processingError: text("processing_error"),
  meetingDate: timestamp("meeting_date"), // Optional: Date of the meeting, defaults to createdAt in queries
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
  stage: text("stage").default("Prospect"),
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

// Customer Questions (High-Trust, Evidence-Based Layer)
// 
// IMPORTANT: This table is INDEPENDENT from qa_pairs and must NOT be merged.
// 
// | Table              | Nature       | Evidence Required | Inference Allowed | Use Case              |
// |--------------------|--------------|-------------------|-------------------|-----------------------|
// | qa_pairs           | Interpreted  | No                | Yes               | Browsing, analytics   |
// | customer_questions | Extractive   | Yes               | No                | Meeting intelligence  |
//
// This table stores ONLY questions asked by customers, with:
// - Verbatim transcript evidence (no paraphrasing)
// - Explicit status (ANSWERED, OPEN, DEFERRED)
// - Answer evidence when available
//
// Extraction uses gpt-4o at temperature 0 for deterministic output.
export const CUSTOMER_QUESTION_STATUSES = ["ANSWERED", "OPEN", "DEFERRED"] as const;
export type CustomerQuestionStatus = typeof CUSTOMER_QUESTION_STATUSES[number];

export const customerQuestions = pgTable("customer_questions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  product: text("product").default("PitCrew").notNull(),
  transcriptId: varchar("transcript_id").notNull(),
  companyId: varchar("company_id"),
  questionText: text("question_text").notNull(), // Verbatim from transcript
  askedByName: text("asked_by_name").notNull(), // Speaker name from transcript
  questionTurnIndex: integer("question_turn_index").notNull(), // Position in transcript for ordering
  status: text("status").notNull(), // "ANSWERED" | "OPEN" | "DEFERRED"
  answerEvidence: text("answer_evidence"), // Exact quote if answered
  answeredByName: text("answered_by_name"), // Who answered (if applicable)
  resolutionTurnIndex: integer("resolution_turn_index"), // Turn where answer was found (Resolution Pass)
  // Context Anchoring fields - restores verbatim adjacency for context-dependent questions
  requiresContext: boolean("requires_context").default(false).notNull(), // Deterministic: has "this", "that", "it", etc.
  contextBefore: text("context_before"), // Verbatim preceding transcript turns (speaker + text only)
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Meeting Action Items (Tier-1, Materialized at Ingestion)
// 
// This table stores action items extracted during transcript ingestion.
// Like customer_questions, these are Tier-1 artifacts:
// - Extracted once at ingestion time (not on query path)
// - Verbatim evidence from transcript
// - No inference or hallucination
// - Deterministic extraction using gpt-4o at temperature 0
//
// Used by Slack Single-Meeting Orchestrator for extractive Q&A.
export const ACTION_ITEM_TYPES = ["commitment", "request", "blocker", "plan", "scheduling"] as const;
export type ActionItemType = typeof ACTION_ITEM_TYPES[number];

export const meetingActionItems = pgTable("meeting_action_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  product: text("product").default("PitCrew").notNull(),
  transcriptId: varchar("transcript_id").notNull(),
  companyId: varchar("company_id"),
  actionText: text("action_text").notNull(), // Verb + object (clean, professional)
  ownerName: text("owner_name").notNull(), // Person name(s), NOT company names
  actionType: text("action_type").notNull(), // "commitment" | "request" | "blocker" | "plan" | "scheduling"
  deadline: text("deadline"), // null or "Not specified" if not stated
  evidenceQuote: text("evidence_quote").notNull(), // Verbatim transcript snippet
  confidence: real("confidence").notNull(), // 0-1 (≥0.85 explicit, 0.7-0.84 implied)
  isPrimary: boolean("is_primary").default(true).notNull(), // Primary (high confidence) vs secondary
  createdAt: timestamp("created_at").defaultNow().notNull(),
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

export const transcriptChunks = pgTable("transcript_chunks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  transcriptId: varchar("transcript_id").notNull(),
  companyId: varchar("company_id").notNull(),
  content: text("content").notNull(),
  embedding: vector("embedding"),
  chunkIndex: integer("chunk_index").notNull(),
  speakerName: text("speaker_name"),
  speakerRole: text("speaker_role"),
  meetingDate: timestamp("meeting_date"),
  startTimestamp: text("start_timestamp"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("transcript_chunks_transcript_chunk_idx").on(table.transcriptId, table.chunkIndex),
]);

// Meeting summaries - persists composed artifacts from RAG layer
export const meetingSummaries = pgTable("meeting_summaries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  transcriptId: varchar("transcript_id"),
  meetingTimestamp: timestamp("meeting_timestamp").notNull(),
  artifact: jsonb("artifact").notNull(), // { summary: MeetingSummary, quotes: SelectedQuote[] }
  createdAt: timestamp("created_at").defaultNow().notNull(),
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
  nameInTranscript: z.string().optional(),
  jobTitle: z.string().optional(),
});

export const insertTranscriptSchema = createInsertSchema(transcripts).omit({
  id: true,
  processingStatus: true,
  processingStep: true,
  processingStartedAt: true,
  processingCompletedAt: true,
  processingError: true,
}).extend({
  product: z.enum(PRODUCTS).default("PitCrew"),
  contentType: z.enum(["transcript", "notes"]).default("transcript"),
  transcript: z.string().optional(),
  mainMeetingTakeaways: z.string().optional(),
  supportingMaterials: z.array(z.string()).default([]),
  createdAt: z.string().or(z.date()).optional(),
  customers: z.array(customerSchema).min(1, "At least one customer is required"),
  // Form-only fields (not stored in transcripts table, but sent by frontend)
  serviceTags: z.array(z.string()).optional(),
  meetingDate: z.string().optional(),
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

export const insertCustomerQuestionSchema = createInsertSchema(customerQuestions).omit({
  id: true,
  createdAt: true,
}).extend({
  product: z.enum(PRODUCTS).default("PitCrew"),
  status: z.enum(CUSTOMER_QUESTION_STATUSES),
});

export const insertMeetingActionItemSchema = createInsertSchema(meetingActionItems).omit({
  id: true,
  createdAt: true,
}).extend({
  product: z.enum(PRODUCTS).default("PitCrew"),
  actionType: z.enum(ACTION_ITEM_TYPES),
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

export type InsertCustomerQuestion = z.infer<typeof insertCustomerQuestionSchema>;
export type CustomerQuestion = typeof customerQuestions.$inferSelect;

export type InsertMeetingActionItem = z.infer<typeof insertMeetingActionItemSchema>;
export type MeetingActionItem = typeof meetingActionItems.$inferSelect;

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

// TranscriptChunk type for RAG
export type TranscriptChunk = typeof transcriptChunks.$inferSelect;
export type InsertTranscriptChunk = Omit<typeof transcriptChunks.$inferInsert, 'id' | 'createdAt'>;

// MeetingSummary type for persisted RAG artifacts
export type MeetingSummary = typeof meetingSummaries.$inferSelect;
export type InsertMeetingSummary = Omit<typeof meetingSummaries.$inferInsert, 'id' | 'createdAt'>;

/**
 * Interaction Logs
 * 
 * This table records resolved user interactions for auditability, evaluation, and future context recovery.
 * It is NOT a knowledge source and must NOT be used as input to LLM reasoning.
 * 
 * Future use cases:
 * - Thread continuity (resuming conversations)
 * - Analytics (usage patterns, capability distribution)
 * - Evaluation (answer quality assessment)
 */
export const interactionLogs = pgTable("interaction_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  
  entryPoint: varchar("entry_point").notNull().default("slack"), // "slack", "api", "test"
  testRun: boolean("test_run").default(false), // For debugging/testing
  
  slackChannelId: varchar("slack_channel_id"),
  slackThreadId: varchar("slack_thread_id"), // Thread TS for grouping
  slackMessageTs: varchar("slack_message_ts"), // Unique message timestamp
  
  userId: varchar("user_id"), // Slack user ID who asked
  companyId: varchar("company_id"), // Resolved company if applicable
  meetingId: varchar("meeting_id"), // Resolved transcript/meeting ID if applicable
  
  questionText: text("question_text").notNull(), // User's original question
  answerText: text("answer_text"), // System's response (nullable if error)
  
  capabilityName: varchar("capability_name").notNull(), // Legacy field - derives from answer_contract or intent
  
  intent: varchar("intent"), // SINGLE_MEETING, MULTI_MEETING, PRODUCT_KNOWLEDGE, DOCUMENT_SEARCH, GENERAL_HELP
  intentDetectionMethod: varchar("intent_detection_method"), // keyword, llm, default
  
  answerContract: varchar("answer_contract"), // MEETING_SUMMARY, NEXT_STEPS, etc.
  contractSelectionMethod: varchar("contract_selection_method"), // keyword, llm, default
  
  contextLayers: jsonb("context_layers"), // { product_identity: true, single_meeting: true, ... }
  resolution: jsonb("resolution"), // { meeting_id, company_id, resolved_by, ... }
  evidenceSources: jsonb("evidence_sources"), // [ { type, id, snippet }, ... ]
  llmUsage: jsonb("llm_usage"), // { intent_classification: {...}, answer_generation: {...} }
}, (table) => [
  index("interaction_logs_thread_idx").on(table.slackThreadId),
  index("interaction_logs_company_idx").on(table.companyId),
  index("interaction_logs_created_idx").on(table.createdAt),
  index("interaction_logs_intent_idx").on(table.intent),
]);

export type InteractionLog = typeof interactionLogs.$inferSelect;
export type InsertInteractionLog = Omit<typeof interactionLogs.$inferInsert, 'id' | 'createdAt'>;

// ============================================
// AIRTABLE PRODUCT DATABASE TABLES
// ============================================
// These tables store synced data from the PitCrew Product Database in Airtable.
// Source of truth for product knowledge (features, value propositions, etc.)

export const pitcrewAirtableFeatures = pgTable("pitcrew_airtable_features", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  airtableId: varchar("airtable_id").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  productStatus: text("product_status"),
  proTier: text("pro_tier"),
  advancedTier: text("advanced_tier"),
  enterpriseTier: text("enterprise_tier"),
  listOrder: integer("list_order"),
  hideFromPricingList: boolean("hide_from_pricing_list").default(false),
  type: text("type"),
  internalNotes: text("internal_notes"),
  valuePropositionIds: text("value_proposition_ids").array(),
  featureThemeIds: text("feature_theme_ids").array(),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
}, (table) => [
  index("pitcrew_airtable_features_name_idx").on(table.name),
]);

export const pitcrewAirtableValuePropositions = pgTable("pitcrew_airtable_value_propositions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  airtableId: varchar("airtable_id").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  valueToCustomer: integer("value_to_customer"),
  internalNotes: text("internal_notes"),
  requiresPosIntegration: boolean("requires_pos_integration").default(false),
  featureIds: text("feature_ids").array(),
  segmentIds: text("segment_ids").array(),
  valueThemeIds: text("value_theme_ids").array(),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
}, (table) => [
  index("pitcrew_airtable_value_propositions_name_idx").on(table.name),
]);

export const pitcrewAirtableValueThemes = pgTable("pitcrew_airtable_value_themes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  airtableId: varchar("airtable_id").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  valuePropositionIds: text("value_proposition_ids").array(),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
});

export const pitcrewAirtableFeatureThemes = pgTable("pitcrew_airtable_feature_themes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  airtableId: varchar("airtable_id").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  notes: text("notes"),
  featureIds: text("feature_ids").array(),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
});

export const pitcrewAirtableCustomerSegments = pgTable("pitcrew_airtable_customer_segments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  airtableId: varchar("airtable_id").notNull().unique(),
  name: text("name").notNull(),
  valuePropositionIds: text("value_proposition_ids").array(),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
});

// Airtable sync metadata - tracks last sync time per table
export const pitcrewAirtableSyncLog = pgTable("pitcrew_airtable_sync_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tableName: varchar("table_name").notNull(),
  recordsCount: integer("records_count").notNull(),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
  status: text("status").default("success").notNull(),
  errorMessage: text("error_message"),
});

// Unified product knowledge - rebuilt after each Airtable sync
export const pitcrewProductSnapshot = pgTable("pitcrew_product_snapshot", {
  id: varchar("id").primaryKey().default("singleton"),
  promptText: text("prompt_text").notNull(),
  recordCount: integer("record_count").notNull(),
  tablesIncluded: text("tables_included").array().notNull(),
  lastSyncedAt: timestamp("last_synced_at").defaultNow().notNull(),
});

// Types
export type PitcrewAirtableFeature = typeof pitcrewAirtableFeatures.$inferSelect;
export type InsertPitcrewAirtableFeature = typeof pitcrewAirtableFeatures.$inferInsert;

export type PitcrewAirtableValueProposition = typeof pitcrewAirtableValuePropositions.$inferSelect;
export type InsertPitcrewAirtableValueProposition = typeof pitcrewAirtableValuePropositions.$inferInsert;

export type PitcrewAirtableValueTheme = typeof pitcrewAirtableValueThemes.$inferSelect;
export type InsertPitcrewAirtableValueTheme = typeof pitcrewAirtableValueThemes.$inferInsert;

export type PitcrewAirtableFeatureTheme = typeof pitcrewAirtableFeatureThemes.$inferSelect;
export type InsertPitcrewAirtableFeatureTheme = typeof pitcrewAirtableFeatureThemes.$inferInsert;

export type PitcrewAirtableCustomerSegment = typeof pitcrewAirtableCustomerSegments.$inferSelect;
export type InsertPitcrewAirtableCustomerSegment = typeof pitcrewAirtableCustomerSegments.$inferInsert;

export type PitcrewAirtableSyncLog = typeof pitcrewAirtableSyncLog.$inferSelect;
