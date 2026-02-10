import {
  type Transcript,
  type InsertTranscript,
  type ProductInsight,
  type ProductInsightWithCategory,
  type InsertProductInsight,
  type QAPair,
  type QAPairWithCategory,
  type InsertQAPair,
  type Category,
  type InsertCategory,
  type Feature,
  type FeatureWithCategory,
  type InsertFeature,
  type Company,
  type InsertCompany,
  type Contact,
  type InsertContact,
  type CompanyOverview,
  type CategoryOverview,
  type User,
  type UpsertUser,
  type POSSystem,
  type POSSystemWithCompanies,
  type InsertPOSSystem,
  type Product,
  type ProcessingStatus,
  type ProcessingStep,
  type TranscriptChunk,
  type InsertTranscriptChunk,
  type MeetingSummary,
  type InsertMeetingSummary,
  type InteractionLog,
  type InsertInteractionLog,
  type CustomerQuestion,
  type InsertCustomerQuestion,
  type MeetingActionItem,
  type InsertMeetingActionItem,
  transcripts as transcriptsTable,
  productInsights as productInsightsTable,
  qaPairs as qaPairsTable,
  categories as categoriesTable,
  features as featuresTable,
  companies as companiesTable,
  contacts as contactsTable,
  users as usersTable,
  posSystems as posSystemsTable,
  posSystemCompanies as posSystemCompaniesTable,
  transcriptChunks as transcriptChunksTable,
  meetingSummaries as meetingSummariesTable,
  interactionLogs as interactionLogsTable,
  customerQuestions as customerQuestionsTable,
  meetingActionItems as meetingActionItemsTable,
} from "@shared/schema";
import { randomUUID } from "crypto";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, sql as drizzleSql, inArray, and, gt } from "drizzle-orm";

export interface IStorage {
  // Transcripts
  getTranscripts(product: Product): Promise<Transcript[]>;
  getTranscript(product: Product, id: string): Promise<Transcript | undefined>;
  getTranscriptById(id: string): Promise<Transcript | undefined>;
  getTranscriptsByCompany(product: Product, companyId: string): Promise<Transcript[]>;
  createTranscript(transcript: InsertTranscript): Promise<Transcript>;
  updateTranscript(id: string, updates: { name?: string | null; createdAt?: Date; mainMeetingTakeaways?: string | null; nextSteps?: string | null; supportingMaterials?: string[]; transcript?: string | null }): Promise<Transcript | undefined>;
  updateTranscriptProcessingStatus(id: string, status: ProcessingStatus, error?: string | null): Promise<Transcript | undefined>;
  updateProcessingStep(id: string, step: ProcessingStep | null): Promise<Transcript | undefined>;
  deleteTranscript(id: string): Promise<boolean>;
  
  // Raw query for MCP
  rawQuery(sql: string, params?: any[]): Promise<any[]>;

  // Product Insights
  getProductInsights(product: Product): Promise<ProductInsightWithCategory[]>;
  getProductInsightsByTranscript(product: Product, transcriptId: string): Promise<ProductInsightWithCategory[]>;
  getProductInsightsByCategory(product: Product, categoryId: string): Promise<ProductInsightWithCategory[]>;
  createProductInsight(insight: InsertProductInsight): Promise<ProductInsight>;
  createProductInsights(insights: InsertProductInsight[]): Promise<ProductInsight[]>;
  updateProductInsight(id: string, feature: string, context: string, quote: string, company: string, companyId: string): Promise<ProductInsight | undefined>;
  deleteProductInsight(id: string): Promise<boolean>;
  assignCategoryToInsight(insightId: string, categoryId: string | null): Promise<boolean>;
  assignCategoryToInsights(insightIds: string[], categoryId: string | null): Promise<boolean>;

  // Q&A Pairs
  getQAPairs(product: Product): Promise<QAPairWithCategory[]>;
  getQAPairsByTranscript(product: Product, transcriptId: string): Promise<QAPairWithCategory[]>;
  createQAPair(qaPair: InsertQAPair): Promise<QAPair>;
  createQAPairs(qaPairs: InsertQAPair[]): Promise<QAPair[]>;
  updateQAPair(id: string, question: string, answer: string, asker: string, company: string, companyId: string, contactId?: string | null): Promise<QAPair | undefined>;
  deleteQAPair(id: string): Promise<boolean>;
  assignCategoryToQAPair(qaPairId: string, categoryId: string | null): Promise<boolean>;
  getQAPairsByCompany(product: Product, companyId: string): Promise<QAPairWithCategory[]>;
  toggleQAPairStar(id: string, isStarred: string): Promise<QAPair | undefined>;

  // Categories
  getCategories(product: Product): Promise<Category[]>;
  getCategory(product: Product, id: string): Promise<Category | undefined>;
  createCategory(category: InsertCategory): Promise<Category>;
  updateCategory(id: string, name: string, description?: string | null): Promise<Category | undefined>;
  deleteCategory(id: string): Promise<boolean>;
  getCategoryOverview(product: Product, categoryId: string): Promise<CategoryOverview | null>;

  // Features
  getFeatures(product: Product): Promise<FeatureWithCategory[]>;
  getFeature(product: Product, id: string): Promise<Feature | undefined>;
  createFeature(feature: InsertFeature): Promise<Feature>;
  updateFeature(id: string, name: string, description?: string | null, value?: string | null, videoLink?: string | null, helpGuideLink?: string | null, categoryId?: string | null, releaseDate?: Date | null): Promise<Feature | undefined>;
  deleteFeature(id: string): Promise<boolean>;

  // Companies
  getCompanies(product: Product): Promise<Company[]>;
  getCompany(product: Product, id: string): Promise<Company | undefined>;
  getCompanyBySlug(product: Product, slug: string): Promise<Company | undefined>;
  getCompanyByName(product: Product, name: string): Promise<Company | undefined>;
  createCompany(company: InsertCompany): Promise<Company>;
  updateCompany(id: string, name: string, notes?: string | null, companyDescription?: string | null, numberOfStores?: string | null, stage?: string | null, pilotStartDate?: Date | null, serviceTags?: string[] | null): Promise<Company | undefined>;
  deleteCompany(id: string): Promise<boolean>;
  getCompanyOverview(product: Product, slug: string): Promise<CompanyOverview | null>;
  updateCompanyNameInRelatedRecords(companyId: string, newName: string): Promise<void>;

  // Contacts
  getContactsByCompany(product: Product, companyId: string): Promise<Contact[]>;
  createContact(contact: InsertContact): Promise<Contact>;
  updateContact(id: string, name: string, nameInTranscript?: string | null, jobTitle?: string | null): Promise<Contact | undefined>;
  deleteContact(id: string): Promise<boolean>;
  mergeDuplicateContacts(product: Product, companyId: string): Promise<{ merged: number; kept: number }>;

  // Users (from Replit Auth integration - blueprint:javascript_log_in_with_replit)
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUserProduct(userId: string, product: Product): Promise<User | undefined>;

  // POS Systems
  getPOSSystems(product: Product): Promise<import("@shared/schema").POSSystemWithCompanies[]>;
  getPOSSystem(product: Product, id: string): Promise<import("@shared/schema").POSSystem | undefined>;
  getPOSSystemByName(product: Product, name: string): Promise<import("@shared/schema").POSSystem | undefined>;
  createPOSSystem(posSystem: import("@shared/schema").InsertPOSSystem): Promise<import("@shared/schema").POSSystem>;
  updatePOSSystem(id: string, name: string, websiteLink?: string | null, description?: string | null, companyIds?: string[]): Promise<import("@shared/schema").POSSystem | undefined>;
  deletePOSSystem(id: string): Promise<boolean>;
  linkCompanyToPOSSystem(posSystemId: string, companyId: string): Promise<void>;
  findOrCreatePOSSystemAndLink(product: Product, name: string, companyId: string, websiteLink?: string, description?: string): Promise<import("@shared/schema").POSSystem>;

  // Transcript Chunks (for RAG)
  getLastTranscriptIdForCompany(companyId: string): Promise<{ id: string; createdAt: Date; contentType: string } | null>;
  getChunksForTranscript(transcriptId: string, limit?: number): Promise<TranscriptChunk[]>;
  listTranscriptsForChunking(options: { transcriptId?: string; companyId?: string; limit: number }): Promise<{ id: string; companyId: string; content: string; meetingDate: Date; leverageTeam: string | null; customerNames: string | null }[]>;
  insertTranscriptChunks(chunks: InsertTranscriptChunk[]): Promise<void>;

  // Meeting Summaries (for persisting RAG artifacts)
  saveMeetingSummary(data: InsertMeetingSummary): Promise<MeetingSummary>;
  getLatestMeetingSummary(companyId: string): Promise<MeetingSummary | null>;

  // Interaction Logs (for auditability/evaluation, NOT LLM input)
  insertInteractionLog(log: InsertInteractionLog): Promise<InteractionLog>;
  getLastInteractionByThread(slackThreadId: string): Promise<InteractionLog | null>;

  // Customer Questions (High-Trust, Evidence-Based Layer)
  // IMPORTANT: These are INDEPENDENT from qa_pairs - do NOT merge or treat as interchangeable
  getCustomerQuestionsByTranscript(transcriptId: string): Promise<CustomerQuestion[]>;
  createCustomerQuestions(questions: InsertCustomerQuestion[]): Promise<CustomerQuestion[]>;
  deleteCustomerQuestionsByTranscript(transcriptId: string): Promise<boolean>;
  updateCustomerQuestionResolution(
    id: string,
    resolution: {
      status: "ANSWERED" | "DEFERRED" | "OPEN";
      answerEvidence: string | null;
      answeredByName: string | null;
      resolutionTurnIndex: number | null;
    }
  ): Promise<CustomerQuestion | null>;

  // Meeting Action Items (read-only artifact, materialized at ingestion)
  getMeetingActionItemsByTranscript(transcriptId: string): Promise<MeetingActionItem[]>;
  createMeetingActionItems(items: InsertMeetingActionItem[]): Promise<MeetingActionItem[]>;
  deleteMeetingActionItemsByTranscript(transcriptId: string): Promise<boolean>;
}

export class MemStorage implements IStorage {
  private transcripts: Map<string, Transcript>;
  private productInsights: Map<string, ProductInsight>;
  private qaPairs: Map<string, QAPair>;
  private categories: Map<string, Category>;
  private features: Map<string, Feature>;
  private companies: Map<string, Company>;
  private contacts: Map<string, Contact>;
  private users: Map<string, User>;

  constructor() {
    this.transcripts = new Map();
    this.productInsights = new Map();
    this.qaPairs = new Map();
    this.categories = new Map();
    this.features = new Map();
    this.companies = new Map();
    this.contacts = new Map();
    this.users = new Map();
    
    // Initialize with default categories for PitCrew
    const defaultCategories = [
      { name: 'Analytics', description: 'Reporting, dashboards, data visualization, and business intelligence features' },
      { name: 'Mobile', description: 'Mobile app features, offline mode, and mobile-specific functionality' },
      { name: 'Integration', description: 'Third-party integrations, APIs, webhooks, and data sync capabilities' },
      { name: 'Security', description: 'Authentication, authorization, data encryption, and security compliance features' },
    ];
    defaultCategories.forEach(({ name, description }) => {
      const id = randomUUID();
      this.categories.set(id, {
        id,
        product: 'PitCrew',
        name,
        description,
        createdAt: new Date(),
      });
    });
  }

  async rawQuery(sql: string, params?: any[]): Promise<any[]> {
    throw new Error("rawQuery not supported in MemStorage");
  }

