import {
  type Transcript,
  type InsertTranscript,
  type ProductInsight,
  type ProductInsightWithCategory,
  type InsertProductInsight,
  type QAPair,
  type InsertQAPair,
  type Category,
  type InsertCategory,
} from "@shared/schema";
import { randomUUID } from "crypto";

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
  assignCategoryToInsight(insightId: string, categoryId: string | null): Promise<boolean>;
  assignCategoryToInsights(insightIds: string[], categoryId: string | null): Promise<boolean>;

  // Q&A Pairs
  getQAPairs(): Promise<QAPair[]>;
  getQAPairsByTranscript(transcriptId: string): Promise<QAPair[]>;
  createQAPair(qaPair: InsertQAPair): Promise<QAPair>;
  createQAPairs(qaPairs: InsertQAPair[]): Promise<QAPair[]>;

  // Categories
  getCategories(): Promise<Category[]>;
  getCategory(id: string): Promise<Category | undefined>;
  createCategory(category: InsertCategory): Promise<Category>;
  updateCategory(id: string, name: string, description?: string | null): Promise<Category | undefined>;
  deleteCategory(id: string): Promise<boolean>;
}

export class MemStorage implements IStorage {
  private transcripts: Map<string, Transcript>;
  private productInsights: Map<string, ProductInsight>;
  private qaPairs: Map<string, QAPair>;
  private categories: Map<string, Category>;

  constructor() {
    this.transcripts = new Map();
    this.productInsights = new Map();
    this.qaPairs = new Map();
    this.categories = new Map();

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
    // Validate transcript exists
    if (!this.transcripts.has(insertInsight.transcriptId)) {
      throw new Error(`Transcript ${insertInsight.transcriptId} not found`);
    }
    
    // Validate category exists if provided
    if (insertInsight.categoryId && !this.categories.has(insertInsight.categoryId)) {
      throw new Error(`Category ${insertInsight.categoryId} not found`);
    }
    
    const id = randomUUID();
    const insight: ProductInsight = {
      ...insertInsight,
      categoryId: insertInsight.categoryId ?? null,
      id,
    };
    this.productInsights.set(id, insight);
    return insight;
  }

  async createProductInsights(insertInsights: InsertProductInsight[]): Promise<ProductInsight[]> {
    // Validate all first (atomicity)
    for (const insertInsight of insertInsights) {
      if (!this.transcripts.has(insertInsight.transcriptId)) {
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
        categoryId: insertInsight.categoryId ?? null,
        id,
      };
      this.productInsights.set(id, insight);
      return insight;
    });
    return insights;
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

  // Q&A Pairs
  async getQAPairs(): Promise<QAPair[]> {
    return Array.from(this.qaPairs.values());
  }

  async getQAPairsByTranscript(transcriptId: string): Promise<QAPair[]> {
    return Array.from(this.qaPairs.values()).filter(
      qa => qa.transcriptId === transcriptId
    );
  }

  async createQAPair(insertQAPair: InsertQAPair): Promise<QAPair> {
    // Validate transcript exists
    if (!this.transcripts.has(insertQAPair.transcriptId)) {
      throw new Error(`Transcript ${insertQAPair.transcriptId} not found`);
    }
    
    const id = randomUUID();
    const qaPair: QAPair = {
      ...insertQAPair,
      id,
    };
    this.qaPairs.set(id, qaPair);
    return qaPair;
  }

  async createQAPairs(insertQAPairs: InsertQAPair[]): Promise<QAPair[]> {
    // Validate all first (atomicity)
    for (const insertQAPair of insertQAPairs) {
      if (!this.transcripts.has(insertQAPair.transcriptId)) {
        throw new Error(`Transcript ${insertQAPair.transcriptId} not found`);
      }
    }
    
    // All validated, now create
    const qaPairs: QAPair[] = insertQAPairs.map(insertQAPair => {
      const id = randomUUID();
      const qaPair: QAPair = {
        ...insertQAPair,
        id,
      };
      this.qaPairs.set(id, qaPair);
      return qaPair;
    });
    return qaPairs;
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
}

export const storage = new MemStorage();
