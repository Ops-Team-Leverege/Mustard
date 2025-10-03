import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { analyzeTranscript } from "./transcriptAnalyzer";
import {
  insertTranscriptSchema,
  insertCategorySchema,
  insertCompanySchema,
  insertContactSchema,
  type ProductInsightWithCategory,
} from "@shared/schema";
import { z } from "zod";
import { randomUUID } from "crypto";
// From Replit Auth integration (blueprint:javascript_log_in_with_replit)
import { setupAuth, isAuthenticated } from "./replitAuth";

function generateSlug(companyName: string): string {
  const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  // If slug is empty (no alphanumerics in name), use a uuid suffix
  return slug || `company-${randomUUID().split('-')[0]}`;
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware (from Replit Auth integration - blueprint:javascript_log_in_with_replit)
  await setupAuth(app);

  // Auth routes (from Replit Auth integration - blueprint:javascript_log_in_with_replit)
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      
      // Email domain restriction: only allow leverege.com
      if (!user?.email) {
        return res.status(403).json({ 
          message: "Email required. Only leverege.com email addresses are allowed.",
          code: "DOMAIN_RESTRICTED"
        });
      }
      
      const emailDomain = user.email.split('@')[1]?.toLowerCase();
      if (emailDomain !== 'leverege.com') {
        return res.status(403).json({ 
          message: "Access denied. Only leverege.com email addresses are allowed.",
          code: "DOMAIN_RESTRICTED"
        });
      }
      
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Transcripts (protected routes)
  app.post("/api/transcripts", isAuthenticated, async (req, res) => {
    try {
      const validatedData = insertTranscriptSchema.parse(req.body);
      const data = validatedData as typeof validatedData & { customers?: Array<{ name: string; nameInTranscript?: string; jobTitle?: string }> };
      
      // Find or create company
      const slug = generateSlug(data.companyName);
      let company = await storage.getCompanyBySlug(slug);
      
      if (!company) {
        company = await storage.createCompany({
          name: data.companyName,
          slug,
          notes: null,
          companyDescription: data.companyDescription || null,
          mainInterestAreas: data.mainInterestAreas || null,
          numberOfStores: data.numberOfStores || null,
        });
      }
      
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
      
      // Only create transcript after successful analysis, including companyId
      const transcript = await storage.createTranscript({
        ...data,
        companyId: company.id,
      });
      
      // Create contact records first from validated customers array
      const contacts = [];
      if (data.customers && Array.isArray(data.customers)) {
        for (const customer of data.customers) {
          const contact = await storage.createContact({
            name: customer.name,
            nameInTranscript: customer.nameInTranscript || null,
            jobTitle: customer.jobTitle || null,
            companyId: company.id,
          });
          contacts.push(contact);
        }
      }

      // Get all existing contacts for this company to match with Q&A askers
      const allContacts = await storage.getContactsByCompany(company.id);
      
      // Save insights with companyId
      const insights = await storage.createProductInsights(
        analysis.insights.map(insight => ({
          transcriptId: transcript.id,
          feature: insight.feature,
          context: insight.context,
          quote: insight.quote,
          company: data.companyName,
          companyId: company.id,
          categoryId: insight.categoryId,
        }))
      );
      
      // Save Q&A pairs with companyId and matched contactId
      const qaPairs = await storage.createQAPairs(
        analysis.qaPairs.map(qa => {
          // Try to match asker name to a contact (case-insensitive)
          // Use nameInTranscript if available, otherwise use name
          const matchedContact = allContacts.find(contact => {
            const askerName = qa.asker.toLowerCase().trim();
            const nameInTranscript = contact.nameInTranscript?.toLowerCase().trim();
            const contactName = contact.name.toLowerCase().trim();
            
            // If nameInTranscript is provided, match against it; otherwise match against name
            return nameInTranscript ? nameInTranscript === askerName : contactName === askerName;
          });
          
          return {
            transcriptId: transcript.id,
            question: qa.question,
            answer: qa.answer,
            asker: qa.asker,
            contactId: matchedContact?.id || null,
            company: data.companyName,
            companyId: company.id,
            categoryId: qa.categoryId,
          };
        })
      );
      
      res.json({
        transcript,
        insights,
        qaPairs,
        contacts,
        company: {
          id: company.id,
          name: company.name,
          slug: company.slug,
        },
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

  app.get("/api/transcripts", isAuthenticated, async (_req, res) => {
    try {
      const transcripts = await storage.getTranscripts();
      res.json(transcripts);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.get("/api/companies/:companyId/transcripts", isAuthenticated, async (req, res) => {
    try {
      const { companyId } = req.params;
      const transcripts = await storage.getTranscriptsByCompany(companyId);
      res.json(transcripts);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.patch("/api/transcripts/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, createdAt } = req.body;
      const transcript = await storage.updateTranscript(id, { 
        name: name !== undefined ? (name || null) : undefined,
        createdAt: createdAt !== undefined ? new Date(createdAt) : undefined,
      });
      if (!transcript) {
        return res.status(404).json({ error: "Transcript not found" });
      }
      res.json(transcript);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.delete("/api/transcripts/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.deleteTranscript(id);
      
      if (!success) {
        return res.status(404).json({ error: "Transcript not found" });
      }
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.get("/api/transcripts/:id/details", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const transcript = await storage.getTranscript(id);
      
      if (!transcript) {
        return res.status(404).json({ error: "Transcript not found" });
      }

      const [insights, qaPairs, company] = await Promise.all([
        storage.getProductInsightsByTranscript(id),
        storage.getQAPairsByTranscript(id),
        transcript.companyId ? storage.getCompany(transcript.companyId) : Promise.resolve(undefined),
      ]);

      res.json({
        transcript,
        insights,
        qaPairs,
        company,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  // Product Insights
  app.get("/api/insights", isAuthenticated, async (_req, res) => {
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

  app.patch("/api/insights/:id/category", isAuthenticated, async (req, res) => {
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

  app.patch("/api/insights/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const { feature, context, quote, company } = req.body;
      
      if (!feature || !context || !quote || !company) {
        res.status(400).json({ error: "Feature, context, quote, and company are required" });
        return;
      }
      
      // Find or create company to get companyId
      const slug = generateSlug(company);
      let companyRecord = await storage.getCompanyBySlug(slug);
      
      if (!companyRecord) {
        companyRecord = await storage.createCompany({
          name: company,
          slug,
          notes: null,
        });
      }
      
      const insight = await storage.updateProductInsight(id, feature, context, quote, company, companyRecord.id);
      
      if (!insight) {
        res.status(404).json({ error: "Insight not found" });
        return;
      }
      
      res.json(insight);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.delete("/api/insights/:id", isAuthenticated, async (req, res) => {
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

  app.post("/api/insights", isAuthenticated, async (req, res) => {
    try {
      const { feature, context, quote, company, categoryId } = req.body;
      
      if (!feature || !context || !quote || !company) {
        res.status(400).json({ error: "Feature, context, quote, and company are required" });
        return;
      }
      
      // Find or create company
      const slug = generateSlug(company);
      let companyRecord = await storage.getCompanyBySlug(slug);
      
      if (!companyRecord) {
        companyRecord = await storage.createCompany({
          name: company,
          slug,
          notes: null,
        });
      }
      
      const insight = await storage.createProductInsight({
        transcriptId: null,
        feature,
        context,
        quote,
        company,
        companyId: companyRecord.id,
        categoryId: categoryId || null,
      });
      
      res.json(insight);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  // Q&A Pairs
  app.get("/api/qa-pairs", isAuthenticated, async (_req, res) => {
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

  app.patch("/api/qa-pairs/:id/category", isAuthenticated, async (req, res) => {
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

  app.patch("/api/qa-pairs/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const { question, answer, asker, company, contactId } = req.body;
      
      if (!question || !answer || !asker || !company) {
        res.status(400).json({ error: "Question, answer, asker, and company are required" });
        return;
      }
      
      // Find or create company to get companyId
      const slug = generateSlug(company);
      let companyRecord = await storage.getCompanyBySlug(slug);
      
      if (!companyRecord) {
        companyRecord = await storage.createCompany({
          name: company,
          slug,
          notes: null,
        });
      }
      
      const qaPair = await storage.updateQAPair(id, question, answer, asker, company, companyRecord.id, contactId);
      
      if (!qaPair) {
        res.status(404).json({ error: "Q&A pair not found" });
        return;
      }
      
      res.json(qaPair);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.delete("/api/qa-pairs/:id", isAuthenticated, async (req, res) => {
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

  app.post("/api/qa-pairs", isAuthenticated, async (req, res) => {
    try {
      const { question, answer, asker, company, categoryId, contactId } = req.body;
      
      if (!question || !answer || !asker || !company) {
        res.status(400).json({ error: "Question, answer, asker, and company are required" });
        return;
      }
      
      // Find or create company
      const slug = generateSlug(company);
      let companyRecord = await storage.getCompanyBySlug(slug);
      
      if (!companyRecord) {
        companyRecord = await storage.createCompany({
          name: company,
          slug,
          notes: null,
        });
      }
      
      const qaPair = await storage.createQAPair({
        transcriptId: null,
        question,
        answer,
        asker,
        contactId: contactId || null,
        company,
        companyId: companyRecord.id,
        categoryId: categoryId || null,
      });
      
      res.json(qaPair);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  // Categories
  app.get("/api/categories", isAuthenticated, async (_req, res) => {
    try {
      const categories = await storage.getCategories();
      
      // Add usage count for insights in each category
      const insights = await storage.getProductInsights();
      const insightUsage = new Map<string, number>();
      
      insights.forEach(insight => {
        if (insight.categoryId) {
          insightUsage.set(
            insight.categoryId,
            (insightUsage.get(insight.categoryId) || 0) + 1
          );
        }
      });
      
      // Add Q&A pair count for each category
      const qaPairs = await storage.getQAPairs();
      const qaUsage = new Map<string, number>();
      
      qaPairs.forEach(qa => {
        if (qa.categoryId) {
          qaUsage.set(
            qa.categoryId,
            (qaUsage.get(qa.categoryId) || 0) + 1
          );
        }
      });
      
      const categoriesWithCount = categories.map(cat => ({
        ...cat,
        usageCount: insightUsage.get(cat.id) || 0,
        qaCount: qaUsage.get(cat.id) || 0,
      }));
      
      res.json(categoriesWithCount);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.post("/api/categories", isAuthenticated, async (req, res) => {
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

  app.patch("/api/categories/:id", isAuthenticated, async (req, res) => {
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

  app.delete("/api/categories/:id", isAuthenticated, async (req, res) => {
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

  app.get("/api/categories/:id/overview", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const overview = await storage.getCategoryOverview(id);
      
      if (!overview) {
        res.status(404).json({ error: "Category not found" });
        return;
      }
      
      res.json(overview);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  // Companies
  app.get("/api/companies", isAuthenticated, async (req, res) => {
    try {
      const companies = await storage.getCompanies();
      res.json(companies);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.get("/api/dashboard/stats", isAuthenticated, async (_req, res) => {
    try {
      const companies = await storage.getCompanies();
      const stageStats = companies.reduce((acc, company) => {
        const stage = company.stage || 'Unknown';
        acc[stage] = (acc[stage] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      res.json({ stageStats });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.get("/api/dashboard/recent-transcripts", isAuthenticated, async (_req, res) => {
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const allTranscripts = await storage.getTranscripts();
      const recentTranscripts = allTranscripts
        .filter(t => new Date(t.createdAt) >= sevenDaysAgo)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10);

      res.json(recentTranscripts);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.get("/api/companies/:slug", isAuthenticated, async (req, res) => {
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

  app.get("/api/companies/:slug/overview", isAuthenticated, async (req, res) => {
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

  app.post("/api/companies", isAuthenticated, async (req, res) => {
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

  app.patch("/api/companies/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, notes, companyDescription, mainInterestAreas, numberOfStores, stage, pilotStartDate } = req.body;
      
      if (!name || typeof name !== 'string') {
        res.status(400).json({ error: "Name is required" });
        return;
      }
      
      const pilotStartDateValue = pilotStartDate ? new Date(pilotStartDate) : null;
      
      const company = await storage.updateCompany(id, name, notes, companyDescription, mainInterestAreas, numberOfStores, stage, pilotStartDateValue);
      
      if (!company) {
        res.status(404).json({ error: "Company not found" });
        return;
      }
      
      await storage.updateCompanyNameInRelatedRecords(id, name);
      
      res.json(company);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.delete("/api/companies/:id", isAuthenticated, async (req, res) => {
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

  // Contacts
  app.get("/api/contacts/company/:companyId", isAuthenticated, async (req, res) => {
    try {
      const { companyId } = req.params;
      const contacts = await storage.getContactsByCompany(companyId);
      res.json(contacts);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.post("/api/contacts", isAuthenticated, async (req, res) => {
    try {
      const data = insertContactSchema.parse(req.body);
      const contact = await storage.createContact(data);
      res.json(contact);
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

  app.patch("/api/contacts/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, nameInTranscript, jobTitle } = req.body;
      
      if (!name) {
        res.status(400).json({ error: "Name is required" });
        return;
      }
      
      const contact = await storage.updateContact(id, name, nameInTranscript, jobTitle);
      
      if (!contact) {
        res.status(404).json({ error: "Contact not found" });
        return;
      }
      
      res.json(contact);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.delete("/api/contacts/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.deleteContact(id);
      
      if (!success) {
        res.status(404).json({ error: "Contact not found" });
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