  // Transcripts
  async getTranscripts(product: Product): Promise<Transcript[]> {
    return Array.from(this.transcripts.values())
      .filter(t => t.product === product)
      .sort((a, b) => 
        b.createdAt.getTime() - a.createdAt.getTime()
      );
  }

  async getTranscript(product: Product, id: string): Promise<Transcript | undefined> {
    const transcript = this.transcripts.get(id);
    return transcript?.product === product ? transcript : undefined;
  }

  async getTranscriptById(id: string): Promise<Transcript | undefined> {
    return this.transcripts.get(id);
  }

  async createTranscript(insertTranscript: InsertTranscript): Promise<Transcript> {
    const id = randomUUID();
    // Handle meetingDate: convert string to Date or null
    let meetingDate: Date | null = null;
    if (insertTranscript.meetingDate) {
      if (typeof insertTranscript.meetingDate === 'string') {
        meetingDate = new Date(insertTranscript.meetingDate);
      } else {
        meetingDate = insertTranscript.meetingDate as Date;
      }
    }
    
    const transcript: Transcript = {
      ...insertTranscript,
      name: insertTranscript.name ?? null,
      companyId: insertTranscript.companyId ?? null,
      transcript: insertTranscript.transcript ?? null,
      supportingMaterials: insertTranscript.supportingMaterials ?? [],
      companyDescription: insertTranscript.companyDescription ?? null,
      numberOfStores: insertTranscript.numberOfStores ?? null,
      contactJobTitle: insertTranscript.contactJobTitle ?? null,
      mainInterestAreas: insertTranscript.mainInterestAreas ?? null,
      mainMeetingTakeaways: insertTranscript.mainMeetingTakeaways ?? null,
      nextSteps: insertTranscript.nextSteps ?? null,
      processingStatus: "pending",
      processingStep: null,
      processingStartedAt: null,
      processingCompletedAt: null,
      processingError: null,
      id,
      createdAt: new Date(),
      meetingDate,
    };
    this.transcripts.set(id, transcript);
    return transcript;
  }

  async getTranscriptsByCompany(product: Product, companyId: string): Promise<Transcript[]> {
    return Array.from(this.transcripts.values()).filter(t => t.product === product && t.companyId === companyId);
  }

  async updateTranscript(id: string, updates: { name?: string | null; createdAt?: Date; mainMeetingTakeaways?: string | null; nextSteps?: string | null; supportingMaterials?: string[]; transcript?: string | null }): Promise<Transcript | undefined> {
    const transcript = this.transcripts.get(id);
    if (!transcript) return undefined;
    
    const updated = { 
      ...transcript, 
      ...(updates.name !== undefined && { name: updates.name }),
      ...(updates.createdAt !== undefined && { createdAt: updates.createdAt }),
      ...(updates.mainMeetingTakeaways !== undefined && { mainMeetingTakeaways: updates.mainMeetingTakeaways }),
      ...(updates.nextSteps !== undefined && { nextSteps: updates.nextSteps }),
      ...(updates.supportingMaterials !== undefined && { supportingMaterials: updates.supportingMaterials }),
      ...(updates.transcript !== undefined && { transcript: updates.transcript }),
    };
    this.transcripts.set(id, updated);
    return updated;
  }

  async updateTranscriptProcessingStatus(id: string, status: ProcessingStatus, error?: string | null): Promise<Transcript | undefined> {
    const transcript = this.transcripts.get(id);
    if (!transcript) return undefined;
    
    const now = new Date();
    let updated: Transcript;
    
    if (status === "pending") {
      updated = {
        ...transcript,
        processingStatus: "pending",
        processingStep: null,
        processingStartedAt: null,
        processingCompletedAt: null,
        processingError: null,
      };
    } else if (status === "processing") {
      updated = {
        ...transcript,
        processingStatus: "processing",
        processingStep: "analyzing_transcript",
        processingStartedAt: now,
        processingCompletedAt: null,
        processingError: null,
      };
    } else if (status === "completed") {
      updated = {
        ...transcript,
        processingStatus: "completed",
        processingStep: "complete",
        processingCompletedAt: now,
        processingError: null,
      };
    } else { // failed
      updated = {
        ...transcript,
        processingStatus: "failed",
        processingCompletedAt: now,
        processingError: error ?? "Processing failed",
      };
    }
    
    this.transcripts.set(id, updated);
    return updated;
  }

  async updateProcessingStep(id: string, step: ProcessingStep | null): Promise<Transcript | undefined> {
    const transcript = this.transcripts.get(id);
    if (!transcript) return undefined;
    
    const updated = {
      ...transcript,
      processingStep: step,
    };
    
    this.transcripts.set(id, updated);
    return updated;
  }

  async deleteTranscript(id: string): Promise<boolean> {
    const deleted = this.transcripts.delete(id);
    
    if (deleted) {
      // Cascade delete: remove all insights and Q&A pairs linked to this transcript
      const insightEntries = Array.from(this.productInsights.entries());
      for (const [insightId, insight] of insightEntries) {
        if (insight.transcriptId === id) {
          this.productInsights.delete(insightId);
        }
      }
      
      const qaPairEntries = Array.from(this.qaPairs.entries());
      for (const [qaPairId, qaPair] of qaPairEntries) {
        if (qaPair.transcriptId === id) {
          this.qaPairs.delete(qaPairId);
        }
      }
    }
    
    return deleted;
  }

  // Product Insights - with category name and transcript date enrichment
  private enrichInsightWithCategory(insight: ProductInsight): ProductInsightWithCategory {
    const category = insight.categoryId ? this.categories.get(insight.categoryId) : null;
    const transcript = insight.transcriptId ? this.transcripts.get(insight.transcriptId) : null;
    return {
      ...insight,
      categoryName: category?.name || null,
      transcriptDate: transcript?.createdAt || null,
    };
  }

  async getProductInsights(product: Product): Promise<ProductInsightWithCategory[]> {
    return Array.from(this.productInsights.values())
      .filter(i => i.product === product)
      .map(i => this.enrichInsightWithCategory(i));
  }

  async getProductInsightsByTranscript(product: Product, transcriptId: string): Promise<ProductInsightWithCategory[]> {
    return Array.from(this.productInsights.values())
      .filter(insight => insight.product === product && insight.transcriptId === transcriptId)
      .map(i => this.enrichInsightWithCategory(i));
  }

  async getProductInsightsByCategory(product: Product, categoryId: string): Promise<ProductInsightWithCategory[]> {
    return Array.from(this.productInsights.values())
      .filter(insight => insight.product === product && insight.categoryId === categoryId)
      .map(i => this.enrichInsightWithCategory(i));
  }

  async createProductInsight(insertInsight: InsertProductInsight): Promise<ProductInsight> {
    // Validate transcript exists (only if transcriptId is provided)
    if (insertInsight.transcriptId && !this.transcripts.has(insertInsight.transcriptId)) {
      throw new Error(`Transcript ${insertInsight.transcriptId} not found`);
    }
    
    // Validate category exists if provided
    if (insertInsight.categoryId && !this.categories.has(insertInsight.categoryId)) {
      throw new Error(`Category ${insertInsight.categoryId} not found`);
    }
    
    const id = randomUUID();
    const insight: ProductInsight = {
      ...insertInsight,
      transcriptId: insertInsight.transcriptId ?? null,
      categoryId: insertInsight.categoryId ?? null,
      companyId: insertInsight.companyId ?? null,
      jiraTicketKey: insertInsight.jiraTicketKey ?? null,
      createdAt: new Date(),
      id,
    };
    this.productInsights.set(id, insight);
    return insight;
  }

  async createProductInsights(insertInsights: InsertProductInsight[]): Promise<ProductInsight[]> {
    // Validate all first (atomicity)
    for (const insertInsight of insertInsights) {
      if (insertInsight.transcriptId && !this.transcripts.has(insertInsight.transcriptId)) {
        throw new Error(`Transcript ${insertInsight.transcriptId} not found`);
      }
      if (insertInsight.categoryId && !this.categories.has(insertInsight.categoryId)) {
        throw new Error(`Category ${insertInsight.categoryId} not found`);
      }
    }
    
    // All validated, now create
    const insights: ProductInsight[] = insertInsights.map(insertInsight => {
      const id = randomUUID();
      const insight: ProductInsight = {
        ...insertInsight,
        transcriptId: insertInsight.transcriptId ?? null,
        categoryId: insertInsight.categoryId ?? null,
        companyId: insertInsight.companyId ?? null,
        jiraTicketKey: insertInsight.jiraTicketKey ?? null,
        createdAt: new Date(),
        id,
      };
      this.productInsights.set(id, insight);
      return insight;
    });
    return insights;
  }

  async updateProductInsight(id: string, feature: string, context: string, quote: string, company: string, companyId: string): Promise<ProductInsight | undefined> {
    const insight = this.productInsights.get(id);
    if (!insight) return undefined;
    
    const updated: ProductInsight = {
      ...insight,
      feature,
      context,
      quote,
      company,
      companyId,
    };
    this.productInsights.set(id, updated);
    return updated;
  }

  async deleteProductInsight(id: string): Promise<boolean> {
    return this.productInsights.delete(id);
  }

  async assignCategoryToInsight(insightId: string, categoryId: string | null): Promise<boolean> {
    const insight = this.productInsights.get(insightId);
    if (!insight) return false;
    
    if (categoryId && !this.categories.has(categoryId)) {
      throw new Error(`Category ${categoryId} not found`);
    }
    
    this.productInsights.set(insightId, {
      ...insight,
      categoryId,
    });
    return true;
  }

  async assignCategoryToInsights(insightIds: string[], categoryId: string | null): Promise<boolean> {
    if (categoryId && !this.categories.has(categoryId)) {
      throw new Error(`Category ${categoryId} not found`);
    }
    
    for (const insightId of insightIds) {
      const insight = this.productInsights.get(insightId);
      if (insight) {
        this.productInsights.set(insightId, {
          ...insight,
          categoryId,
        });
      }
    }
    return true;
  }

  // Q&A Pairs - with category, contact, and transcript date enrichment
  private enrichQAPairWithCategory(qaPair: QAPair): QAPairWithCategory {
    const category = qaPair.categoryId ? this.categories.get(qaPair.categoryId) : null;
    const contact = qaPair.contactId ? this.contacts.get(qaPair.contactId) : null;
    const transcript = qaPair.transcriptId ? this.transcripts.get(qaPair.transcriptId) : null;
    return {
      ...qaPair,
      categoryName: category?.name || null,
      contactName: contact?.name || null,
      contactJobTitle: contact?.jobTitle || null,
      transcriptDate: transcript?.createdAt || null,
    };
  }

  async getQAPairs(product: Product): Promise<QAPairWithCategory[]> {
    return Array.from(this.qaPairs.values())
      .filter(qa => qa.product === product)
      .map(qa => this.enrichQAPairWithCategory(qa));
  }

  async getQAPairsByTranscript(product: Product, transcriptId: string): Promise<QAPairWithCategory[]> {
    return Array.from(this.qaPairs.values())
      .filter(qa => qa.product === product && qa.transcriptId === transcriptId)
      .map(qa => this.enrichQAPairWithCategory(qa));
  }

