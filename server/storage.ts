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
  type Company,
  type InsertCompany,
  type Contact,
  type InsertContact,
  type CompanyOverview,
  type CategoryOverview,
  type User,
  type UpsertUser,
  transcripts as transcriptsTable,
  productInsights as productInsightsTable,
  qaPairs as qaPairsTable,
  categories as categoriesTable,
  companies as companiesTable,
  contacts as contactsTable,
  users as usersTable,
} from "@shared/schema";
import { randomUUID } from "crypto";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, sql as drizzleSql } from "drizzle-orm";

export interface IStorage {
  // Transcripts
  getTranscripts(): Promise<Transcript[]>;
  getTranscript(id: string): Promise<Transcript | undefined>;
  createTranscript(transcript: InsertTranscript): Promise<Transcript>;

  // Product Insights
  getProductInsights(): Promise<ProductInsightWithCategory[]>;
  getProductInsightsByTranscript(transcriptId: string): Promise<ProductInsightWithCategory[]>;
  getProductInsightsByCategory(categoryId: string): Promise<ProductInsightWithCategory[]>;
  createProductInsight(insight: InsertProductInsight): Promise<ProductInsight>;
  createProductInsights(insights: InsertProductInsight[]): Promise<ProductInsight[]>;
  updateProductInsight(id: string, feature: string, context: string, quote: string, company: string, companyId: string): Promise<ProductInsight | undefined>;
  deleteProductInsight(id: string): Promise<boolean>;
  assignCategoryToInsight(insightId: string, categoryId: string | null): Promise<boolean>;
  assignCategoryToInsights(insightIds: string[], categoryId: string | null): Promise<boolean>;
  linkInsightToJira(insightId: string, jiraTicketKey: string): Promise<boolean>;

  // Q&A Pairs
  getQAPairs(): Promise<QAPairWithCategory[]>;
  getQAPairsByTranscript(transcriptId: string): Promise<QAPair[]>;
  createQAPair(qaPair: InsertQAPair): Promise<QAPair>;
  createQAPairs(qaPairs: InsertQAPair[]): Promise<QAPair[]>;
  updateQAPair(id: string, question: string, answer: string, asker: string, company: string, companyId: string, contactId?: string | null): Promise<QAPair | undefined>;
  deleteQAPair(id: string): Promise<boolean>;
  assignCategoryToQAPair(qaPairId: string, categoryId: string | null): Promise<boolean>;
  getQAPairsByCompany(companyId: string): Promise<QAPairWithCategory[]>;

  // Categories
  getCategories(): Promise<Category[]>;
  getCategory(id: string): Promise<Category | undefined>;
  createCategory(category: InsertCategory): Promise<Category>;
  updateCategory(id: string, name: string, description?: string | null): Promise<Category | undefined>;
  deleteCategory(id: string): Promise<boolean>;
  getCategoryOverview(categoryId: string): Promise<CategoryOverview | null>;

  // Companies
  getCompanies(): Promise<Company[]>;
  getCompany(id: string): Promise<Company | undefined>;
  getCompanyBySlug(slug: string): Promise<Company | undefined>;
  createCompany(company: InsertCompany): Promise<Company>;
  updateCompany(id: string, name: string, notes?: string | null, companyDescription?: string | null, mainInterestAreas?: string | null, numberOfStores?: string | null): Promise<Company | undefined>;
  deleteCompany(id: string): Promise<boolean>;
  getCompanyOverview(slug: string): Promise<CompanyOverview | null>;
  updateCompanyNameInRelatedRecords(companyId: string, newName: string): Promise<void>;

  // Contacts
  getContactsByCompany(companyId: string): Promise<Contact[]>;
  createContact(contact: InsertContact): Promise<Contact>;
  updateContact(id: string, name: string, nameInTranscript?: string | null, jobTitle?: string | null): Promise<Contact | undefined>;
  deleteContact(id: string): Promise<boolean>;

  // Users (from Replit Auth integration - blueprint:javascript_log_in_with_replit)
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
}

