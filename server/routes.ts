import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { analyzeTranscript } from "./transcriptAnalyzer";
import { extractTextFromFile, extractTextFromUrl } from "./textExtractor";
import multer from "multer";
import {
  insertTranscriptSchema,
  insertCategorySchema,
  insertFeatureSchema,
  insertCompanySchema,
  insertContactSchema,
  insertPOSSystemSchema,
  type ProductInsightWithCategory,
  type Product,
  PRODUCTS,
} from "@shared/schema";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import { randomUUID } from "crypto";
// From Replit Auth integration (blueprint:javascript_log_in_with_replit)
import { setupAuth, isAuthenticated } from "./replitAuth";

// Configure multer for file uploads (store in memory)
const upload = multer({ storage: multer.memoryStorage() });

function generateSlug(companyName: string): string {
  const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  // If slug is empty (no alphanumerics in name), use a uuid suffix
  return slug || `company-${randomUUID().split('-')[0]}`;
}

// Helper function to get current user and their selected product
async function getUserAndProduct(req: any): Promise<{ userId: string; user: any; product: Product }> {
  const userId = req.user.claims.sub;
  const user = await storage.getUser(userId);
  
  if (!user) {
    throw new Error("User not found");
  }
  
  // User's current product defaults to PitCrew if not set
  const product = (user.currentProduct as Product) || 'PitCrew';
  
  return { userId, user, product };
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

  // Product management routes
  app.get('/api/products', isAuthenticated, async (req: any, res) => {
    try {
      // Return list of available products
      res.json({ products: PRODUCTS });
    } catch (error) {
      console.error("Error fetching products:", error);
      res.status(500).json({ message: "Failed to fetch products" });
    }
  });

  app.put('/api/user/product', isAuthenticated, async (req: any, res) => {
    try {
      const { product } = req.body;
      
      // Validate product
      if (!PRODUCTS.includes(product)) {
        return res.status(400).json({ message: "Invalid product" });
      }
      
      const { userId } = await getUserAndProduct(req);
      const updatedUser = await storage.updateUserProduct(userId, product);
      
      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      res.json(updatedUser);
    } catch (error) {
      console.error("Error updating user product:", error);
      res.status(500).json({ message: "Failed to update product" });
    }
  });

  // Transcripts (protected routes)
  app.post("/api/transcripts", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const body = { ...req.body };
      // Convert createdAt string to Date if provided
      if (body.createdAt && typeof body.createdAt === 'string') {
        body.createdAt = new Date(body.createdAt);
      }
      
      const validatedData = insertTranscriptSchema.parse(body);
      const data = validatedData as typeof validatedData & { customers?: Array<{ name: string; nameInTranscript?: string; jobTitle?: string }> };
      
      // Find or create company - check by name first to prevent duplicates
      let company = await storage.getCompanyByName(product, data.companyName);
      
      if (!company) {
        // Generate slug and create company
        const slug = generateSlug(data.companyName);
        company = await storage.createCompany({
          name: data.companyName,
          slug,
          notes: null,
          companyDescription: data.companyDescription || null,
          numberOfStores: data.numberOfStores || null,
          product,
        });
      }
      
      // Analyze with AI first (before persisting transcript)
      const categories = await storage.getCategories(product);
      const leverageTeam = data.leverageTeam.split(',').map(s => s.trim()).filter(s => s);
      const customerNames = data.customerNames.split(',').map(s => s.trim()).filter(s => s);
      
      // For notes mode, use mainMeetingTakeaways as the content to analyze
      const contentToAnalyze = data.contentType === "notes" 
        ? (data.mainMeetingTakeaways || '')
        : (data.transcript || '');
      
      const analysis = await analyzeTranscript({
        transcript: contentToAnalyze,
        supportingMaterials: data.supportingMaterials,
        companyName: data.companyName,
        leverageTeam,
        customerNames,
        categories,
        contentType: data.contentType,
      });
      
      // Only create transcript after successful analysis, including companyId
      const transcript = await storage.createTranscript({
        ...data,
        companyId: company.id,
        product,
      });
      
      // Get all existing contacts for this company first
      const existingContacts = await storage.getContactsByCompany(product, company.id);
      
      // Create or reuse contact records from validated customers array
      const contacts = [];
      if (data.customers && Array.isArray(data.customers)) {
        for (const customer of data.customers) {
          const customerNameLower = customer.name.toLowerCase().trim();
          
          // Check if contact already exists by matching against both name and nameInTranscript (case-insensitive)
          const existingContact = existingContacts.find(c => {
            const contactNameLower = c.name.toLowerCase().trim();
            const nameInTranscriptLower = c.nameInTranscript?.toLowerCase().trim();
            
            // Match if customer name matches either the contact's name or nameInTranscript
            return contactNameLower === customerNameLower || 
                   (nameInTranscriptLower && nameInTranscriptLower === customerNameLower);
          });
          
          if (existingContact) {
            // Reuse existing contact
            contacts.push(existingContact);
          } else {
            // Create new contact only if it doesn't exist
            const contact = await storage.createContact({
              name: customer.name,
              nameInTranscript: customer.nameInTranscript || null,
              jobTitle: customer.jobTitle || null,
              companyId: company.id,
              product,
            });
            contacts.push(contact);
            existingContacts.push(contact); // Add to list for Q&A matching below
          }
        }
      }

      // Use all contacts (existing + newly created) for Q&A matching
      const allContacts = existingContacts;
      
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
          product,
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
            product,
          };
        })
      );
      
      // Handle POS system detection and linking
      let posSystem = null;
      if (analysis.posSystem) {
        posSystem = await storage.findOrCreatePOSSystemAndLink(
          product,
          analysis.posSystem.name,
          company.id,
          analysis.posSystem.websiteLink,
          analysis.posSystem.description
        );
        console.log(`POS system detected and linked: ${posSystem.name} -> ${company.name}`);
      }
      
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
        posSystem,
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

  app.get("/api/transcripts", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const transcripts = await storage.getTranscripts(product);
      res.json(transcripts);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.get("/api/companies/:companyId/transcripts", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const { companyId } = req.params;
      const transcripts = await storage.getTranscriptsByCompany(product, companyId);
      res.json(transcripts);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.patch("/api/transcripts/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, createdAt, mainMeetingTakeaways, transcript } = req.body;
      const updatedTranscript = await storage.updateTranscript(id, { 
        name: name !== undefined ? (name || null) : undefined,
        createdAt: createdAt !== undefined ? new Date(createdAt) : undefined,
        mainMeetingTakeaways: mainMeetingTakeaways !== undefined ? (mainMeetingTakeaways || null) : undefined,
        transcript: transcript !== undefined ? (transcript || null) : undefined,
      });
      if (!updatedTranscript) {
        return res.status(404).json({ error: "Transcript not found" });
      }
      res.json(updatedTranscript);
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
      console.error("Error deleting transcript:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.get("/api/transcripts/:id/details", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const { id } = req.params;
      const transcript = await storage.getTranscript(product, id);
      
      if (!transcript) {
        return res.status(404).json({ error: "Transcript not found" });
      }

      const [insights, qaPairs, company] = await Promise.all([
        storage.getProductInsightsByTranscript(product, id),
        storage.getQAPairsByTranscript(product, id),
        transcript.companyId ? storage.getCompany(product, transcript.companyId) : Promise.resolve(undefined),
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
  app.get("/api/insights", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const insights = await storage.getProductInsights(product);
      
      // Add usage count for each category
      const categories = await storage.getCategories(product);
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

  app.patch("/api/insights/:id/category", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const { id } = req.params;
      const { categoryId } = req.body;
      
      // Validate categoryId if provided
      if (categoryId !== null && typeof categoryId !== 'string') {
        res.status(400).json({ error: "Invalid categoryId" });
        return;
      }
      
      if (categoryId) {
        const category = await storage.getCategory(product, categoryId);
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

  app.patch("/api/insights/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const { id } = req.params;
      const { feature, context, quote, company } = req.body;
      
      if (!feature || !context || !quote || !company) {
        res.status(400).json({ error: "Feature, context, quote, and company are required" });
        return;
      }
      
      // Find or create company to get companyId
      const slug = generateSlug(company);
      let companyRecord = await storage.getCompanyBySlug(product, slug);
      
      if (!companyRecord) {
        companyRecord = await storage.createCompany({
          name: company,
          slug,
          notes: null,
          product,
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

  app.post("/api/insights", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const { feature, context, quote, company, categoryId } = req.body;
      
      if (!feature || !context || !quote || !company) {
        res.status(400).json({ error: "Feature, context, quote, and company are required" });
        return;
      }
      
      // Find or create company
      const slug = generateSlug(company);
      let companyRecord = await storage.getCompanyBySlug(product, slug);
      
      if (!companyRecord) {
        companyRecord = await storage.createCompany({
          name: company,
          slug,
          notes: null,
          product,
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
        product,
      });
      
      res.json(insight);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  // Q&A Pairs
  app.get("/api/qa-pairs", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const qaPairs = await storage.getQAPairs(product);
      
      // Add usage count for each category (for consistency with insights)
      const categories = await storage.getCategories(product);
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

  app.patch("/api/qa-pairs/:id/category", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const { id } = req.params;
      const { categoryId } = req.body;
      
      // Validate categoryId if provided
      if (categoryId !== null && typeof categoryId !== 'string') {
        res.status(400).json({ error: "Invalid categoryId" });
        return;
      }
      
      if (categoryId) {
        const category = await storage.getCategory(product, categoryId);
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

  app.patch("/api/qa-pairs/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const { id } = req.params;
      const { question, answer, asker, company, contactId } = req.body;
      
      if (!question || !answer || !asker || !company) {
        res.status(400).json({ error: "Question, answer, asker, and company are required" });
        return;
      }
      
      // Find or create company to get companyId
      const slug = generateSlug(company);
      let companyRecord = await storage.getCompanyBySlug(product, slug);
      
      if (!companyRecord) {
        companyRecord = await storage.createCompany({
          name: company,
          slug,
          notes: null,
          product,
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

  app.patch("/api/qa-pairs/:id/star", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const { isStarred } = req.body;
      
      const qaPair = await storage.toggleQAPairStar(id, isStarred);
      
      if (!qaPair) {
        res.status(404).json({ error: "Q&A pair not found" });
        return;
      }
      
      res.json(qaPair);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.post("/api/qa-pairs", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const { question, answer, asker, company, categoryId, contactId } = req.body;
      
      if (!question || !answer || !asker || !company) {
        res.status(400).json({ error: "Question, answer, asker, and company are required" });
        return;
      }
      
      // Find or create company
      const slug = generateSlug(company);
      let companyRecord = await storage.getCompanyBySlug(product, slug);
      
      if (!companyRecord) {
        companyRecord = await storage.createCompany({
          name: company,
          slug,
          notes: null,
          product,
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
        product,
      });
      
      res.json(qaPair);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  // File upload and text extraction
  app.post("/api/extract-text-from-file", isAuthenticated, upload.single('file'), async (req: any, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const text = await extractTextFromFile(req.file.buffer, req.file.originalname);
      
      res.json({ 
        text,
        filename: req.file.originalname,
        size: req.file.size
      });
    } catch (error) {
      console.error("Error extracting text from file:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to extract text from file" 
      });
    }
  });

  // URL text extraction
  app.post("/api/extract-text-from-url", isAuthenticated, async (req: any, res) => {
    try {
      const { url } = req.body;
      
      if (!url) {
        return res.status(400).json({ error: "URL is required" });
      }

      const text = await extractTextFromUrl(url);
      
      res.json({ 
        text,
        url
      });
    } catch (error) {
      console.error("Error extracting text from URL:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to extract text from URL" 
      });
    }
  });

  // Categories
  app.get("/api/categories", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const categories = await storage.getCategories(product);
      
      // Add usage count for insights in each category
      const insights = await storage.getProductInsights(product);
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
      const qaPairs = await storage.getQAPairs(product);
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

  app.get("/api/categories/company-stats", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const categories = await storage.getCategories(product);
      const insights = await storage.getProductInsights(product);
      const qaPairs = await storage.getQAPairs(product);
      
      // Count unique companies per category for insights
      const insightCompanyCount = new Map<string, Set<string>>();
      insights.forEach(insight => {
        if (insight.categoryId && insight.companyId) {
          if (!insightCompanyCount.has(insight.categoryId)) {
            insightCompanyCount.set(insight.categoryId, new Set());
          }
          insightCompanyCount.get(insight.categoryId)!.add(insight.companyId);
        }
      });
      
      // Count unique companies per category for Q&A pairs
      const qaCompanyCount = new Map<string, Set<string>>();
      qaPairs.forEach(qa => {
        if (qa.categoryId && qa.companyId) {
          if (!qaCompanyCount.has(qa.categoryId)) {
            qaCompanyCount.set(qa.categoryId, new Set());
          }
          qaCompanyCount.get(qa.categoryId)!.add(qa.companyId);
        }
      });
      
      const categoryStats = categories.map(cat => ({
        id: cat.id,
        name: cat.name,
        insightCompanyCount: insightCompanyCount.get(cat.id)?.size || 0,
        qaCompanyCount: qaCompanyCount.get(cat.id)?.size || 0,
      }));
      
      res.json(categoryStats);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.post("/api/categories", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const data = insertCategorySchema.parse(req.body);
      const category = await storage.createCategory({
        ...data,
        product,
      });
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

  app.get("/api/categories/:id/overview", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const { id } = req.params;
      const overview = await storage.getCategoryOverview(product, id);
      
      if (!overview) {
        res.status(404).json({ error: "Category not found" });
        return;
      }
      
      res.json(overview);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  // Features
  app.get("/api/features", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const features = await storage.getFeatures(product);
      res.json(features);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.get("/api/features/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const { id } = req.params;
      const feature = await storage.getFeature(product, id);
      
      if (!feature) {
        res.status(404).json({ error: "Feature not found" });
        return;
      }
      
      res.json(feature);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.post("/api/features", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const body = { ...req.body };
      if (body.releaseDate) {
        body.releaseDate = new Date(body.releaseDate);
      }
      const data = insertFeatureSchema.parse(body);
      const feature = await storage.createFeature({
        ...data,
        product,
      });
      res.json(feature);
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

  app.patch("/api/features/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, value, videoLink, helpGuideLink, categoryId, releaseDate } = req.body;
      
      if (!name || typeof name !== 'string') {
        res.status(400).json({ error: "Name is required" });
        return;
      }
      
      const releaseDateValue = releaseDate ? new Date(releaseDate) : undefined;
      
      const feature = await storage.updateFeature(id, name, description, value, videoLink, helpGuideLink, categoryId, releaseDateValue);
      
      if (!feature) {
        res.status(404).json({ error: "Feature not found" });
        return;
      }
      
      res.json(feature);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.delete("/api/features/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.deleteFeature(id);
      
      if (!success) {
        res.status(404).json({ error: "Feature not found" });
        return;
      }
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  // Companies
  app.get("/api/companies", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const companies = await storage.getCompanies(product);
      res.json(companies);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.get("/api/dashboard/stats", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const companies = await storage.getCompanies(product);
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

  app.get("/api/dashboard/recent-transcripts", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const allTranscripts = await storage.getTranscripts(product);
      const recentTranscripts = allTranscripts
        .filter(t => new Date(t.createdAt) >= sevenDaysAgo)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10);

      res.json(recentTranscripts);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.get("/api/companies/:slug", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const { slug } = req.params;
      const company = await storage.getCompanyBySlug(product, slug);
      
      if (!company) {
        res.status(404).json({ error: "Company not found" });
        return;
      }
      
      res.json(company);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.get("/api/companies/:slug/overview", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const { slug } = req.params;
      const overview = await storage.getCompanyOverview(product, slug);
      
      if (!overview) {
        res.status(404).json({ error: "Company not found" });
        return;
      }
      
      res.json(overview);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.post("/api/companies", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const data = insertCompanySchema.parse(req.body);
      const company = await storage.createCompany({
        ...data,
        product,
      });
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
      const { name, notes, companyDescription, numberOfStores, stage, pilotStartDate, serviceTags } = req.body;
      
      if (!name || typeof name !== 'string') {
        res.status(400).json({ error: "Name is required" });
        return;
      }
      
      const pilotStartDateValue = pilotStartDate ? new Date(pilotStartDate) : null;
      
      const company = await storage.updateCompany(id, name, notes, companyDescription, numberOfStores, stage, pilotStartDateValue, serviceTags);
      
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
  app.get("/api/contacts/company/:companyId", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const { companyId } = req.params;
      const contacts = await storage.getContactsByCompany(product, companyId);
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

  app.post("/api/companies/:companyId/merge-duplicate-contacts", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const { companyId } = req.params;
      
      const company = await storage.getCompany(product, companyId);
      if (!company) {
        res.status(404).json({ error: "Company not found" });
        return;
      }
      
      const result = await storage.mergeDuplicateContacts(product, companyId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  // POS Systems routes
  app.get("/api/pos-systems", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const systems = await storage.getPOSSystems(product);
      res.json(systems);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.get("/api/pos-systems/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const { id } = req.params;
      const system = await storage.getPOSSystem(product, id);
      
      if (!system) {
        res.status(404).json({ error: "POS system not found" });
        return;
      }
      
      res.json(system);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.post("/api/pos-systems", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const validatedData = insertPOSSystemSchema.parse(req.body);
      const system = await storage.createPOSSystem({
        ...validatedData,
        product,
      });
      res.json(system);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: fromZodError(error).message });
        return;
      }
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.patch("/api/pos-systems/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, websiteLink, description, companyIds } = req.body;
      
      if (!name) {
        res.status(400).json({ error: "Name is required" });
        return;
      }
      
      const system = await storage.updatePOSSystem(id, name, websiteLink, description, companyIds);
      
      if (!system) {
        res.status(404).json({ error: "POS system not found" });
        return;
      }
      
      res.json(system);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.delete("/api/pos-systems/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.deletePOSSystem(id);
      
      if (!success) {
        res.status(404).json({ error: "POS system not found" });
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