  async createQAPair(insertQAPair: InsertQAPair): Promise<QAPair> {
    // Validate transcript exists (only if transcriptId is provided)
    if (insertQAPair.transcriptId && !this.transcripts.has(insertQAPair.transcriptId)) {
      throw new Error(`Transcript ${insertQAPair.transcriptId} not found`);
    }
    
    const id = randomUUID();
    const qaPair: QAPair = {
      ...insertQAPair,
      transcriptId: insertQAPair.transcriptId ?? null,
      companyId: insertQAPair.companyId ?? null,
      categoryId: insertQAPair.categoryId ?? null,
      contactId: insertQAPair.contactId ?? null,
      isStarred: 'false',
      createdAt: new Date(),
      id,
    };
    this.qaPairs.set(id, qaPair);
    return qaPair;
  }

  async createQAPairs(insertQAPairs: InsertQAPair[]): Promise<QAPair[]> {
    // Validate all first (atomicity)
    for (const insertQAPair of insertQAPairs) {
      if (insertQAPair.transcriptId && !this.transcripts.has(insertQAPair.transcriptId)) {
        throw new Error(`Transcript ${insertQAPair.transcriptId} not found`);
      }
    }
    
    // All validated, now create
    const qaPairs: QAPair[] = insertQAPairs.map(insertQAPair => {
      const id = randomUUID();
      const qaPair: QAPair = {
        ...insertQAPair,
        transcriptId: insertQAPair.transcriptId ?? null,
        companyId: insertQAPair.companyId ?? null,
        categoryId: insertQAPair.categoryId ?? null,
        contactId: insertQAPair.contactId ?? null,
        isStarred: 'false',
        createdAt: new Date(),
        id,
      };
      this.qaPairs.set(id, qaPair);
      return qaPair;
    });
    return qaPairs;
  }

  async toggleQAPairStar(id: string, isStarred: string): Promise<QAPair | undefined> {
    const qaPair = this.qaPairs.get(id);
    if (!qaPair) return undefined;
    
    const updated: QAPair = {
      ...qaPair,
      isStarred,
    };
    this.qaPairs.set(id, updated);
    return updated;
  }

  async updateQAPair(id: string, question: string, answer: string, asker: string, company: string, companyId: string, contactId?: string | null): Promise<QAPair | undefined> {
    const qaPair = this.qaPairs.get(id);
    if (!qaPair) return undefined;
    
    const updated: QAPair = {
      ...qaPair,
      question,
      answer,
      asker,
      company,
      companyId,
      contactId: contactId !== undefined ? contactId : qaPair.contactId,
    };
    this.qaPairs.set(id, updated);
    return updated;
  }

  async deleteQAPair(id: string): Promise<boolean> {
    return this.qaPairs.delete(id);
  }

  async assignCategoryToQAPair(qaPairId: string, categoryId: string | null): Promise<boolean> {
    const qaPair = this.qaPairs.get(qaPairId);
    if (!qaPair) return false;
    
    if (categoryId && !this.categories.has(categoryId)) {
      throw new Error(`Category ${categoryId} not found`);
    }
    
    this.qaPairs.set(qaPairId, {
      ...qaPair,
      categoryId,
    });
    return true;
  }

  async getQAPairsByCompany(product: Product, companyId: string): Promise<QAPairWithCategory[]> {
    const qaPairs = Array.from(this.qaPairs.values())
      .filter(qa => qa.product === product && qa.companyId === companyId);
    
    return qaPairs.map(qa => {
      const category = qa.categoryId ? this.categories.get(qa.categoryId) : null;
      const contact = qa.contactId ? this.contacts.get(qa.contactId) : null;
      const transcript = qa.transcriptId ? this.transcripts.get(qa.transcriptId) : null;
      return {
        ...qa,
        categoryName: category?.name ?? null,
        contactName: contact?.name ?? null,
        contactJobTitle: contact?.jobTitle ?? null,
        transcriptDate: transcript?.createdAt ?? null,
      };
    });
  }

  // Categories
  async getCategories(product: Product): Promise<Category[]> {
    return Array.from(this.categories.values())
      .filter(c => c.product === product)
      .sort((a, b) => 
        a.name.localeCompare(b.name)
      );
  }

  async getCategory(product: Product, id: string): Promise<Category | undefined> {
    const category = this.categories.get(id);
    return category?.product === product ? category : undefined;
  }

  async createCategory(insertCategory: InsertCategory): Promise<Category> {
    // Check for duplicate name
    const existing = Array.from(this.categories.values()).find(
      c => c.name.toLowerCase() === insertCategory.name.toLowerCase()
    );
    if (existing) {
      throw new Error(`Category "${insertCategory.name}" already exists`);
    }
    
    const id = randomUUID();
    const category: Category = {
      ...insertCategory,
      description: insertCategory.description ?? null,
      id,
      createdAt: new Date(),
    };
    this.categories.set(id, category);
    return category;
  }

  async updateCategory(id: string, name: string, description?: string | null): Promise<Category | undefined> {
    const category = this.categories.get(id);
    if (!category) return undefined;
    
    // Check for duplicate name (excluding current category)
    const existing = Array.from(this.categories.values()).find(
      c => c.id !== id && c.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) {
      throw new Error(`Category "${name}" already exists`);
    }
    
    const updated: Category = {
      ...category,
      name,
      description: description !== undefined ? (description ?? null) : category.description,
    };
    this.categories.set(id, updated);
    return updated;
  }

  async deleteCategory(id: string): Promise<boolean> {
    const deleted = this.categories.delete(id);
    
    if (deleted) {
      // Null out categoryId for all insights that reference this category
      const entries = Array.from(this.productInsights.entries());
      for (const [insightId, insight] of entries) {
        if (insight.categoryId === id) {
          this.productInsights.set(insightId, {
            ...insight,
            categoryId: null,
          });
        }
      }
      
      // Null out categoryId for all features that reference this category
      const featureEntries = Array.from(this.features.entries());
      for (const [featureId, feature] of featureEntries) {
        if (feature.categoryId === id) {
          this.features.set(featureId, {
            ...feature,
            categoryId: null,
          });
        }
      }
    }
    
    return deleted;
  }

