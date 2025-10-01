import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { analyzeTranscript } from "./transcriptAnalyzer";
import {
  insertTranscriptSchema,
  insertCategorySchema,
  insertCompanySchema,
  type ProductInsightWithCategory,
} from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(app: Express): Promise<Server> {
  // Transcripts
  app.post("/api/transcripts", async (req, res) => {
    try {
      const data = insertTranscriptSchema.parse(req.body);
      
      // Analyze with AI first (before persisting transcript)
      const categories = await storage.getCategories();
      const leverageTeam = data.leverageTeam.split(',').map(s => s.trim()).filter(s => s);
      const customerNames = data.customerNames.split(',').map(s => s.trim()).filter(s => s);
      
      const analysis = await analyzeTranscript({
        transcript: data.transcript,
        companyName: data.companyName,
        leverageTeam,
        customerNames,
        categories,
      });
      
      // Only create transcript after successful analysis
      const transcript = await storage.createTranscript(data);
      
      // Save insights
      const insights = await storage.createProductInsights(
        analysis.insights.map(insight => ({
          transcriptId: transcript.id,
          feature: insight.feature,
          context: insight.context,
          quote: insight.quote,
          company: data.companyName,
          categoryId: insight.categoryId,
        }))
      );
      
      // Save Q&A pairs
      const qaPairs = await storage.createQAPairs(
        analysis.qaPairs.map(qa => ({
          transcriptId: transcript.id,
          question: qa.question,
          answer: qa.answer,
          asker: qa.asker,
          company: data.companyName,
        }))
      );
      
      res.json({
        transcript,
        insights,
        qaPairs,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else if (error instanceof Error) {
        res.status(500).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Unknown error occurred" });
      }
    }
  });

  app.get("/api/transcripts", async (_req, res) => {
    try {
      const transcripts = await storage.getTranscripts();
      res.json(transcripts);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  // Product Insights
  app.get("/api/insights", async (_req, res) => {
    try {
      const insights = await storage.getProductInsights();
      
      // Add usage count for each category
      const categories = await storage.getCategories();
      const categoryUsage = new Map<string, number>();
      
      insights.forEach(insight => {
        if (insight.categoryId) {
          categoryUsage.set(
            insight.categoryId,
            (categoryUsage.get(insight.categoryId) || 0) + 1
          );
        }
      });
      
      const enrichedInsights: Array<ProductInsightWithCategory & { categoryUsageCount?: number }> = insights.map(insight => ({
        ...insight,
        categoryUsageCount: insight.categoryId ? categoryUsage.get(insight.categoryId) : undefined,
      }));
      
      res.json(enrichedInsights);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.patch("/api/insights/:id/category", async (req, res) => {
    try {
      const { id } = req.params;
      const { categoryId } = req.body;
      
      // Validate categoryId if provided
      if (categoryId !== null && typeof categoryId !== 'string') {
        res.status(400).json({ error: "Invalid categoryId" });
        return;
      }
      
      if (categoryId) {
        const category = await storage.getCategory(categoryId);
        if (!category) {
          res.status(400).json({ error: "Category not found" });
          return;
        }
      }
      
      const success = await storage.assignCategoryToInsight(id, categoryId);
      
      if (!success) {
        res.status(404).json({ error: "Insight not found" });
        return;
      }
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.patch("/api/insights/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { feature, context, quote } = req.body;
      
      if (!feature || !context || !quote) {
        res.status(400).json({ error: "Feature, context, and quote are required" });
        return;
      }
      
      const insight = await storage.updateProductInsight(id, feature, context, quote);
      
      if (!insight) {
        res.status(404).json({ error: "Insight not found" });
        return;
      }
      
      res.json(insight);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.delete("/api/insights/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.deleteProductInsight(id);
      
      if (!success) {
        res.status(404).json({ error: "Insight not found" });
        return;
      }
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.post("/api/insights", async (req, res) => {
    try {
      const { feature, context, quote, company, categoryId } = req.body;
      
      if (!feature || !context || !quote || !company) {
        res.status(400).json({ error: "Feature, context, quote, and company are required" });
        return;
      }
      
      const insight = await storage.createProductInsight({
        transcriptId: null,
        feature,
        context,
        quote,
        company,
        categoryId: categoryId || null,
      });
      
      res.json(insight);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  // Q&A Pairs
  app.get("/api/qa-pairs", async (_req, res) => {
    try {
      const qaPairs = await storage.getQAPairs();
      
      // Add usage count for each category (for consistency with insights)
      const categories = await storage.getCategories();
      const categoryUsage = new Map<string, number>();
      
      qaPairs.forEach(qa => {
        if (qa.categoryId) {
          categoryUsage.set(
            qa.categoryId,
            (categoryUsage.get(qa.categoryId) || 0) + 1
          );
        }
      });
      
      res.json(qaPairs);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.patch("/api/qa-pairs/:id/category", async (req, res) => {
    try {
      const { id } = req.params;
      const { categoryId } = req.body;
      
      // Validate categoryId if provided
      if (categoryId !== null && typeof categoryId !== 'string') {
        res.status(400).json({ error: "Invalid categoryId" });
        return;
      }
      
      if (categoryId) {
        const category = await storage.getCategory(categoryId);
        if (!category) {
          res.status(400).json({ error: "Category not found" });
          return;
        }
      }
      
      const success = await storage.assignCategoryToQAPair(id, categoryId);
      
      if (!success) {
        res.status(404).json({ error: "Q&A pair not found" });
        return;
      }
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.patch("/api/qa-pairs/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { question, answer, asker } = req.body;
      
      if (!question || !answer || !asker) {
        res.status(400).json({ error: "Question, answer, and asker are required" });
        return;
      }
      
      const qaPair = await storage.updateQAPair(id, question, answer, asker);
      
      if (!qaPair) {
        res.status(404).json({ error: "Q&A pair not found" });
        return;
      }
      
      res.json(qaPair);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.delete("/api/qa-pairs/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.deleteQAPair(id);
      
      if (!success) {
        res.status(404).json({ error: "Q&A pair not found" });
        return;
      }
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.post("/api/qa-pairs", async (req, res) => {
    try {
      const { question, answer, asker, company, categoryId } = req.body;
      
      if (!question || !answer || !asker || !company) {
        res.status(400).json({ error: "Question, answer, asker, and company are required" });
        return;
      }
      
      const qaPair = await storage.createQAPair({
        transcriptId: null,
        question,
        answer,
        asker,
        company,
        categoryId: categoryId || null,
      });
      
      res.json(qaPair);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  // Categories
  app.get("/api/categories", async (_req, res) => {
    try {
      const categories = await storage.getCategories();
      
      // Add usage count for each category
      const insights = await storage.getProductInsights();
      const categoryUsage = new Map<string, number>();
      
      insights.forEach(insight => {
        if (insight.categoryId) {
          categoryUsage.set(
            insight.categoryId,
            (categoryUsage.get(insight.categoryId) || 0) + 1
          );
        }
      });
      
      const categoriesWithCount = categories.map(cat => ({
        ...cat,
        usageCount: categoryUsage.get(cat.id) || 0,
      }));
      
      res.json(categoriesWithCount);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.post("/api/categories", async (req, res) => {
    try {
      const data = insertCategorySchema.parse(req.body);
      const category = await storage.createCategory(data);
      res.json(category);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else if (error instanceof Error) {
        res.status(500).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Unknown error occurred" });
      }
    }
  });

  app.patch("/api/categories/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description } = req.body;
      
      if (!name || typeof name !== 'string') {
        res.status(400).json({ error: "Name is required" });
        return;
      }
      
      const category = await storage.updateCategory(id, name, description);
      
      if (!category) {
        res.status(404).json({ error: "Category not found" });
        return;
      }
      
      res.json(category);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.delete("/api/categories/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.deleteCategory(id);
      
      if (!success) {
        res.status(404).json({ error: "Category not found" });
        return;
      }
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  // Companies
  app.get("/api/companies", async (req, res) => {
    try {
      const companies = await storage.getCompanies();
      res.json(companies);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.get("/api/companies/:slug", async (req, res) => {
    try {
      const { slug } = req.params;
      const company = await storage.getCompanyBySlug(slug);
      
      if (!company) {
        res.status(404).json({ error: "Company not found" });
        return;
      }
      
      res.json(company);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.get("/api/companies/:slug/overview", async (req, res) => {
    try {
      const { slug } = req.params;
      const overview = await storage.getCompanyOverview(slug);
      
      if (!overview) {
        res.status(404).json({ error: "Company not found" });
        return;
      }
      
      res.json(overview);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.post("/api/companies", async (req, res) => {
    try {
      const data = insertCompanySchema.parse(req.body);
      const company = await storage.createCompany(data);
      res.json(company);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else if (error instanceof Error) {
        res.status(500).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Unknown error occurred" });
      }
    }
  });

  app.patch("/api/companies/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { name, notes } = req.body;
      
      if (!name || typeof name !== 'string') {
        res.status(400).json({ error: "Name is required" });
        return;
      }
      
      const company = await storage.updateCompany(id, name, notes);
      
      if (!company) {
        res.status(404).json({ error: "Company not found" });
        return;
      }
      
      res.json(company);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.delete("/api/companies/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.deleteCompany(id);
      
      if (!success) {
        res.status(404).json({ error: "Company not found" });
        return;
      }
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