export class MemStorage implements IStorage {
  private transcripts: Map<string, Transcript>;
  private productInsights: Map<string, ProductInsight>;
  private qaPairs: Map<string, QAPair>;
  private categories: Map<string, Category>;
  private companies: Map<string, Company>;
  private contacts: Map<string, Contact>;
  private users: Map<string, User>;

  constructor() {
    this.transcripts = new Map();
    this.productInsights = new Map();
    this.qaPairs = new Map();
    this.categories = new Map();
    this.companies = new Map();
    this.contacts = new Map();
    this.users = new Map();

    // Initialize with default categories
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
        name,
        description,
        createdAt: new Date(),
      });
    });
  }

  // Transcripts
  async getTranscripts(): Promise<Transcript[]> {
    return Array.from(this.transcripts.values()).sort((a, b) => 
      b.createdAt.getTime() - a.createdAt.getTime()
    );
  }

  async getTranscript(id: string): Promise<Transcript | undefined> {
    return this.transcripts.get(id);
  }

  async createTranscript(insertTranscript: InsertTranscript): Promise<Transcript> {
    const id = randomUUID();
    const transcript: Transcript = {
      ...insertTranscript,
      companyId: insertTranscript.companyId ?? null,
      companyDescription: insertTranscript.companyDescription ?? null,
      numberOfStores: insertTranscript.numberOfStores ?? null,
      contactJobTitle: insertTranscript.contactJobTitle ?? null,
      mainInterestAreas: insertTranscript.mainInterestAreas ?? null,
      id,
      createdAt: new Date(),
    };
    this.transcripts.set(id, transcript);
    return transcript;
  }

  // Product Insights - with category name enrichment
  private enrichInsightWithCategory(insight: ProductInsight): ProductInsightWithCategory {
    const category = insight.categoryId ? this.categories.get(insight.categoryId) : null;
    return {
      ...insight,
      categoryName: category?.name || null,
    };
  }

  async getProductInsights(): Promise<ProductInsightWithCategory[]> {
    return Array.from(this.productInsights.values()).map(i => this.enrichInsightWithCategory(i));
  }

  async getProductInsightsByTranscript(transcriptId: string): Promise<ProductInsightWithCategory[]> {
    return Array.from(this.productInsights.values())
      .filter(insight => insight.transcriptId === transcriptId)
      .map(i => this.enrichInsightWithCategory(i));
  }

  async getProductInsightsByCategory(categoryId: string): Promise<ProductInsightWithCategory[]> {
    return Array.from(this.productInsights.values())
      .filter(insight => insight.categoryId === categoryId)
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

  async linkInsightToJira(insightId: string, jiraTicketKey: string): Promise<boolean> {
    const insight = this.productInsights.get(insightId);
    if (!insight) {
      return false;
    }
    this.productInsights.set(insightId, {
      ...insight,
      jiraTicketKey,
    });
    return true;
  }

  // Q&A Pairs - with category and contact enrichment
  private enrichQAPairWithCategory(qaPair: QAPair): QAPairWithCategory {
    const category = qaPair.categoryId ? this.categories.get(qaPair.categoryId) : null;
    const contact = qaPair.contactId ? this.contacts.get(qaPair.contactId) : null;
    return {
      ...qaPair,
      categoryName: category?.name || null,
      contactName: contact?.name || null,
      contactJobTitle: contact?.jobTitle || null,
    };
  }

  async getQAPairs(): Promise<QAPairWithCategory[]> {
    return Array.from(this.qaPairs.values()).map(qa => this.enrichQAPairWithCategory(qa));
  }

  async getQAPairsByTranscript(transcriptId: string): Promise<QAPair[]> {
    return Array.from(this.qaPairs.values()).filter(
      qa => qa.transcriptId === transcriptId
    );
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
        createdAt: new Date(),
        id,
      };
      this.qaPairs.set(id, qaPair);
      return qaPair;
    });
    return qaPairs;
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

  async getQAPairsByCompany(companyId: string): Promise<QAPairWithCategory[]> {
    const qaPairs = Array.from(this.qaPairs.values())
      .filter(qa => qa.companyId === companyId);
    
    return qaPairs.map(qa => {
      const category = qa.categoryId ? this.categories.get(qa.categoryId) : null;
      const contact = qa.contactId ? this.contacts.get(qa.contactId) : null;
      return {
        ...qa,
        categoryName: category?.name ?? null,
        contactName: contact?.name ?? null,
        contactJobTitle: contact?.jobTitle ?? null,
      };
    });
  }

  // Categories
  async getCategories(): Promise<Category[]> {
    return Array.from(this.categories.values()).sort((a, b) => 
      a.name.localeCompare(b.name)
    );
  }

  async getCategory(id: string): Promise<Category | undefined> {
    return this.categories.get(id);
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
    }
    
    return deleted;
  }

  // Companies
  async getCompanies(): Promise<Company[]> {
    return Array.from(this.companies.values()).sort((a, b) => 
      a.name.localeCompare(b.name)
    );
  }

  async getCompany(id: string): Promise<Company | undefined> {
    return this.companies.get(id);
  }

  async getCompanyBySlug(slug: string): Promise<Company | undefined> {
    return Array.from(this.companies.values()).find(c => c.slug === slug);
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
      mainInterestAreas: insertCompany.mainInterestAreas ?? null,
      numberOfStores: insertCompany.numberOfStores ?? null,
      id,
      createdAt: new Date(),
    };
    this.companies.set(id, company);
    return company;
  }

  async updateCompany(id: string, name: string, notes?: string | null, companyDescription?: string | null, mainInterestAreas?: string | null, numberOfStores?: string | null): Promise<Company | undefined> {
    const company = this.companies.get(id);
    if (!company) return undefined;
    
    const updated: Company = {
      ...company,
      name,
      notes: notes !== undefined ? (notes ?? null) : company.notes,
      companyDescription: companyDescription !== undefined ? (companyDescription ?? null) : company.companyDescription,
      mainInterestAreas: mainInterestAreas !== undefined ? (mainInterestAreas ?? null) : company.mainInterestAreas,
      numberOfStores: numberOfStores !== undefined ? (numberOfStores ?? null) : company.numberOfStores,
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

  async getCompanyOverview(slug: string): Promise<CompanyOverview | null> {
    const company = await this.getCompanyBySlug(slug);
    if (!company) return null;

    // Get transcripts for this company - match by both companyId and legacy companyName field
    const companyTranscripts = Array.from(this.transcripts.values()).filter(
      t => t.companyId === company.id || t.companyName.toLowerCase() === company.name.toLowerCase()
    );

    // Get insights - both by legacy company field and new companyId
    const insights = Array.from(this.productInsights.values())
      .filter(i => 
        i.companyId === company.id || 
        i.company.toLowerCase() === company.name.toLowerCase()
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
        qa.companyId === company.id || 
        qa.company.toLowerCase() === company.name.toLowerCase()
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
      c => c.companyId === company.id
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
  async getContactsByCompany(companyId: string): Promise<Contact[]> {
    return Array.from(this.contacts.values()).filter(c => c.companyId === companyId);
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
      createdAt: existingUser?.createdAt || now,
      updatedAt: now,
    };
    
    this.users.set(user.id, user);
    return user;
  }

  async getCategoryOverview(categoryId: string): Promise<CategoryOverview | null> {
    const category = this.categories.get(categoryId);
    if (!category) return null;

    // Get insights for this category
    const insights = Array.from(this.productInsights.values())
      .filter(i => i.categoryId === categoryId)
      .map(i => this.enrichInsightWithCategory(i));

    // Get Q&A pairs for this category
    const qaPairs = Array.from(this.qaPairs.values())
      .filter(qa => qa.categoryId === categoryId)
      .map(qa => this.enrichQAPairWithCategory(qa));

    return {
      category,
      insightCount: insights.length,
      qaCount: qaPairs.length,
      insights,
      qaPairs,
    };
  }
}

export class DbStorage implements IStorage {
  private db;

  constructor() {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set");
    }
    const queryClient = neon(process.env.DATABASE_URL);
    this.db = drizzle(queryClient);
  }

  // Transcripts
  async getTranscripts(): Promise<Transcript[]> {
    const results = await this.db
      .select()
      .from(transcriptsTable)
      .orderBy(drizzleSql`${transcriptsTable.createdAt} DESC`);
    return results;
  }

  async getTranscript(id: string): Promise<Transcript | undefined> {
    const results = await this.db
      .select()
      .from(transcriptsTable)
      .where(eq(transcriptsTable.id, id))
      .limit(1);
    return results[0];
  }

  async createTranscript(insertTranscript: InsertTranscript): Promise<Transcript> {
    const results = await this.db
      .insert(transcriptsTable)
      .values(insertTranscript)
      .returning();
    return results[0];
  }

  // Product Insights
  async getProductInsights(): Promise<ProductInsightWithCategory[]> {
    const results = await this.db
      .select({
        id: productInsightsTable.id,
        transcriptId: productInsightsTable.transcriptId,
        feature: productInsightsTable.feature,
        context: productInsightsTable.context,
        quote: productInsightsTable.quote,
        company: productInsightsTable.company,
        categoryId: productInsightsTable.categoryId,
        categoryName: categoriesTable.name,
        companyId: productInsightsTable.companyId,
        createdAt: productInsightsTable.createdAt,
      })
      .from(productInsightsTable)
      .leftJoin(categoriesTable, eq(productInsightsTable.categoryId, categoriesTable.id));
    
    return results.map(r => ({
      ...r,
      categoryName: r.categoryName || null,
    }));
  }

  async getProductInsightsByTranscript(transcriptId: string): Promise<ProductInsightWithCategory[]> {
    const results = await this.db
      .select({
        id: productInsightsTable.id,
        transcriptId: productInsightsTable.transcriptId,
        feature: productInsightsTable.feature,
        context: productInsightsTable.context,
        quote: productInsightsTable.quote,
        company: productInsightsTable.company,
        categoryId: productInsightsTable.categoryId,
        categoryName: categoriesTable.name,
        companyId: productInsightsTable.companyId,
        createdAt: productInsightsTable.createdAt,
      })
      .from(productInsightsTable)
      .leftJoin(categoriesTable, eq(productInsightsTable.categoryId, categoriesTable.id))
      .where(eq(productInsightsTable.transcriptId, transcriptId));
    
    return results.map(r => ({
      ...r,
      categoryName: r.categoryName || null,
    }));
  }

  async getProductInsightsByCategory(categoryId: string): Promise<ProductInsightWithCategory[]> {
    const results = await this.db
      .select({
        id: productInsightsTable.id,
        transcriptId: productInsightsTable.transcriptId,
        feature: productInsightsTable.feature,
        context: productInsightsTable.context,
        quote: productInsightsTable.quote,
        company: productInsightsTable.company,
        categoryId: productInsightsTable.categoryId,
        categoryName: categoriesTable.name,
        companyId: productInsightsTable.companyId,
        createdAt: productInsightsTable.createdAt,
      })
      .from(productInsightsTable)
      .leftJoin(categoriesTable, eq(productInsightsTable.categoryId, categoriesTable.id))
      .where(eq(productInsightsTable.categoryId, categoryId));
    
    return results.map(r => ({
      ...r,
      categoryName: r.categoryName || null,
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

  async linkInsightToJira(insightId: string, jiraTicketKey: string): Promise<boolean> {
    const results = await this.db
      .update(productInsightsTable)
      .set({ jiraTicketKey })
      .where(eq(productInsightsTable.id, insightId))
      .returning();
    return results.length > 0;
  }

  // Q&A Pairs
  async getQAPairs(): Promise<QAPairWithCategory[]> {
    const results = await this.db
      .select({
        id: qaPairsTable.id,
        transcriptId: qaPairsTable.transcriptId,
        question: qaPairsTable.question,
        answer: qaPairsTable.answer,
        asker: qaPairsTable.asker,
        contactId: qaPairsTable.contactId,
        company: qaPairsTable.company,
        companyId: qaPairsTable.companyId,
        categoryId: qaPairsTable.categoryId,
        categoryName: categoriesTable.name,
        contactName: contactsTable.name,
        contactJobTitle: contactsTable.jobTitle,
        createdAt: qaPairsTable.createdAt,
      })
      .from(qaPairsTable)
      .leftJoin(categoriesTable, eq(qaPairsTable.categoryId, categoriesTable.id))
      .leftJoin(contactsTable, eq(qaPairsTable.contactId, contactsTable.id));
    
    return results.map(r => ({
      ...r,
      categoryName: r.categoryName || null,
      contactName: r.contactName || null,
      contactJobTitle: r.contactJobTitle || null,
    }));
  }

  async getQAPairsByTranscript(transcriptId: string): Promise<QAPair[]> {
    return await this.db
      .select()
      .from(qaPairsTable)
      .where(eq(qaPairsTable.transcriptId, transcriptId));
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

  async getQAPairsByCompany(companyId: string): Promise<QAPairWithCategory[]> {
    const results = await this.db
      .select({
        id: qaPairsTable.id,
        transcriptId: qaPairsTable.transcriptId,
        question: qaPairsTable.question,
        answer: qaPairsTable.answer,
        asker: qaPairsTable.asker,
        contactId: qaPairsTable.contactId,
        company: qaPairsTable.company,
        companyId: qaPairsTable.companyId,
        categoryId: qaPairsTable.categoryId,
        categoryName: categoriesTable.name,
        contactName: contactsTable.name,
        contactJobTitle: contactsTable.jobTitle,
        createdAt: qaPairsTable.createdAt,
      })
      .from(qaPairsTable)
      .leftJoin(categoriesTable, eq(qaPairsTable.categoryId, categoriesTable.id))
      .leftJoin(contactsTable, eq(qaPairsTable.contactId, contactsTable.id))
      .where(eq(qaPairsTable.companyId, companyId));
    
    return results;
  }

  // Categories
  async getCategories(): Promise<Category[]> {
    return await this.db
      .select()
      .from(categoriesTable)
      .orderBy(categoriesTable.name);
  }

  async getCategory(id: string): Promise<Category | undefined> {
    const results = await this.db
      .select()
      .from(categoriesTable)
      .where(eq(categoriesTable.id, id))
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
    
    // Then delete the category
    const results = await this.db
      .delete(categoriesTable)
      .where(eq(categoriesTable.id, id))
      .returning();
    return results.length > 0;
  }

  // Companies
  async getCompanies(): Promise<Company[]> {
    return await this.db
      .select()
      .from(companiesTable)
      .orderBy(companiesTable.name);
  }

  async getCompany(id: string): Promise<Company | undefined> {
    const results = await this.db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.id, id))
      .limit(1);
    return results[0];
  }

  async getCompanyBySlug(slug: string): Promise<Company | undefined> {
    const results = await this.db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.slug, slug))
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

  async updateCompany(id: string, name: string, notes?: string | null, companyDescription?: string | null, mainInterestAreas?: string | null, numberOfStores?: string | null): Promise<Company | undefined> {
    const results = await this.db
      .update(companiesTable)
      .set({ 
        name, 
        notes: notes !== undefined ? (notes ?? null) : undefined,
        companyDescription: companyDescription !== undefined ? (companyDescription ?? null) : undefined,
        mainInterestAreas: mainInterestAreas !== undefined ? (mainInterestAreas ?? null) : undefined,
        numberOfStores: numberOfStores !== undefined ? (numberOfStores ?? null) : undefined,
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

  async getCompanyOverview(slug: string): Promise<CompanyOverview | null> {
    const company = await this.getCompanyBySlug(slug);
    if (!company) return null;

    // Get transcripts for this company - match by both companyId and legacy companyName field
    const companyTranscripts = await this.db
      .select()
      .from(transcriptsTable)
      .where(
        drizzleSql`${transcriptsTable.companyId} = ${company.id} OR LOWER(${transcriptsTable.companyName}) = LOWER(${company.name})`
      );

    // Get insights with category names - match by both companyId and legacy company field
    const insights = await this.db
      .select({
        id: productInsightsTable.id,
        transcriptId: productInsightsTable.transcriptId,
        feature: productInsightsTable.feature,
        context: productInsightsTable.context,
        quote: productInsightsTable.quote,
        company: productInsightsTable.company,
        companyId: productInsightsTable.companyId,
        categoryId: productInsightsTable.categoryId,
        categoryName: categoriesTable.name,
        createdAt: productInsightsTable.createdAt,
      })
      .from(productInsightsTable)
      .leftJoin(categoriesTable, eq(productInsightsTable.categoryId, categoriesTable.id))
      .where(
        drizzleSql`${productInsightsTable.companyId} = ${company.id} OR LOWER(${productInsightsTable.company}) = LOWER(${company.name})`
      );

    // Get Q&A pairs with category and contact info - match by both companyId and legacy company field
    const qaPairs = await this.db
      .select({
        id: qaPairsTable.id,
        transcriptId: qaPairsTable.transcriptId,
        question: qaPairsTable.question,
        answer: qaPairsTable.answer,
        asker: qaPairsTable.asker,
        contactId: qaPairsTable.contactId,
        company: qaPairsTable.company,
        companyId: qaPairsTable.companyId,
        categoryId: qaPairsTable.categoryId,
        categoryName: categoriesTable.name,
        contactName: contactsTable.name,
        contactJobTitle: contactsTable.jobTitle,
        createdAt: qaPairsTable.createdAt,
      })
      .from(qaPairsTable)
      .leftJoin(categoriesTable, eq(qaPairsTable.categoryId, categoriesTable.id))
      .leftJoin(contactsTable, eq(qaPairsTable.contactId, contactsTable.id))
      .where(
        drizzleSql`${qaPairsTable.companyId} = ${company.id} OR LOWER(${qaPairsTable.company}) = LOWER(${company.name})`
      );

    // Get contacts for this company
    const contacts = await this.db
      .select()
      .from(contactsTable)
      .where(eq(contactsTable.companyId, company.id));

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
  async getContactsByCompany(companyId: string): Promise<Contact[]> {
    return await this.db
      .select()
      .from(contactsTable)
      .where(eq(contactsTable.companyId, companyId));
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
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async getCategoryOverview(categoryId: string): Promise<CategoryOverview | null> {
    const category = await this.getCategory(categoryId);
    if (!category) return null;

    // Get insights for this category with category names
    const insights = await this.db
      .select({
        id: productInsightsTable.id,
        transcriptId: productInsightsTable.transcriptId,
        feature: productInsightsTable.feature,
        context: productInsightsTable.context,
        quote: productInsightsTable.quote,
        company: productInsightsTable.company,
        companyId: productInsightsTable.companyId,
        categoryId: productInsightsTable.categoryId,
        categoryName: categoriesTable.name,
        createdAt: productInsightsTable.createdAt,
      })
      .from(productInsightsTable)
      .leftJoin(categoriesTable, eq(productInsightsTable.categoryId, categoriesTable.id))
      .where(eq(productInsightsTable.categoryId, categoryId));

    // Get Q&A pairs for this category with category and contact info
    const qaPairs = await this.db
      .select({
        id: qaPairsTable.id,
        transcriptId: qaPairsTable.transcriptId,
        question: qaPairsTable.question,
        answer: qaPairsTable.answer,
        asker: qaPairsTable.asker,
        contactId: qaPairsTable.contactId,
        company: qaPairsTable.company,
        companyId: qaPairsTable.companyId,
        categoryId: qaPairsTable.categoryId,
        categoryName: categoriesTable.name,
        contactName: contactsTable.name,
        contactJobTitle: contactsTable.jobTitle,
        createdAt: qaPairsTable.createdAt,
      })
      .from(qaPairsTable)
      .leftJoin(categoriesTable, eq(qaPairsTable.categoryId, categoriesTable.id))
      .leftJoin(contactsTable, eq(qaPairsTable.contactId, contactsTable.id))
      .where(eq(qaPairsTable.categoryId, categoryId));

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
}

export const storage = new DbStorage();