  // Features
  async getFeatures(product: Product): Promise<FeatureWithCategory[]> {
    const features = Array.from(this.features.values()).filter(f => f.product === product);
    return features.map(feature => {
      const category = feature.categoryId ? this.categories.get(feature.categoryId) : null;
      return {
        ...feature,
        categoryName: category?.name ?? null,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  async getFeature(product: Product, id: string): Promise<Feature | undefined> {
    const feature = this.features.get(id);
    return feature?.product === product ? feature : undefined;
  }

  async createFeature(insertFeature: InsertFeature): Promise<Feature> {
    const id = randomUUID();
    const feature: Feature = {
      ...insertFeature,
      description: insertFeature.description ?? null,
      value: insertFeature.value ?? null,
      videoLink: insertFeature.videoLink ?? null,
      helpGuideLink: insertFeature.helpGuideLink ?? null,
      categoryId: insertFeature.categoryId ?? null,
      releaseDate: insertFeature.releaseDate ?? null,
      id,
      createdAt: new Date(),
    };
    this.features.set(id, feature);
    return feature;
  }

  async updateFeature(id: string, name: string, description?: string | null, value?: string | null, videoLink?: string | null, helpGuideLink?: string | null, categoryId?: string | null, releaseDate?: Date | null): Promise<Feature | undefined> {
    const feature = this.features.get(id);
    if (!feature) return undefined;
    
    const updated: Feature = {
      ...feature,
      name,
      description: description !== undefined ? (description ?? null) : feature.description,
      value: value !== undefined ? (value ?? null) : feature.value,
      videoLink: videoLink !== undefined ? (videoLink ?? null) : feature.videoLink,
      helpGuideLink: helpGuideLink !== undefined ? (helpGuideLink ?? null) : feature.helpGuideLink,
      releaseDate: releaseDate !== undefined ? (releaseDate ?? null) : feature.releaseDate,
      categoryId: categoryId !== undefined ? (categoryId ?? null) : feature.categoryId,
    };
    this.features.set(id, updated);
    return updated;
  }

  async deleteFeature(id: string): Promise<boolean> {
    return this.features.delete(id);
  }

  // Companies
  async getCompanies(product: Product): Promise<Company[]> {
    return Array.from(this.companies.values())
      .filter(c => c.product === product)
      .sort((a, b) => 
        a.name.localeCompare(b.name)
      );
  }

  async getCompany(product: Product, id: string): Promise<Company | undefined> {
    const company = this.companies.get(id);
    return company?.product === product ? company : undefined;
  }

  async getCompanyBySlug(product: Product, slug: string): Promise<Company | undefined> {
    return Array.from(this.companies.values()).find(c => c.product === product && c.slug === slug);
  }

  async getCompanyByName(product: Product, name: string): Promise<Company | undefined> {
    const nameLower = name.toLowerCase().trim();
    return Array.from(this.companies.values()).find(c => 
      c.product === product && c.name.toLowerCase().trim() === nameLower
    );
  }

  async createCompany(insertCompany: InsertCompany): Promise<Company> {
    // Check for duplicate slug
    const existingSlug = Array.from(this.companies.values()).find(
      c => c.slug === insertCompany.slug
    );
    if (existingSlug) {
      throw new Error(`Company with slug "${insertCompany.slug}" already exists`);
    }
    
    const id = randomUUID();
    const company: Company = {
      ...insertCompany,
      notes: insertCompany.notes ?? null,
      companyDescription: insertCompany.companyDescription ?? null,
      numberOfStores: insertCompany.numberOfStores ?? null,
      stage: insertCompany.stage ?? null,
      pilotStartDate: insertCompany.pilotStartDate ?? null,
      serviceTags: insertCompany.serviceTags ?? null,
      id,
      createdAt: new Date(),
    };
    this.companies.set(id, company);
    return company;
  }

  async updateCompany(id: string, name: string, notes?: string | null, companyDescription?: string | null, numberOfStores?: string | null, stage?: string | null, pilotStartDate?: Date | null, serviceTags?: string[] | null): Promise<Company | undefined> {
    const company = this.companies.get(id);
    if (!company) return undefined;
    
    const updated: Company = {
      ...company,
      name,
      notes: notes !== undefined ? (notes ?? null) : company.notes,
      companyDescription: companyDescription !== undefined ? (companyDescription ?? null) : company.companyDescription,
      numberOfStores: numberOfStores !== undefined ? (numberOfStores ?? null) : company.numberOfStores,
      stage: stage !== undefined ? (stage ?? null) : company.stage,
      pilotStartDate: pilotStartDate !== undefined ? (pilotStartDate ?? null) : company.pilotStartDate,
      serviceTags: serviceTags !== undefined ? (serviceTags ?? null) : company.serviceTags,
    };
    this.companies.set(id, updated);
    return updated;
  }

  async deleteCompany(id: string): Promise<boolean> {
    return this.companies.delete(id);
  }

  async updateCompanyNameInRelatedRecords(companyId: string, newName: string): Promise<void> {
    for (const insight of Array.from(this.productInsights.values())) {
      if (insight.companyId === companyId) {
        this.productInsights.set(insight.id, { ...insight, company: newName });
      }
    }
    
    for (const qaPair of Array.from(this.qaPairs.values())) {
      if (qaPair.companyId === companyId) {
        this.qaPairs.set(qaPair.id, { ...qaPair, company: newName });
      }
    }
  }

  async getCompanyOverview(product: Product, slug: string): Promise<CompanyOverview | null> {
    const company = await this.getCompanyBySlug(product, slug);
    if (!company) return null;

    // Get transcripts for this company - match by both companyId and legacy companyName field
    const companyTranscripts = Array.from(this.transcripts.values()).filter(
      t => t.product === product && (t.companyId === company.id || t.companyName.toLowerCase() === company.name.toLowerCase())
    );

    // Get insights - both by legacy company field and new companyId
    const insights = Array.from(this.productInsights.values())
      .filter(i => 
        i.product === product && (i.companyId === company.id || 
        i.company.toLowerCase() === company.name.toLowerCase())
      )
      .map(i => {
        const enriched = this.enrichInsightWithCategory(i);
        return {
          ...enriched,
          company: enriched.company?.trim() || company.name,
        };
      });

    // Get Q&A pairs - both by legacy company field and new companyId
    const qaPairs = Array.from(this.qaPairs.values())
      .filter(qa => 
        qa.product === product && (qa.companyId === company.id || 
        qa.company.toLowerCase() === company.name.toLowerCase())
      )
      .map(qa => {
        const enriched = this.enrichQAPairWithCategory(qa);
        return {
          ...enriched,
          company: enriched.company?.trim() || company.name,
        };
      });

    // Get contacts for this company
    const contacts = Array.from(this.contacts.values()).filter(
      c => c.product === product && c.companyId === company.id
    );
    return {
      company,
      transcriptCount: companyTranscripts.length,
      insightCount: insights.length,
      qaCount: qaPairs.length,
      insights,
      qaPairs,
      transcripts: companyTranscripts,
      contacts,
    };
  }

  // Contacts
  async getContactsByCompany(product: Product, companyId: string): Promise<Contact[]> {
    return Array.from(this.contacts.values()).filter(c => c.product === product && c.companyId === companyId);
  }

  async createContact(insertContact: InsertContact): Promise<Contact> {
    const id = randomUUID();
    const contact: Contact = {
      ...insertContact,
      nameInTranscript: insertContact.nameInTranscript ?? null,
      jobTitle: insertContact.jobTitle ?? null,
      id,
      createdAt: new Date(),
    };
    this.contacts.set(id, contact);
    return contact;
  }

  async updateContact(id: string, name: string, nameInTranscript?: string | null, jobTitle?: string | null): Promise<Contact | undefined> {
    const contact = this.contacts.get(id);
    if (!contact) return undefined;

    const updated = { 
      ...contact, 
      name, 
      nameInTranscript: nameInTranscript !== undefined ? (nameInTranscript ?? null) : contact.nameInTranscript,
      jobTitle: jobTitle !== undefined ? (jobTitle ?? null) : contact.jobTitle
    };
    this.contacts.set(id, updated);
    return updated;
  }

  async deleteContact(id: string): Promise<boolean> {
    return this.contacts.delete(id);
  }

  async mergeDuplicateContacts(product: Product, companyId: string): Promise<{ merged: number; kept: number }> {
    const contacts = await this.getContactsByCompany(product, companyId);
    
    // Group contacts by normalized name (case-insensitive)
    const contactGroups = new Map<string, Contact[]>();
    contacts.forEach(contact => {
      const normalizedName = contact.name.toLowerCase().trim();
      if (!contactGroups.has(normalizedName)) {
        contactGroups.set(normalizedName, []);
      }
      contactGroups.get(normalizedName)!.push(contact);
    });
    
    let mergedCount = 0;
    let keptCount = 0;
    
    // For each group with duplicates, merge them
    for (const [, group] of Array.from(contactGroups.entries())) {
      if (group.length > 1) {
        // Sort by createdAt to keep the oldest contact as base
        group.sort((a: Contact, b: Contact) => a.createdAt.getTime() - b.createdAt.getTime());
        const keepContact = group[0];
        const duplicates = group.slice(1);
        
        // Reconcile metadata: prefer non-null values, with newer values taking precedence
        let reconciledJobTitle = keepContact.jobTitle;
        let reconciledNameInTranscript = keepContact.nameInTranscript;
        
        for (const duplicate of duplicates) {
          // Prefer newer non-null values (duplicates are sorted oldest to newest)
          if (duplicate.jobTitle) {
            reconciledJobTitle = duplicate.jobTitle;
          }
          if (duplicate.nameInTranscript) {
            reconciledNameInTranscript = duplicate.nameInTranscript;
          }
        }
        
        // Update the kept contact with reconciled metadata if anything changed
        if (reconciledJobTitle !== keepContact.jobTitle || reconciledNameInTranscript !== keepContact.nameInTranscript) {
          this.contacts.set(keepContact.id, {
            ...keepContact,
            jobTitle: reconciledJobTitle,
            nameInTranscript: reconciledNameInTranscript,
          });
        }
        
        // Update all Q&A pairs that reference duplicates to point to the kept contact
        for (const duplicate of duplicates) {
          for (const [qaId, qa] of Array.from(this.qaPairs.entries())) {
            if (qa.contactId === duplicate.id) {
              this.qaPairs.set(qaId, { ...qa, contactId: keepContact.id });
            }
          }
          
          // Delete the duplicate contact
          this.contacts.delete(duplicate.id);
          mergedCount++;
        }
        
        keptCount++;
      }
    }
    
    return { merged: mergedCount, kept: keptCount };
  }

  // User operations (from Replit Auth integration - blueprint:javascript_log_in_with_replit)
  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const now = new Date();
    const existingUser = this.users.get(userData.id!);
    
    const user: User = {
      id: userData.id || randomUUID(),
      email: userData.email || null,
      firstName: userData.firstName || null,
      lastName: userData.lastName || null,
      profileImageUrl: userData.profileImageUrl || null,
      currentProduct: existingUser?.currentProduct || 'PitCrew',
      createdAt: existingUser?.createdAt || now,
      updatedAt: now,
    };
    
    this.users.set(user.id, user);
    return user;
  }

  async updateUserProduct(userId: string, product: Product): Promise<User | undefined> {
    const user = this.users.get(userId);
    if (!user) return undefined;
    
    const updated = {
      ...user,
      currentProduct: product,
      updatedAt: new Date(),
    };
    this.users.set(userId, updated);
    return updated;
  }

  async getCategoryOverview(product: Product, categoryId: string): Promise<CategoryOverview | null> {
    const category = this.categories.get(categoryId);
    if (!category || category.product !== product) return null;

    // Get insights for this category
    const insights = Array.from(this.productInsights.values())
      .filter(i => i.product === product && i.categoryId === categoryId)
      .map(i => this.enrichInsightWithCategory(i));

    // Get Q&A pairs for this category
    const qaPairs = Array.from(this.qaPairs.values())
      .filter(qa => qa.product === product && qa.categoryId === categoryId)
      .map(qa => this.enrichQAPairWithCategory(qa));

    return {
      category,
      insightCount: insights.length,
      qaCount: qaPairs.length,
      insights,
      qaPairs,
    };
  }

  // POS Systems (stub implementations - not used in production)
  async getPOSSystems(product: Product): Promise<POSSystemWithCompanies[]> {
    return [];
  }

  async getPOSSystem(product: Product, id: string): Promise<POSSystem | undefined> {
    return undefined;
  }

  async createPOSSystem(posSystem: InsertPOSSystem): Promise<POSSystem> {
    throw new Error("MemStorage not supported for POS Systems");
  }

  async updatePOSSystem(id: string, name: string, websiteLink?: string | null, description?: string | null, companyIds?: string[]): Promise<POSSystem | undefined> {
    return undefined;
  }

  async deletePOSSystem(id: string): Promise<boolean> {
    return false;
  }

  async getPOSSystemByName(product: Product, name: string): Promise<POSSystem | undefined> {
    return undefined;
  }

  async linkCompanyToPOSSystem(posSystemId: string, companyId: string): Promise<void> {
    throw new Error("MemStorage not supported for POS Systems");
  }

  async findOrCreatePOSSystemAndLink(name: string, companyId: string, websiteLink?: string, description?: string): Promise<POSSystem> {
    throw new Error("MemStorage not supported for POS Systems");
  }

  async getLastTranscriptIdForCompany(companyId: string): Promise<{ id: string; createdAt: Date; contentType: string } | null> {
    throw new Error("MemStorage not supported for Transcript Chunks");
  }

  async getChunksForTranscript(transcriptId: string, limit?: number): Promise<TranscriptChunk[]> {
    throw new Error("MemStorage not supported for Transcript Chunks");
  }

  async listTranscriptsForChunking(options: { transcriptId?: string; companyId?: string; limit: number }): Promise<{ id: string; companyId: string; content: string; meetingDate: Date; leverageTeam: string | null; customerNames: string | null }[]> {
    throw new Error("MemStorage not supported for Transcript Chunks");
  }

  async insertTranscriptChunks(chunks: InsertTranscriptChunk[]): Promise<void> {
    throw new Error("MemStorage not supported for Transcript Chunks");
  }

  async saveMeetingSummary(data: InsertMeetingSummary): Promise<MeetingSummary> {
    throw new Error("MemStorage not supported for Meeting Summaries");
  }

  async getLatestMeetingSummary(companyId: string): Promise<MeetingSummary | null> {
    throw new Error("MemStorage not supported for Meeting Summaries");
  }

  async insertInteractionLog(log: InsertInteractionLog): Promise<InteractionLog> {
    throw new Error("MemStorage not supported for Interaction Logs");
  }

  async getLastInteractionByThread(slackThreadId: string): Promise<InteractionLog | null> {
    throw new Error("MemStorage not supported for Interaction Logs");
  }

  async getCustomerQuestionsByTranscript(transcriptId: string): Promise<CustomerQuestion[]> {
    throw new Error("MemStorage not supported for Customer Questions");
  }

  async createCustomerQuestions(questions: InsertCustomerQuestion[]): Promise<CustomerQuestion[]> {
    throw new Error("MemStorage not supported for Customer Questions");
  }

  async deleteCustomerQuestionsByTranscript(transcriptId: string): Promise<boolean> {
    throw new Error("MemStorage not supported for Customer Questions");
  }

  async updateCustomerQuestionResolution(
    id: string,
    resolution: {
      status: "ANSWERED" | "DEFERRED" | "OPEN";
      answerEvidence: string | null;
      answeredByName: string | null;
      resolutionTurnIndex: number | null;
    }
  ): Promise<CustomerQuestion | null> {
    throw new Error("MemStorage not supported for Customer Questions");
  }

  async getMeetingActionItemsByTranscript(transcriptId: string): Promise<MeetingActionItem[]> {
    throw new Error("MemStorage not supported for Meeting Action Items");
  }

  async createMeetingActionItems(items: InsertMeetingActionItem[]): Promise<MeetingActionItem[]> {
    throw new Error("MemStorage not supported for Meeting Action Items");
  }

  async deleteMeetingActionItemsByTranscript(transcriptId: string): Promise<boolean> {
    throw new Error("MemStorage not supported for Meeting Action Items");
  }
}

export class DbStorage implements IStorage {
  private db;
  private queryClient;

  constructor() {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set");
    }
    this.queryClient = neon(process.env.DATABASE_URL);  
    this.db = drizzle(this.queryClient);
  }
  
  // Method for MCP capabilities
  async rawQuery(sql: string, params?: any[]): Promise<any[]> {
    const result = await this.queryClient(sql, params ?? []);
    return result;
  }

  // Transcripts
  async getTranscripts(product: Product): Promise<Transcript[]> {
    const results = await this.db
      .select()
      .from(transcriptsTable)
      .where(eq(transcriptsTable.product, product))
      .orderBy(drizzleSql`${transcriptsTable.createdAt} DESC`);
    return results;
  }

  async getTranscript(product: Product, id: string): Promise<Transcript | undefined> {
    const results = await this.db
      .select()
      .from(transcriptsTable)
      .where(and(eq(transcriptsTable.product, product), eq(transcriptsTable.id, id)))
      .limit(1);
    return results[0];
  }

  async getTranscriptById(id: string): Promise<Transcript | undefined> {
    const results = await this.db
      .select()
      .from(transcriptsTable)
      .where(eq(transcriptsTable.id, id))
      .limit(1);
    return results[0];
  }

  async createTranscript(insertTranscript: InsertTranscript): Promise<Transcript> {
    const { customers, ...dbValues } = insertTranscript as any;
    
    // Handle meetingDate: convert string to Date or null
    if (dbValues.meetingDate && typeof dbValues.meetingDate === 'string') {
      dbValues.meetingDate = new Date(dbValues.meetingDate);
    } else if (!dbValues.meetingDate) {
      dbValues.meetingDate = null;
    }
    
    const results = await this.db
      .insert(transcriptsTable)
      .values(dbValues)
      .returning();
    return results[0];
  }

  async getTranscriptsByCompany(product: Product, companyId: string): Promise<Transcript[]> {
    const results = await this.db
      .select()
      .from(transcriptsTable)
      .where(and(eq(transcriptsTable.product, product), eq(transcriptsTable.companyId, companyId)))
      .orderBy(transcriptsTable.createdAt);
    return results;
  }

  async updateTranscript(id: string, updates: { name?: string | null; createdAt?: Date; mainMeetingTakeaways?: string | null; nextSteps?: string | null; supportingMaterials?: string[]; transcript?: string | null }): Promise<Transcript | undefined> {
    const updateData: any = {};
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.createdAt !== undefined) updateData.createdAt = updates.createdAt;
    if (updates.mainMeetingTakeaways !== undefined) updateData.mainMeetingTakeaways = updates.mainMeetingTakeaways;
    if (updates.nextSteps !== undefined) updateData.nextSteps = updates.nextSteps;
    if (updates.supportingMaterials !== undefined) updateData.supportingMaterials = updates.supportingMaterials;
    if (updates.transcript !== undefined) updateData.transcript = updates.transcript;
    
    const results = await this.db
      .update(transcriptsTable)
      .set(updateData)
      .where(eq(transcriptsTable.id, id))
      .returning();
    return results[0];
  }

  async updateTranscriptProcessingStatus(id: string, status: ProcessingStatus, error?: string | null): Promise<Transcript | undefined> {
    const now = new Date();
    let updateData: any;
    
    if (status === "pending") {
      updateData = {
        processingStatus: "pending",
        processingStep: null,
        processingStartedAt: null,
        processingCompletedAt: null,
        processingError: null,
      };
    } else if (status === "processing") {
      updateData = {
        processingStatus: "processing",
        processingStep: "analyzing_transcript",
        processingStartedAt: now,
        processingCompletedAt: null,
        processingError: null,
      };
    } else if (status === "completed") {
      updateData = {
        processingStatus: "completed",
        processingStep: "complete",
        processingCompletedAt: now,
        processingError: null,
      };
    } else { // failed
      updateData = {
        processingStatus: "failed",
        processingCompletedAt: now,
        processingError: error ?? "Processing failed",
      };
    }
    
    const results = await this.db
      .update(transcriptsTable)
      .set(updateData)
      .where(eq(transcriptsTable.id, id))
      .returning();
    return results[0];
  }

  async updateProcessingStep(id: string, step: ProcessingStep | null): Promise<Transcript | undefined> {
    const results = await this.db
      .update(transcriptsTable)
      .set({ processingStep: step })
      .where(eq(transcriptsTable.id, id))
      .returning();
    return results[0];
  }

  async deleteTranscript(id: string): Promise<boolean> {
    // Cascade delete: first remove all insights and Q&A pairs linked to this transcript
    await this.db
      .delete(productInsightsTable)
      .where(eq(productInsightsTable.transcriptId, id));
    
    await this.db
      .delete(qaPairsTable)
      .where(eq(qaPairsTable.transcriptId, id));
    
    // Then delete the transcript itself
    const results = await this.db
      .delete(transcriptsTable)
      .where(eq(transcriptsTable.id, id))
      .returning();
    
    return results.length > 0;
  }

  // Product Insights
  async getProductInsights(product: Product): Promise<ProductInsightWithCategory[]> {
    const results = await this.db
      .select({
        id: productInsightsTable.id,
        product: productInsightsTable.product,
        transcriptId: productInsightsTable.transcriptId,
        feature: productInsightsTable.feature,
        context: productInsightsTable.context,
        quote: productInsightsTable.quote,
        company: productInsightsTable.company,
        categoryId: productInsightsTable.categoryId,
        categoryName: categoriesTable.name,
        companyId: productInsightsTable.companyId,
        jiraTicketKey: productInsightsTable.jiraTicketKey,
        createdAt: productInsightsTable.createdAt,
        transcriptDate: transcriptsTable.createdAt,
      })
      .from(productInsightsTable)
      .leftJoin(categoriesTable, eq(productInsightsTable.categoryId, categoriesTable.id))
      .leftJoin(transcriptsTable, eq(productInsightsTable.transcriptId, transcriptsTable.id))
      .where(eq(productInsightsTable.product, product));
    
    return results.map(r => ({
      ...r,
      categoryName: r.categoryName || null,
      transcriptDate: r.transcriptDate || null,
    }));
  }

  async getProductInsightsByTranscript(product: Product, transcriptId: string): Promise<ProductInsightWithCategory[]> {
    const results = await this.db
      .select({
        id: productInsightsTable.id,
        product: productInsightsTable.product,
        transcriptId: productInsightsTable.transcriptId,
        feature: productInsightsTable.feature,
        context: productInsightsTable.context,
        quote: productInsightsTable.quote,
        company: productInsightsTable.company,
        categoryId: productInsightsTable.categoryId,
        categoryName: categoriesTable.name,
        companyId: productInsightsTable.companyId,
        jiraTicketKey: productInsightsTable.jiraTicketKey,
        createdAt: productInsightsTable.createdAt,
        transcriptDate: transcriptsTable.createdAt,
      })
      .from(productInsightsTable)
      .leftJoin(categoriesTable, eq(productInsightsTable.categoryId, categoriesTable.id))
      .leftJoin(transcriptsTable, eq(productInsightsTable.transcriptId, transcriptsTable.id))
      .where(and(eq(productInsightsTable.product, product), eq(productInsightsTable.transcriptId, transcriptId)));
    
    return results.map(r => ({
      ...r,
      categoryName: r.categoryName || null,
      transcriptDate: r.transcriptDate || null,
    }));
  }

  async getProductInsightsByCategory(product: Product, categoryId: string): Promise<ProductInsightWithCategory[]> {
    const results = await this.db
      .select({
        id: productInsightsTable.id,
        product: productInsightsTable.product,
        transcriptId: productInsightsTable.transcriptId,
        feature: productInsightsTable.feature,
        context: productInsightsTable.context,
        quote: productInsightsTable.quote,
        company: productInsightsTable.company,
        categoryId: productInsightsTable.categoryId,
        categoryName: categoriesTable.name,
        companyId: productInsightsTable.companyId,
        jiraTicketKey: productInsightsTable.jiraTicketKey,
        createdAt: productInsightsTable.createdAt,
        transcriptDate: transcriptsTable.createdAt,
      })
      .from(productInsightsTable)
      .leftJoin(categoriesTable, eq(productInsightsTable.categoryId, categoriesTable.id))
      .leftJoin(transcriptsTable, eq(productInsightsTable.transcriptId, transcriptsTable.id))
      .where(and(eq(productInsightsTable.product, product), eq(productInsightsTable.categoryId, categoryId)));
    
    return results.map(r => ({
      ...r,
      categoryName: r.categoryName || null,
      transcriptDate: r.transcriptDate || null,
    }));
  }

  async createProductInsight(insertInsight: InsertProductInsight): Promise<ProductInsight> {
    const results = await this.db
      .insert(productInsightsTable)
      .values(insertInsight)
      .returning();
    return results[0];
  }

  async createProductInsights(insertInsights: InsertProductInsight[]): Promise<ProductInsight[]> {
    if (insertInsights.length === 0) return [];
    const results = await this.db
      .insert(productInsightsTable)
      .values(insertInsights)
      .returning();
    return results;
  }

  async updateProductInsight(id: string, feature: string, context: string, quote: string, company: string, companyId: string): Promise<ProductInsight | undefined> {
    const results = await this.db
      .update(productInsightsTable)
      .set({ feature, context, quote, company, companyId })
      .where(eq(productInsightsTable.id, id))
      .returning();
    return results[0];
  }

  async deleteProductInsight(id: string): Promise<boolean> {
    const results = await this.db
      .delete(productInsightsTable)
      .where(eq(productInsightsTable.id, id))
      .returning();
    return results.length > 0;
  }

  async assignCategoryToInsight(insightId: string, categoryId: string | null): Promise<boolean> {
    const results = await this.db
      .update(productInsightsTable)
      .set({ categoryId })
      .where(eq(productInsightsTable.id, insightId))
      .returning();
    return results.length > 0;
  }

  async assignCategoryToInsights(insightIds: string[], categoryId: string | null): Promise<boolean> {
    if (insightIds.length === 0) return true;
    const results = await this.db
      .update(productInsightsTable)
      .set({ categoryId })
      .where(drizzleSql`${productInsightsTable.id} = ANY(${insightIds})`)
      .returning();
    return results.length > 0;
  }

  // Q&A Pairs
  async getQAPairs(product: Product): Promise<QAPairWithCategory[]> {
    const results = await this.db
      .select({
        id: qaPairsTable.id,
        product: qaPairsTable.product,
        transcriptId: qaPairsTable.transcriptId,
        question: qaPairsTable.question,
        answer: qaPairsTable.answer,
        asker: qaPairsTable.asker,
        contactId: qaPairsTable.contactId,
        company: qaPairsTable.company,
        companyId: qaPairsTable.companyId,
        categoryId: qaPairsTable.categoryId,
        isStarred: qaPairsTable.isStarred,
        categoryName: categoriesTable.name,
        contactName: contactsTable.name,
        contactJobTitle: contactsTable.jobTitle,
        createdAt: qaPairsTable.createdAt,
        transcriptDate: transcriptsTable.createdAt,
      })
      .from(qaPairsTable)
      .leftJoin(categoriesTable, eq(qaPairsTable.categoryId, categoriesTable.id))
      .leftJoin(contactsTable, eq(qaPairsTable.contactId, contactsTable.id))
      .leftJoin(transcriptsTable, eq(qaPairsTable.transcriptId, transcriptsTable.id))
      .where(eq(qaPairsTable.product, product));
    
    return results.map(r => ({
      ...r,
      categoryName: r.categoryName || null,
      contactName: r.contactName || null,
      contactJobTitle: r.contactJobTitle || null,
      transcriptDate: r.transcriptDate || null,
    }));
  }

  async getQAPairsByTranscript(product: Product, transcriptId: string): Promise<QAPairWithCategory[]> {
    const results = await this.db
      .select({
        id: qaPairsTable.id,
        product: qaPairsTable.product,
        transcriptId: qaPairsTable.transcriptId,
        question: qaPairsTable.question,
        answer: qaPairsTable.answer,
        asker: qaPairsTable.asker,
        contactId: qaPairsTable.contactId,
        company: qaPairsTable.company,
        companyId: qaPairsTable.companyId,
        categoryId: qaPairsTable.categoryId,
        isStarred: qaPairsTable.isStarred,
        categoryName: categoriesTable.name,
        contactName: contactsTable.name,
        contactJobTitle: contactsTable.jobTitle,
        createdAt: qaPairsTable.createdAt,
        transcriptDate: transcriptsTable.createdAt,
      })
      .from(qaPairsTable)
      .leftJoin(categoriesTable, eq(qaPairsTable.categoryId, categoriesTable.id))
      .leftJoin(contactsTable, eq(qaPairsTable.contactId, contactsTable.id))
      .leftJoin(transcriptsTable, eq(qaPairsTable.transcriptId, transcriptsTable.id))
      .where(and(eq(qaPairsTable.product, product), eq(qaPairsTable.transcriptId, transcriptId)));
    
    return results.map(r => ({
      ...r,
      categoryName: r.categoryName || null,
      contactName: r.contactName || null,
      contactJobTitle: r.contactJobTitle || null,
      transcriptDate: r.transcriptDate || null,
    }));
  }

  async createQAPair(insertQAPair: InsertQAPair): Promise<QAPair> {
    const results = await this.db
      .insert(qaPairsTable)
      .values(insertQAPair)
      .returning();
    return results[0];
  }

  async createQAPairs(insertQAPairs: InsertQAPair[]): Promise<QAPair[]> {
    if (insertQAPairs.length === 0) return [];
    const results = await this.db
      .insert(qaPairsTable)
      .values(insertQAPairs)
      .returning();
    return results;
  }

  async updateQAPair(id: string, question: string, answer: string, asker: string, company: string, companyId: string, contactId?: string | null): Promise<QAPair | undefined> {
    const updateData: Partial<QAPair> = { question, answer, asker, company, companyId };
    if (contactId !== undefined) {
      updateData.contactId = contactId;
    }
    const results = await this.db
      .update(qaPairsTable)
      .set(updateData)
      .where(eq(qaPairsTable.id, id))
      .returning();
    return results[0];
  }

  async deleteQAPair(id: string): Promise<boolean> {
    const results = await this.db
      .delete(qaPairsTable)
      .where(eq(qaPairsTable.id, id))
      .returning();
    return results.length > 0;
  }

  async assignCategoryToQAPair(qaPairId: string, categoryId: string | null): Promise<boolean> {
    const results = await this.db
      .update(qaPairsTable)
      .set({ categoryId })
      .where(eq(qaPairsTable.id, qaPairId))
      .returning();
    return results.length > 0;
  }

  async toggleQAPairStar(id: string, isStarred: string): Promise<QAPair | undefined> {
    const results = await this.db
      .update(qaPairsTable)
      .set({ isStarred })
      .where(eq(qaPairsTable.id, id))
      .returning();
    return results[0];
  }

  async getQAPairsByCompany(product: Product, companyId: string): Promise<QAPairWithCategory[]> {
    const results = await this.db
      .select({
        id: qaPairsTable.id,
        product: qaPairsTable.product,
        transcriptId: qaPairsTable.transcriptId,
        question: qaPairsTable.question,
        answer: qaPairsTable.answer,
        asker: qaPairsTable.asker,
        contactId: qaPairsTable.contactId,
        company: qaPairsTable.company,
        companyId: qaPairsTable.companyId,
        categoryId: qaPairsTable.categoryId,
        isStarred: qaPairsTable.isStarred,
        categoryName: categoriesTable.name,
        contactName: contactsTable.name,
        contactJobTitle: contactsTable.jobTitle,
        createdAt: qaPairsTable.createdAt,
        transcriptDate: transcriptsTable.createdAt,
      })
      .from(qaPairsTable)
      .leftJoin(categoriesTable, eq(qaPairsTable.categoryId, categoriesTable.id))
      .leftJoin(contactsTable, eq(qaPairsTable.contactId, contactsTable.id))
      .leftJoin(transcriptsTable, eq(qaPairsTable.transcriptId, transcriptsTable.id))
      .where(and(eq(qaPairsTable.product, product), eq(qaPairsTable.companyId, companyId)));
    
    return results.map(r => ({
      ...r,
      categoryName: r.categoryName || null,
      contactName: r.contactName || null,
      contactJobTitle: r.contactJobTitle || null,
      transcriptDate: r.transcriptDate || null,
    }));
  }

  // Categories
  async getCategories(product: Product): Promise<Category[]> {
    return await this.db
      .select()
      .from(categoriesTable)
      .where(eq(categoriesTable.product, product))
      .orderBy(categoriesTable.name);
  }

  async getCategory(product: Product, id: string): Promise<Category | undefined> {
    const results = await this.db
      .select()
      .from(categoriesTable)
      .where(and(eq(categoriesTable.product, product), eq(categoriesTable.id, id)))
      .limit(1);
    return results[0];
  }

  async createCategory(insertCategory: InsertCategory): Promise<Category> {
    const results = await this.db
      .insert(categoriesTable)
      .values(insertCategory)
      .returning();
    return results[0];
  }

  async updateCategory(id: string, name: string, description?: string | null): Promise<Category | undefined> {
    const results = await this.db
      .update(categoriesTable)
      .set({ 
        name, 
        description: description !== undefined ? (description ?? null) : undefined 
      })
      .where(eq(categoriesTable.id, id))
      .returning();
    return results[0];
  }

  async deleteCategory(id: string): Promise<boolean> {
    // First, null out categoryId for all insights that reference this category
    await this.db
      .update(productInsightsTable)
      .set({ categoryId: null })
      .where(eq(productInsightsTable.categoryId, id));
    
    // Null out categoryId for all features that reference this category
    await this.db
      .update(featuresTable)
      .set({ categoryId: null })
      .where(eq(featuresTable.categoryId, id));
    
    // Then delete the category
    const results = await this.db
      .delete(categoriesTable)
      .where(eq(categoriesTable.id, id))
      .returning();
    return results.length > 0;
  }

  // Features
  async getFeatures(product: Product): Promise<FeatureWithCategory[]> {
    const results = await this.db
      .select({
        id: featuresTable.id,
        product: featuresTable.product,
        name: featuresTable.name,
        description: featuresTable.description,
        value: featuresTable.value,
        videoLink: featuresTable.videoLink,
        helpGuideLink: featuresTable.helpGuideLink,
        categoryId: featuresTable.categoryId,
        categoryName: categoriesTable.name,
        releaseDate: featuresTable.releaseDate,
        createdAt: featuresTable.createdAt,
      })
      .from(featuresTable)
      .leftJoin(categoriesTable, eq(featuresTable.categoryId, categoriesTable.id))
      .where(eq(featuresTable.product, product))
      .orderBy(featuresTable.name);
    
    return results.map(r => ({
      ...r,
      categoryName: r.categoryName || null,
    }));
  }

  async getFeature(product: Product, id: string): Promise<Feature | undefined> {
    const results = await this.db
      .select()
      .from(featuresTable)
      .where(and(eq(featuresTable.product, product), eq(featuresTable.id, id)))
      .limit(1);
    return results[0];
  }

  async createFeature(insertFeature: InsertFeature): Promise<Feature> {
    const results = await this.db
      .insert(featuresTable)
      .values(insertFeature)
      .returning();
    return results[0];
  }

  async updateFeature(id: string, name: string, description?: string | null, value?: string | null, videoLink?: string | null, helpGuideLink?: string | null, categoryId?: string | null, releaseDate?: Date | null): Promise<Feature | undefined> {
    const updateData: any = { name };
    if (description !== undefined) updateData.description = description;
    if (value !== undefined) updateData.value = value;
    if (videoLink !== undefined) updateData.videoLink = videoLink;
    if (helpGuideLink !== undefined) updateData.helpGuideLink = helpGuideLink;
    if (categoryId !== undefined) updateData.categoryId = categoryId;
    if (releaseDate !== undefined) updateData.releaseDate = releaseDate;
    
    const results = await this.db
      .update(featuresTable)
      .set(updateData)
      .where(eq(featuresTable.id, id))
      .returning();
    return results[0];
  }

  async deleteFeature(id: string): Promise<boolean> {
    const results = await this.db
      .delete(featuresTable)
      .where(eq(featuresTable.id, id))
      .returning();
    return results.length > 0;
  }

  // Companies
  async getCompanies(product: Product): Promise<Company[]> {
    return await this.db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.product, product))
      .orderBy(companiesTable.name);
  }

  async getCompany(product: Product, id: string): Promise<Company | undefined> {
    const results = await this.db
      .select()
      .from(companiesTable)
      .where(and(eq(companiesTable.product, product), eq(companiesTable.id, id)))
      .limit(1);
    return results[0];
  }

  async getCompanyBySlug(product: Product, slug: string): Promise<Company | undefined> {
    const results = await this.db
      .select()
      .from(companiesTable)
      .where(and(eq(companiesTable.product, product), eq(companiesTable.slug, slug)))
      .limit(1);
    return results[0];
  }

  async getCompanyByName(product: Product, name: string): Promise<Company | undefined> {
    const results = await this.db
      .select()
      .from(companiesTable)
      .where(
        and(
          eq(companiesTable.product, product),
          drizzleSql`LOWER(TRIM(${companiesTable.name})) = LOWER(TRIM(${name}))`
        )
      )
      .limit(1);
    return results[0];
  }

  async createCompany(insertCompany: InsertCompany): Promise<Company> {
    const results = await this.db
      .insert(companiesTable)
      .values(insertCompany)
      .returning();
    return results[0];
  }

  async updateCompany(id: string, name: string, notes?: string | null, companyDescription?: string | null, numberOfStores?: string | null, stage?: string | null, pilotStartDate?: Date | null, serviceTags?: string[] | null): Promise<Company | undefined> {
    const results = await this.db
      .update(companiesTable)
      .set({ 
        name, 
        notes: notes !== undefined ? (notes ?? null) : undefined,
        companyDescription: companyDescription !== undefined ? (companyDescription ?? null) : undefined,
        numberOfStores: numberOfStores !== undefined ? (numberOfStores ?? null) : undefined,
        stage: stage !== undefined ? (stage ?? null) : undefined,
        pilotStartDate: pilotStartDate !== undefined ? (pilotStartDate ?? null) : undefined,
        serviceTags: serviceTags !== undefined ? (serviceTags ?? null) : undefined,
      })
      .where(eq(companiesTable.id, id))
      .returning();
    return results[0];
  }

  async deleteCompany(id: string): Promise<boolean> {
    const results = await this.db
      .delete(companiesTable)
      .where(eq(companiesTable.id, id))
      .returning();
    return results.length > 0;
  }

  async updateCompanyNameInRelatedRecords(companyId: string, newName: string): Promise<void> {
    await this.db
      .update(productInsightsTable)
      .set({ company: newName })
      .where(eq(productInsightsTable.companyId, companyId));
    
    await this.db
      .update(qaPairsTable)
      .set({ company: newName })
      .where(eq(qaPairsTable.companyId, companyId));
  }

  async getCompanyOverview(product: Product, slug: string): Promise<CompanyOverview | null> {
    const company = await this.getCompanyBySlug(product, slug);
    if (!company) return null;

    // Get transcripts for this company - match by both companyId and legacy companyName field, filter by product
    const companyTranscripts = await this.db
      .select()
      .from(transcriptsTable)
      .where(
        drizzleSql`${transcriptsTable.product} = ${product} AND (${transcriptsTable.companyId} = ${company.id} OR LOWER(${transcriptsTable.companyName}) = LOWER(${company.name}))`
      );

    // Get insights with category names - match by both companyId and legacy company field, filter by product
    const insights = await this.db
      .select({
        id: productInsightsTable.id,
        product: productInsightsTable.product,
        transcriptId: productInsightsTable.transcriptId,
        feature: productInsightsTable.feature,
        context: productInsightsTable.context,
        quote: productInsightsTable.quote,
        company: productInsightsTable.company,
        companyId: productInsightsTable.companyId,
        categoryId: productInsightsTable.categoryId,
        categoryName: categoriesTable.name,
        jiraTicketKey: productInsightsTable.jiraTicketKey,
        createdAt: productInsightsTable.createdAt,
        transcriptDate: transcriptsTable.createdAt,
      })
      .from(productInsightsTable)
      .leftJoin(categoriesTable, eq(productInsightsTable.categoryId, categoriesTable.id))
      .leftJoin(transcriptsTable, eq(productInsightsTable.transcriptId, transcriptsTable.id))
      .where(
        drizzleSql`${productInsightsTable.product} = ${product} AND (${productInsightsTable.companyId} = ${company.id} OR LOWER(${productInsightsTable.company}) = LOWER(${company.name}))`
      );

    // Get Q&A pairs with category and contact info - match by both companyId and legacy company field, filter by product
    const qaPairs = await this.db
      .select({
        id: qaPairsTable.id,
        product: qaPairsTable.product,
        transcriptId: qaPairsTable.transcriptId,
        question: qaPairsTable.question,
        answer: qaPairsTable.answer,
        asker: qaPairsTable.asker,
        contactId: qaPairsTable.contactId,
        company: qaPairsTable.company,
        companyId: qaPairsTable.companyId,
        categoryId: qaPairsTable.categoryId,
        isStarred: qaPairsTable.isStarred,
        categoryName: categoriesTable.name,
        contactName: contactsTable.name,
        contactJobTitle: contactsTable.jobTitle,
        createdAt: qaPairsTable.createdAt,
        transcriptDate: transcriptsTable.createdAt,
      })
      .from(qaPairsTable)
      .leftJoin(categoriesTable, eq(qaPairsTable.categoryId, categoriesTable.id))
      .leftJoin(contactsTable, eq(qaPairsTable.contactId, contactsTable.id))
      .leftJoin(transcriptsTable, eq(qaPairsTable.transcriptId, transcriptsTable.id))
      .where(
        drizzleSql`${qaPairsTable.product} = ${product} AND (${qaPairsTable.companyId} = ${company.id} OR LOWER(${qaPairsTable.company}) = LOWER(${company.name}))`
      );

    // Get contacts for this company - filter by product
    const contacts = await this.db
      .select()
      .from(contactsTable)
      .where(and(eq(contactsTable.product, product), eq(contactsTable.companyId, company.id)));

    return {
      company,
      transcriptCount: companyTranscripts.length,
      insightCount: insights.length,
      qaCount: qaPairs.length,
      insights: insights.map(i => ({
        ...i,
        company: i.company?.trim() || company.name,
        categoryName: i.categoryName || null,
      })),
      qaPairs: qaPairs.map(qa => ({
        ...qa,
        company: qa.company?.trim() || company.name,
        categoryName: qa.categoryName || null,
        contactName: qa.contactName || null,
        contactJobTitle: qa.contactJobTitle || null,
      })),
      transcripts: companyTranscripts,
      contacts,
    };
  }

  // Contacts
  async getContactsByCompany(product: Product, companyId: string): Promise<Contact[]> {
    return await this.db
      .select()
      .from(contactsTable)
      .where(and(eq(contactsTable.product, product), eq(contactsTable.companyId, companyId)));
  }

  async createContact(insertContact: InsertContact): Promise<Contact> {
    const results = await this.db
      .insert(contactsTable)
      .values(insertContact)
      .returning();
    return results[0];
  }

  async updateContact(id: string, name: string, nameInTranscript?: string | null, jobTitle?: string | null): Promise<Contact | undefined> {
    const results = await this.db
      .update(contactsTable)
      .set({ 
        name, 
        nameInTranscript: nameInTranscript !== undefined ? (nameInTranscript ?? null) : undefined,
        jobTitle: jobTitle !== undefined ? (jobTitle ?? null) : undefined
      })
      .where(eq(contactsTable.id, id))
      .returning();
    return results[0];
  }

  async deleteContact(id: string): Promise<boolean> {
    const results = await this.db
      .delete(contactsTable)
      .where(eq(contactsTable.id, id))
      .returning();
    return results.length > 0;
  }

  async mergeDuplicateContacts(product: Product, companyId: string): Promise<{ merged: number; kept: number }> {
    const contacts = await this.db
      .select()
      .from(contactsTable)
      .where(and(
        eq(contactsTable.product, product),
        eq(contactsTable.companyId, companyId)
      ))
      .orderBy(contactsTable.createdAt);
    
    // Group contacts by normalized name (case-insensitive)
    const contactGroups = new Map<string, typeof contacts>();
    contacts.forEach(contact => {
      const normalizedName = contact.name.toLowerCase().trim();
      if (!contactGroups.has(normalizedName)) {
        contactGroups.set(normalizedName, []);
      }
      contactGroups.get(normalizedName)!.push(contact);
    });
    
    let mergedCount = 0;
    let keptCount = 0;
    
    // For each group with duplicates, merge them
    for (const [, group] of Array.from(contactGroups.entries())) {
      if (group.length > 1) {
        // Keep the oldest contact (first in sorted array) as base
        const keepContact = group[0];
        const duplicates = group.slice(1);
        
        // Reconcile metadata: prefer non-null values, with newer values taking precedence
        let reconciledJobTitle = keepContact.jobTitle;
        let reconciledNameInTranscript = keepContact.nameInTranscript;
        
        for (const duplicate of duplicates) {
          // Prefer newer non-null values (duplicates are sorted oldest to newest)
          if (duplicate.jobTitle) {
            reconciledJobTitle = duplicate.jobTitle;
          }
          if (duplicate.nameInTranscript) {
            reconciledNameInTranscript = duplicate.nameInTranscript;
          }
        }
        
        // Update the kept contact with reconciled metadata if anything changed
        if (reconciledJobTitle !== keepContact.jobTitle || reconciledNameInTranscript !== keepContact.nameInTranscript) {
          await this.db
            .update(contactsTable)
            .set({
              jobTitle: reconciledJobTitle,
              nameInTranscript: reconciledNameInTranscript,
            })
            .where(eq(contactsTable.id, keepContact.id));
        }
        
        // Update all Q&A pairs that reference duplicates to point to the kept contact
        for (const duplicate of duplicates) {
          await this.db
            .update(qaPairsTable)
            .set({ contactId: keepContact.id })
            .where(eq(qaPairsTable.contactId, duplicate.id));
        }
        
        // Delete the duplicate contacts
        for (const duplicate of duplicates) {
          await this.db
            .delete(contactsTable)
            .where(eq(contactsTable.id, duplicate.id));
        }
        
        mergedCount += duplicates.length;
        keptCount++;
      }
    }
    
    return { merged: mergedCount, kept: keptCount };
  }

  // User operations (from Replit Auth integration - blueprint:javascript_log_in_with_replit)
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await this.db.select().from(usersTable).where(eq(usersTable.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await this.db
      .insert(usersTable)
      .values(userData)
      .onConflictDoUpdate({
        target: usersTable.id,
        set: {
          email: userData.email,
          firstName: userData.firstName,
          lastName: userData.lastName,
          profileImageUrl: userData.profileImageUrl,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async updateUserProduct(userId: string, product: Product): Promise<User | undefined> {
    const [user] = await this.db
      .update(usersTable)
      .set({ 
        currentProduct: product,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, userId))
      .returning();
    return user;
  }

  async getCategoryOverview(product: Product, categoryId: string): Promise<CategoryOverview | null> {
    const category = await this.getCategory(product, categoryId);
    if (!category) return null;

    // Get insights for this category with category names
    const insights = await this.db
      .select({
        id: productInsightsTable.id,
        product: productInsightsTable.product,
        transcriptId: productInsightsTable.transcriptId,
        feature: productInsightsTable.feature,
        context: productInsightsTable.context,
        quote: productInsightsTable.quote,
        company: productInsightsTable.company,
        companyId: productInsightsTable.companyId,
        categoryId: productInsightsTable.categoryId,
        categoryName: categoriesTable.name,
        jiraTicketKey: productInsightsTable.jiraTicketKey,
        createdAt: productInsightsTable.createdAt,
        transcriptDate: transcriptsTable.createdAt,
      })
      .from(productInsightsTable)
      .leftJoin(categoriesTable, eq(productInsightsTable.categoryId, categoriesTable.id))
      .leftJoin(transcriptsTable, eq(productInsightsTable.transcriptId, transcriptsTable.id))
      .where(and(eq(productInsightsTable.product, product), eq(productInsightsTable.categoryId, categoryId)));

    // Get Q&A pairs for this category with category and contact info
    const qaPairs = await this.db
      .select({
        id: qaPairsTable.id,
        product: qaPairsTable.product,
        transcriptId: qaPairsTable.transcriptId,
        question: qaPairsTable.question,
        answer: qaPairsTable.answer,
        asker: qaPairsTable.asker,
        contactId: qaPairsTable.contactId,
        company: qaPairsTable.company,
        companyId: qaPairsTable.companyId,
        categoryId: qaPairsTable.categoryId,
        isStarred: qaPairsTable.isStarred,
        categoryName: categoriesTable.name,
        contactName: contactsTable.name,
        contactJobTitle: contactsTable.jobTitle,
        createdAt: qaPairsTable.createdAt,
        transcriptDate: transcriptsTable.createdAt,
      })
      .from(qaPairsTable)
      .leftJoin(categoriesTable, eq(qaPairsTable.categoryId, categoriesTable.id))
      .leftJoin(contactsTable, eq(qaPairsTable.contactId, contactsTable.id))
      .leftJoin(transcriptsTable, eq(qaPairsTable.transcriptId, transcriptsTable.id))
      .where(and(eq(qaPairsTable.product, product), eq(qaPairsTable.categoryId, categoryId)));

    return {
      category,
      insightCount: insights.length,
      qaCount: qaPairs.length,
      insights: insights.map(i => ({
        ...i,
        categoryName: i.categoryName || null,
      })),
      qaPairs: qaPairs.map(qa => ({
        ...qa,
        categoryName: qa.categoryName || null,
        contactName: qa.contactName || null,
        contactJobTitle: qa.contactJobTitle || null,
      })),
    };
  }

  // POS Systems operations
  async getPOSSystems(product: Product): Promise<POSSystemWithCompanies[]> {
    const systems = await this.db.select().from(posSystemsTable).where(eq(posSystemsTable.product, product));
    
    // Get all companies for each system
    const systemsWithCompanies = await Promise.all(
      systems.map(async (system) => {
        const companyLinks = await this.db
          .select()
          .from(posSystemCompaniesTable)
          .where(eq(posSystemCompaniesTable.posSystemId, system.id));
        
        const companyIds = companyLinks.map(link => link.companyId);
        const companies = companyIds.length > 0
          ? await this.db
              .select()
              .from(companiesTable)
              .where(and(eq(companiesTable.product, product), inArray(companiesTable.id, companyIds)))
          : [];
        
        return {
          ...system,
          companies,
        };
      })
    );
    
    return systemsWithCompanies;
  }

  async getPOSSystem(product: Product, id: string): Promise<POSSystem | undefined> {
    const [system] = await this.db
      .select()
      .from(posSystemsTable)
      .where(and(eq(posSystemsTable.product, product), eq(posSystemsTable.id, id)));
    return system;
  }

  async createPOSSystem(posSystemData: InsertPOSSystem): Promise<POSSystem> {
    const { companyIds, ...systemData } = posSystemData;
    
    const [system] = await this.db
      .insert(posSystemsTable)
      .values(systemData)
      .returning();
    
    // Create company relationships if provided
    if (companyIds && companyIds.length > 0) {
      await this.db.insert(posSystemCompaniesTable).values(
        companyIds.map(companyId => ({
          posSystemId: system.id,
          companyId,
        }))
      );
    }
    
    return system;
  }

  async updatePOSSystem(
    id: string,
    name: string,
    websiteLink?: string | null,
    description?: string | null,
    companyIds?: string[]
  ): Promise<POSSystem | undefined> {
    const [system] = await this.db
      .update(posSystemsTable)
      .set({
        name,
        websiteLink: websiteLink ?? null,
        description: description ?? null,
      })
      .where(eq(posSystemsTable.id, id))
      .returning();
    
    if (!system) return undefined;
    
    // Update company relationships if provided
    if (companyIds !== undefined) {
      // Delete existing relationships
      await this.db
        .delete(posSystemCompaniesTable)
        .where(eq(posSystemCompaniesTable.posSystemId, id));
      
      // Create new relationships
      if (companyIds.length > 0) {
        await this.db.insert(posSystemCompaniesTable).values(
          companyIds.map(companyId => ({
            posSystemId: id,
            companyId,
          }))
        );
      }
    }
    
    return system;
  }

  async deletePOSSystem(id: string): Promise<boolean> {
    // Delete company relationships first
    await this.db
      .delete(posSystemCompaniesTable)
      .where(eq(posSystemCompaniesTable.posSystemId, id));
    
    // Delete the POS system
    const result = await this.db
      .delete(posSystemsTable)
      .where(eq(posSystemsTable.id, id));
    
    return true;
  }

  async getPOSSystemByName(product: Product, name: string): Promise<POSSystem | undefined> {
    const [system] = await this.db
      .select()
      .from(posSystemsTable)
      .where(drizzleSql`${posSystemsTable.product} = ${product} AND LOWER(${posSystemsTable.name}) = LOWER(${name})`);
    return system;
  }

  async linkCompanyToPOSSystem(posSystemId: string, companyId: string): Promise<void> {
    // Check if link already exists
    const [existing] = await this.db
      .select()
      .from(posSystemCompaniesTable)
      .where(
        drizzleSql`${posSystemCompaniesTable.posSystemId} = ${posSystemId} AND ${posSystemCompaniesTable.companyId} = ${companyId}`
      );
    
    if (!existing) {
      await this.db.insert(posSystemCompaniesTable).values({
        posSystemId,
        companyId,
      });
    }
  }

  async findOrCreatePOSSystemAndLink(
    product: Product,
    name: string,
    companyId: string,
    websiteLink?: string,
    description?: string
  ): Promise<POSSystem> {
    // Try to find existing POS system by name (case-insensitive)
    let system = await this.getPOSSystemByName(product, name);
    
    if (system) {
      // Link to company if not already linked
      await this.linkCompanyToPOSSystem(system.id, companyId);
    } else {
      // Create new POS system
      system = await this.createPOSSystem({
        product,
        name,
        websiteLink: websiteLink || null,
        description: description || null,
        companyIds: [companyId],
      });
    }
    
    return system;
  }

  async getLastTranscriptIdForCompany(companyId: string): Promise<{ id: string; createdAt: Date; contentType: string; leverageTeam: string | null; customerNames: string | null } | null> {
    // First find the most recent transcript ID from chunks
    const [chunkResult] = await this.db
      .select({ transcriptId: transcriptChunksTable.transcriptId })
      .from(transcriptChunksTable)
      .where(eq(transcriptChunksTable.companyId, companyId))
      .orderBy(drizzleSql`${transcriptChunksTable.createdAt} DESC`)
      .limit(1);
    
    if (!chunkResult?.transcriptId) {
      return null;
    }

    // Then fetch the transcript's created_at, contentType, and attendee info
    const [transcript] = await this.db
      .select({ 
        createdAt: transcriptsTable.createdAt, 
        contentType: transcriptsTable.contentType,
        leverageTeam: transcriptsTable.leverageTeam,
        customerNames: transcriptsTable.customerNames,
      })
      .from(transcriptsTable)
      .where(eq(transcriptsTable.id, chunkResult.transcriptId))
      .limit(1);
    
    if (!transcript) {
      return null;
    }

    return { 
      id: chunkResult.transcriptId, 
      createdAt: transcript.createdAt, 
      contentType: transcript.contentType,
      leverageTeam: transcript.leverageTeam,
      customerNames: transcript.customerNames,
    };
  }

  async getChunksForTranscript(transcriptId: string, limit?: number): Promise<TranscriptChunk[]> {
    const query = this.db
      .select()
      .from(transcriptChunksTable)
      .where(eq(transcriptChunksTable.transcriptId, transcriptId))
      .orderBy(drizzleSql`${transcriptChunksTable.chunkIndex} ASC`);
    return limit ? query.limit(limit) : query;
  }

  async listTranscriptsForChunking(options: { transcriptId?: string; companyId?: string; limit: number }): Promise<{ id: string; companyId: string; content: string; meetingDate: Date; leverageTeam: string | null; customerNames: string | null }[]> {
    const { transcriptId, companyId, limit } = options;
    
    const conditions = [];
    // Only include transcripts that have content and a companyId
    conditions.push(drizzleSql`${transcriptsTable.transcript} IS NOT NULL`);
    conditions.push(drizzleSql`${transcriptsTable.companyId} IS NOT NULL`);
    
    // Only include transcripts that haven't been chunked yet
    conditions.push(drizzleSql`NOT EXISTS (
      SELECT 1 FROM ${transcriptChunksTable} 
      WHERE ${transcriptChunksTable.transcriptId} = ${transcriptsTable.id}
    )`);
    
    if (transcriptId) {
      conditions.push(eq(transcriptsTable.id, transcriptId));
    }
    if (companyId) {
      conditions.push(eq(transcriptsTable.companyId, companyId));
    }
    
    const results = await this.db
      .select({
        id: transcriptsTable.id,
        companyId: transcriptsTable.companyId,
        content: transcriptsTable.transcript,
        meetingDate: transcriptsTable.createdAt,
        leverageTeam: transcriptsTable.leverageTeam,
        customerNames: transcriptsTable.customerNames,
      })
      .from(transcriptsTable)
      .where(drizzleSql`${drizzleSql.join(conditions, drizzleSql` AND `)}`)
      .orderBy(drizzleSql`${transcriptsTable.createdAt} DESC`)
      .limit(limit);
    
    // Filter out null companyId/content and map to expected type
    return results
      .filter(r => r.companyId !== null && r.content !== null)
      .map(r => ({
        id: r.id,
        companyId: r.companyId!,
        content: r.content!,
        meetingDate: r.meetingDate,
        leverageTeam: r.leverageTeam || null,
        customerNames: r.customerNames || null,
      }));
  }

  async insertTranscriptChunks(chunks: InsertTranscriptChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    
    // Use ON CONFLICT DO NOTHING keyed by (transcript_id, chunk_index) for idempotency
    await this.db
      .insert(transcriptChunksTable)
      .values(chunks)
      .onConflictDoNothing({
        target: [transcriptChunksTable.transcriptId, transcriptChunksTable.chunkIndex],
      });
  }

  // Meeting Summaries - thin helpers for persisting RAG artifacts
  async saveMeetingSummary(data: InsertMeetingSummary): Promise<MeetingSummary> {
    const [result] = await this.db
      .insert(meetingSummariesTable)
      .values(data)
      .returning();
    return result;
  }

  async getLatestMeetingSummary(companyId: string): Promise<MeetingSummary | null> {
    const [result] = await this.db
      .select()
      .from(meetingSummariesTable)
      .where(eq(meetingSummariesTable.companyId, companyId))
      .orderBy(drizzleSql`${meetingSummariesTable.meetingTimestamp} DESC`)
      .limit(1);
    return result ?? null;
  }

  // Interaction Logs - thin helpers for auditability/evaluation, NOT LLM input
  async insertInteractionLog(log: InsertInteractionLog): Promise<InteractionLog> {
    const [result] = await this.db
      .insert(interactionLogsTable)
      .values(log)
      .returning();
    return result;
  }

  async getLastInteractionByThread(slackThreadId: string): Promise<InteractionLog | null> {
    const [result] = await this.db
      .select()
      .from(interactionLogsTable)
      .where(eq(interactionLogsTable.slackThreadId, slackThreadId))
      .orderBy(drizzleSql`${interactionLogsTable.createdAt} DESC`)
      .limit(1);
    return result ?? null;
  }

  // Customer Questions (High-Trust, Evidence-Based Layer)
  // IMPORTANT: These are INDEPENDENT from qa_pairs - do NOT merge or treat as interchangeable
  async getCustomerQuestionsByTranscript(transcriptId: string): Promise<CustomerQuestion[]> {
    return await this.db
      .select()
      .from(customerQuestionsTable)
      .where(eq(customerQuestionsTable.transcriptId, transcriptId))
      .orderBy(customerQuestionsTable.questionTurnIndex);
  }

  async createCustomerQuestions(questions: InsertCustomerQuestion[]): Promise<CustomerQuestion[]> {
    if (questions.length === 0) return [];
    const results = await this.db
      .insert(customerQuestionsTable)
      .values(questions)
      .returning();
    return results;
  }

  async deleteCustomerQuestionsByTranscript(transcriptId: string): Promise<boolean> {
    const results = await this.db
      .delete(customerQuestionsTable)
      .where(eq(customerQuestionsTable.transcriptId, transcriptId))
      .returning();
    return results.length > 0;
  }

  async updateCustomerQuestionResolution(
    id: string,
    resolution: {
      status: "ANSWERED" | "DEFERRED" | "OPEN";
      answerEvidence: string | null;
      answeredByName: string | null;
      resolutionTurnIndex: number | null;
    }
  ): Promise<CustomerQuestion | null> {
    const [result] = await this.db
      .update(customerQuestionsTable)
      .set({
        status: resolution.status,
        answerEvidence: resolution.answerEvidence,
        answeredByName: resolution.answeredByName,
        resolutionTurnIndex: resolution.resolutionTurnIndex,
      })
      .where(eq(customerQuestionsTable.id, id))
      .returning();
    return result ?? null;
  }

  async getMeetingActionItemsByTranscript(transcriptId: string): Promise<MeetingActionItem[]> {
    return await this.db
      .select()
      .from(meetingActionItemsTable)
      .where(and(
        eq(meetingActionItemsTable.transcriptId, transcriptId),
        gt(meetingActionItemsTable.confidence, 0) // Exclude sentinel rows from backfill
      ));
  }

  async createMeetingActionItems(items: InsertMeetingActionItem[]): Promise<MeetingActionItem[]> {
    if (items.length === 0) return [];
    const results = await this.db
      .insert(meetingActionItemsTable)
      .values(items)
      .returning();
    return results;
  }

  async deleteMeetingActionItemsByTranscript(transcriptId: string): Promise<boolean> {
    const results = await this.db
      .delete(meetingActionItemsTable)
      .where(eq(meetingActionItemsTable.transcriptId, transcriptId))
      .returning();
    return results.length > 0;
  }
}

export const storage = new DbStorage();
