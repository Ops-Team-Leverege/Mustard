import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { analyzeTranscript } from "./transcriptAnalyzer";
import { extractTextFromFile, extractTextFromUrl } from "./textExtractor";
import { ingestTranscriptChunks } from "./ingestion/ingestTranscriptChunks";
import { extractCustomerQuestions } from "./extraction/extractCustomerQuestions";
import { resolveCustomerQuestionAnswers } from "./ingestion/resolveCustomerQuestionAnswers";
import { extractMeetingActionStates, type MeetingActionItem as ComposerActionItem, type TranscriptChunk as ComposerChunk } from "./rag/composer";
import multer from "multer";
import { createMCP } from "./mcp";
import type { MCPContext } from "./mcp/types";
import { 
  handleAirtableWebhook, 
  handleAirtableRefresh,
  verifyAirtableWebhook, 
  getProductFeaturesFormatted, 
  getProductValuePropositionsFormatted, 
  searchProductKnowledge,
  listTables,
  discoverSchema,
  getRecordsByTableName,
  searchAllTables,
} from "./airtable";
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
import { handleRouteError, NotFoundError, ValidationError } from "./utils/errorHandler";
// From Replit Auth integration (blueprint:javascript_log_in_with_replit)
import { setupAuth, isAuthenticated } from "./replitAuth";

// Configure multer for file uploads (store in memory)
const upload = multer({ storage: multer.memoryStorage() });

function generateSlug(companyName: string): string {
  const slug = companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  // If slug is empty (no alphanumerics in name), use a uuid suffix
  return slug || `company-${randomUUID().split("-")[0]}`;
}

// Helper function to get current user and their selected product
async function getUserAndProduct(
  req: any,
): Promise<{ userId: string; user: any; product: Product }> {
  const userId = req.user.claims.sub;
  const user = await storage.getUser(userId);

  if (!user) {
    throw new Error("User not found");
  }

  // User's current product defaults to PitCrew if not set
  const product = (user.currentProduct as Product) || "PitCrew";

  return { userId, user, product };
}

// In-memory lock to prevent concurrent processing of the same transcript
const processingLocks = new Set<string>();

/**
 * Customer Questions Extraction (High-Trust, Evidence-Based Layer)
 * 
 * This function orchestrates customer question extraction for a transcript.
 * It runs AFTER transcript chunking, asynchronously and independently.
 * 
 * Characteristics:
 * - Uses gpt-4o at temperature 0 for deterministic output
 * - Fails independently without affecting other extractors
 * - Retryable - cleans up existing questions before re-extraction
 * - Does NOT affect existing Q&A pairs (qa_pairs table)
 */
async function extractCustomerQuestionsForTranscript(
  transcriptId: string,
  product: Product,
): Promise<void> {
  console.log(`[CustomerQuestions] Starting extraction for transcript ${transcriptId}`);
  
  // Get transcript chunks (these have speaker attribution)
  const chunks = await storage.getChunksForTranscript(transcriptId, 1000);
  
  if (chunks.length === 0) {
    console.log(`[CustomerQuestions] No chunks found for transcript ${transcriptId}, skipping`);
    return;
  }
  
  // Idempotent: Clear any existing customer questions from previous runs
  await storage.deleteCustomerQuestionsByTranscript(transcriptId);
  
  // Get transcript for companyId
  const transcript = await storage.getTranscript(product, transcriptId);
  if (!transcript) {
    console.log(`[CustomerQuestions] Transcript ${transcriptId} not found, skipping`);
    return;
  }
  
  // Run extraction
  const extractedQuestions = await extractCustomerQuestions(chunks);
  
  if (extractedQuestions.length === 0) {
    console.log(`[CustomerQuestions] No customer questions found in transcript ${transcriptId}`);
    return;
  }
  
  // Save to database (including Context Anchoring fields)
  // Initially save with status from extraction (may be overwritten by Resolution Pass)
  const savedQuestions = await storage.createCustomerQuestions(
    extractedQuestions.map((q) => ({
      product,
      transcriptId,
      companyId: transcript.companyId,
      questionText: q.question_text,
      askedByName: q.asked_by_name,
      questionTurnIndex: q.question_turn_index,
      status: q.status,
      answerEvidence: q.answer_evidence,
      answeredByName: q.answered_by_name,
      requiresContext: q.requires_context,
      contextBefore: q.context_before,
    })),
  );
  
  console.log(`[CustomerQuestions] Saved ${savedQuestions.length} customer questions for transcript ${transcriptId}`);
  
  // Resolution Pass: Verify if questions were answered in transcript
  // This is a separate verifier-only pass that runs AFTER extraction
  // It uses a focused search window and strictly quotes verbatim evidence
  console.log(`[Resolution] Starting Resolution Pass for ${savedQuestions.length} questions`);
  
  const questionsToResolve = savedQuestions.map(q => ({
    id: q.id,
    questionText: q.questionText,
    questionTurnIndex: q.questionTurnIndex,
  }));
  
  const resolvedQuestions = await resolveCustomerQuestionAnswers(questionsToResolve, chunks);
  
  // Update each question with resolution results
  for (const resolved of resolvedQuestions) {
    await storage.updateCustomerQuestionResolution(resolved.id, {
      status: resolved.status,
      answerEvidence: resolved.answerEvidence,
      answeredByName: resolved.answeredByName,
      resolutionTurnIndex: resolved.resolutionTurnIndex,
    });
  }
  
  const answered = resolvedQuestions.filter(r => r.status === "ANSWERED").length;
  const deferred = resolvedQuestions.filter(r => r.status === "DEFERRED").length;
  const open = resolvedQuestions.filter(r => r.status === "OPEN").length;
  console.log(`[Resolution] Complete: ${answered} answered, ${deferred} deferred, ${open} open`);
}

/**
 * Meeting Action Items Extraction (Read-only Artifact, Materialized at Ingestion)
 * 
 * This function extracts action items/commitments during transcript ingestion.
 * Like customer questions, these are read-only meeting artifacts:
 * - Extracted once at ingestion time (NOT on query path)
 * - Uses extractMeetingActionStates from RAG composer
 * - Fails independently without affecting other extractors
 * - Retryable - cleans up existing items before re-extraction
 */
async function extractActionItemsForTranscript(
  transcriptId: string,
  product: Product,
): Promise<void> {
  console.log(`[ActionItems] Starting extraction for transcript ${transcriptId}`);
  
  // Get transcript chunks (up to 5000 for full coverage)
  const chunks = await storage.getChunksForTranscript(transcriptId, 5000);
  
  if (chunks.length === 0) {
    console.log(`[ActionItems] No chunks found for transcript ${transcriptId}, skipping`);
    return;
  }
  
  // Idempotent: Clear any existing action items from previous runs
  await storage.deleteMeetingActionItemsByTranscript(transcriptId);
  
  // Get transcript for companyId and speaker info
  const transcript = await storage.getTranscript(product, transcriptId);
  if (!transcript) {
    console.log(`[ActionItems] Transcript ${transcriptId} not found, skipping`);
    return;
  }
  
  // Map to composer format
  const composerChunks: ComposerChunk[] = chunks.map(c => ({
    chunkIndex: c.chunkIndex,
    speakerRole: (c.speakerRole || "unknown") as "leverege" | "customer" | "unknown",
    speakerName: c.speakerName || undefined,
    text: c.content,
  }));
  
  // Extract action items using the RAG composer
  const { primary, secondary } = await extractMeetingActionStates(composerChunks, {
    leverageTeam: transcript.leverageTeam || undefined,
    customerNames: transcript.customerNames || undefined,
  });
  
  const allItems = [...primary, ...secondary];
  
  if (allItems.length === 0) {
    console.log(`[ActionItems] Extraction complete for transcript ${transcriptId}: 0 items found (success=true)`);
    return;
  }
  
  // Save to database
  await storage.createMeetingActionItems(
    allItems.map((item, index) => ({
      product,
      transcriptId,
      companyId: transcript.companyId,
      actionText: item.action,
      ownerName: item.owner,
      actionType: item.type,
      deadline: item.deadline === "Not specified" ? null : item.deadline,
      evidenceQuote: item.evidence,
      confidence: item.confidence,
      isPrimary: index < primary.length, // First N items are primary
    })),
  );
  
  console.log(`[ActionItems] Extraction complete for transcript ${transcriptId}: ${allItems.length} items (${primary.length} primary, ${secondary.length} secondary) (success=true)`);
}

// Background processing function for transcript AI analysis
async function processTranscriptInBackground(
  transcriptId: string,
  product: Product,
): Promise<void> {
  // Atomic lock acquisition: Prevent concurrent processing of the same transcript
  if (processingLocks.has(transcriptId)) {
    console.log(
      `Transcript ${transcriptId} is already being processed by another job, skipping`,
    );
    return;
  }
  processingLocks.add(transcriptId);

  try {
    // Fetch transcript to check current status
    const transcript = await storage.getTranscript(product, transcriptId);
    if (!transcript) {
      throw new Error(`Transcript ${transcriptId} not found`);
    }

    // Skip if already completed successfully
    if (transcript.processingStatus === "completed") {
      console.log(
        `Transcript ${transcriptId} has already been processed successfully, skipping`,
      );
      return;
    }

    if (!transcript.companyId) {
      throw new Error(`Transcript ${transcriptId} has no company association`);
    }

    // Idempotent retry safety: Clear any existing artifacts from incomplete runs
    // (handles pending, processing, or failed states - including crash/restart scenarios)
    const existingInsights = await storage.getProductInsightsByTranscript(
      product,
      transcriptId,
    );
    for (const insight of existingInsights) {
      await storage.deleteProductInsight(insight.id);
    }
    const existingQAPairs = await storage.getQAPairsByTranscript(
      product,
      transcriptId,
    );
    for (const qaPair of existingQAPairs) {
      await storage.deleteQAPair(qaPair.id);
    }
    if (existingInsights.length > 0 || existingQAPairs.length > 0) {
      console.log(
        `Cleaned up ${existingInsights.length} insights and ${existingQAPairs.length} Q&A pairs from previous incomplete run of transcript ${transcriptId}`,
      );
    }

    // Update status to processing (after cleanup)
    await storage.updateTranscriptProcessingStatus(transcriptId, "processing");

    // Get company and contacts
    const company = await storage.getCompany(product, transcript.companyId);
    if (!company) {
      throw new Error(`Company ${transcript.companyId} not found`);
    }

    const allContacts = await storage.getContactsByCompany(product, company.id);

    // Get categories for AI analysis
    const categories = await storage.getCategories(product);

    // Parse customer names and leverage team from transcript (with null/undefined guards)
    const leverageTeam = transcript.leverageTeam
      ? transcript.leverageTeam
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s)
      : [];
    const customerNamesList = transcript.customerNames
      ? transcript.customerNames
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s)
      : [];

    // Determine content to analyze based on type (fallback to "transcript" if undefined)
    const contentType: "transcript" | "notes" =
      transcript.contentType === "notes" ||
      transcript.contentType === "transcript"
        ? transcript.contentType
        : "transcript";
    const contentToAnalyze =
      contentType === "notes"
        ? transcript.mainMeetingTakeaways || ""
        : transcript.transcript || "";

    if (!contentToAnalyze) {
      throw new Error("No content to analyze");
    }

    // Run AI analysis
    await storage.updateProcessingStep(transcriptId, "analyzing_transcript");
    const analysis = await analyzeTranscript({
      transcript: contentToAnalyze,
      companyName: company.name,
      leverageTeam,
      customerNames: customerNamesList,
      categories,
      contentType,
    });

    // Save insights with companyId
    await storage.updateProcessingStep(transcriptId, "extracting_insights");
    await storage.createProductInsights(
      analysis.insights.map((insight) => ({
        transcriptId: transcript.id,
        feature: insight.feature,
        context: insight.context,
        quote: insight.quote,
        company: company.name,
        companyId: company.id,
        categoryId: insight.categoryId,
        product,
      })),
    );

    // Save Q&A pairs with companyId and matched contactId
    await storage.updateProcessingStep(transcriptId, "extracting_qa");
    await storage.createQAPairs(
      analysis.qaPairs.map((qa) => {
        // Try to match asker name to a contact (case-insensitive)
        const matchedContact = allContacts.find((contact) => {
          const askerName = qa.asker.toLowerCase().trim();
          const nameInTranscript = contact.nameInTranscript
            ?.toLowerCase()
            .trim();
          const contactName = contact.name.toLowerCase().trim();

          // If nameInTranscript is provided, match against it; otherwise match against name
          return nameInTranscript
            ? nameInTranscript === askerName
            : contactName === askerName;
        });

        return {
          transcriptId: transcript.id,
          question: qa.question,
          answer: qa.answer,
          asker: qa.asker,
          contactId: matchedContact?.id || null,
          company: company.name,
          companyId: company.id,
          categoryId: qa.categoryId,
          product,
        };
      }),
    );

    // Handle POS system detection and linking
    await storage.updateProcessingStep(transcriptId, "detecting_pos_systems");
    if (analysis.posSystem) {
      await storage.findOrCreatePOSSystemAndLink(
        product,
        analysis.posSystem.name,
        company.id,
        analysis.posSystem.websiteLink,
        analysis.posSystem.description,
      );
      console.log(
        `POS system detected and linked: ${analysis.posSystem.name} -> ${company.name}`,
      );
    }

    // Mark as completed with final step
    await storage.updateProcessingStep(transcriptId, "complete");
    await storage.updateTranscriptProcessingStatus(transcriptId, "completed");
    console.log(`Successfully processed transcript ${transcriptId}`);

    // Chunk transcript for RAG/MCP queries (non-blocking, fire-and-forget)
    // Then run customer questions extraction after chunking (async, independent, retryable)
    ingestTranscriptChunks({ transcriptId }).then(async (result) => {
      console.log(`Chunked transcript ${transcriptId}: ${result.chunksPrepared} chunks created`);
      
      // Customer Questions Extraction (High-Trust Layer)
      // Runs AFTER chunking, uses gpt-4o temp=0, fails independently
      try {
        await extractCustomerQuestionsForTranscript(transcriptId, product);
      } catch (err) {
        // Non-fatal: log and continue - does not affect transcript or Q&A processing
        console.error(`[CustomerQuestions] Extraction failed for transcript ${transcriptId}:`, err);
      }
      
      // Meeting Action Items Extraction (Read-only Artifact, Materialized)
      // Runs AFTER chunking, fails independently, retryable
      try {
        await extractActionItemsForTranscript(transcriptId, product);
      } catch (err) {
        // Non-fatal: log and continue - does not affect other extractors
        console.error(`[ActionItems] Extraction failed for transcript ${transcriptId}:`, err);
      }
    }).catch((err) => {
      console.error(`Failed to chunk transcript ${transcriptId}:`, err);
    });
  } catch (error) {
    // Mark as failed - partial data remains linked to failed transcript for manual review/cleanup
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";

    try {
      await storage.updateTranscriptProcessingStatus(
        transcriptId,
        "failed",
        errorMessage,
      );
      console.log(
        `Marked transcript ${transcriptId} as failed. Partial data retained for manual review.`,
      );
    } catch (statusUpdateError) {
      console.error(
        `Failed to update transcript status to failed for ${transcriptId}:`,
        statusUpdateError,
      );
    }

    console.error(`Failed to process transcript ${transcriptId}:`, error);
    throw error;
  } finally {
    // Always release lock, regardless of success or failure
    processingLocks.delete(transcriptId);
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware (from Replit Auth integration - blueprint:javascript_log_in_with_replit)
  await setupAuth(app);

  // Note: Slack routes are registered in index.ts BEFORE express.json() to preserve raw body
  
  const mcpContext: MCPContext = {
    db: {
      query: async (sql: string, params?: any[]) => {
        // delegate to existing storage/db layer
        return storage.rawQuery(sql, params);
      },
    },
  };

  const mcp = createMCP(mcpContext);

  // Auth routes (from Replit Auth integration - blueprint:javascript_log_in_with_replit)
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);

      // Email domain restriction: only allow leverege.com
      if (!user?.email) {
        return res.status(403).json({
          message:
            "Email required. Only leverege.com email addresses are allowed.",
          code: "DOMAIN_RESTRICTED",
        });
      }

      const emailDomain = user.email.split("@")[1]?.toLowerCase();
      if (emailDomain !== "leverege.com") {
        return res.status(403).json({
          message:
            "Access denied. Only leverege.com email addresses are allowed.",
          code: "DOMAIN_RESTRICTED",
        });
      }

      res.json(user);
    } catch (error) {
      handleRouteError(res, error, "GET /api/auth/user");
    }
  });

  // Product management routes
  app.get("/api/products", isAuthenticated, async (req: any, res) => {
    try {
      // Return list of available products
      res.json({ products: PRODUCTS });
    } catch (error) {
      handleRouteError(res, error, "GET /api/products");
    }
  });

  app.put("/api/user/product", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = req.body;

      // Validate product
      if (!PRODUCTS.includes(product)) {
        throw new ValidationError("Invalid product");
      }

      const { userId } = await getUserAndProduct(req);
      const updatedUser = await storage.updateUserProduct(userId, product);

      if (!updatedUser) {
        throw new NotFoundError("User");
      }

      res.json(updatedUser);
    } catch (error) {
      handleRouteError(res, error, "PUT /api/user/product");
    }
  });

  // Transcripts (protected routes)
  app.post("/api/transcripts", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const body = { ...req.body };
      // Convert createdAt string to Date if provided
      if (body.createdAt && typeof body.createdAt === "string") {
        body.createdAt = new Date(body.createdAt);
      }

      const validatedData = insertTranscriptSchema.parse(body);
      const data = validatedData as typeof validatedData & {
        customers?: Array<{
          name: string;
          nameInTranscript?: string;
          jobTitle?: string;
        }>;
      };

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

      // Create transcript immediately with "pending" status
      const transcript = await storage.createTranscript({
        ...data,
        companyId: company.id,
        product,
      });

      // Get all existing contacts for this company first
      const existingContacts = await storage.getContactsByCompany(
        product,
        company.id,
      );

      // Create or reuse contact records from validated customers array
      const contacts = [];
      if (data.customers && Array.isArray(data.customers)) {
        for (const customer of data.customers) {
          const customerNameLower = customer.name.toLowerCase().trim();

          // Check if contact already exists by matching against both name and nameInTranscript (case-insensitive)
          const existingContact = existingContacts.find((c) => {
            const contactNameLower = c.name.toLowerCase().trim();
            const nameInTranscriptLower = c.nameInTranscript
              ?.toLowerCase()
              .trim();

            // Match if customer name matches either the contact's name or nameInTranscript
            return (
              contactNameLower === customerNameLower ||
              (nameInTranscriptLower &&
                nameInTranscriptLower === customerNameLower)
            );
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

      // Trigger async AI processing in background
      processTranscriptInBackground(transcript.id, product).catch((err) => {
        console.error(
          `Background processing failed for transcript ${transcript.id}:`,
          err,
        );
      });

      // Return 202 Accepted immediately with transcript info
      res.status(202).json({
        transcript,
        contacts,
        company: {
          id: company.id,
          name: company.name,
          slug: company.slug,
        },
      });
    } catch (error) {
      handleRouteError(res, error, "POST /api/transcripts");
    }
  });

  app.get("/api/transcripts", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const transcripts = await storage.getTranscripts(product);
      res.json(transcripts);
    } catch (error) {
      handleRouteError(res, error, "GET /api/transcripts");
    }
  });

  app.get(
    "/api/companies/:companyId/transcripts",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { product } = await getUserAndProduct(req);
        const { companyId } = req.params;
        const transcripts = await storage.getTranscriptsByCompany(
          product,
          companyId,
        );
        res.json(transcripts);
      } catch (error) {
        handleRouteError(res, error, "GET /api/companies/:companyId/transcripts");
      }
    },
  );

  app.patch("/api/transcripts/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const {
        name,
        createdAt,
        mainMeetingTakeaways,
        nextSteps,
        supportingMaterials,
        transcript,
      } = req.body;
      const updatedTranscript = await storage.updateTranscript(id, {
        name: name !== undefined ? name || null : undefined,
        createdAt: createdAt !== undefined ? new Date(createdAt) : undefined,
        mainMeetingTakeaways:
          mainMeetingTakeaways !== undefined
            ? mainMeetingTakeaways || null
            : undefined,
        nextSteps: nextSteps !== undefined ? nextSteps || null : undefined,
        supportingMaterials:
          supportingMaterials !== undefined
            ? Array.isArray(supportingMaterials)
              ? supportingMaterials
              : []
            : undefined,
        transcript: transcript !== undefined ? transcript || null : undefined,
      });
      if (!updatedTranscript) {
        throw new NotFoundError("Transcript");
      }
      res.json(updatedTranscript);
    } catch (error) {
      handleRouteError(res, error, "PATCH /api/transcripts/:id");
    }
  });

  app.delete("/api/transcripts/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.deleteTranscript(id);

      if (!success) {
        throw new NotFoundError("Transcript");
      }

      res.json({ success: true });
    } catch (error) {
      handleRouteError(res, error, "DELETE /api/transcripts/:id");
    }
  });

  app.post(
    "/api/transcripts/:id/retry",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { product } = await getUserAndProduct(req);
        const { id } = req.params;

        const transcript = await storage.getTranscript(product, id);
        if (!transcript) {
          return res.status(404).json({ error: "Transcript not found" });
        }

        // Only allow retrying failed, pending, or stuck processing transcripts
        // (Processing transcripts can get stuck when server restarts)
        if (
          transcript.processingStatus !== "failed" &&
          transcript.processingStatus !== "pending" &&
          transcript.processingStatus !== "processing"
        ) {
          return res
            .status(400)
            .json({
              error:
                "Can only retry failed, pending, or processing transcripts",
            });
        }

        // Reset the transcript to pending status
        await storage.updateTranscriptProcessingStatus(id, "pending");

        // Trigger background processing
        processTranscriptInBackground(id, product).catch((error) => {
          console.error(
            `Background processing error for transcript ${id}:`,
            error,
          );
        });

        res.json({ success: true, message: "Transcript processing restarted" });
      } catch (error) {
        console.error("Error retrying transcript:", error);
        res
          .status(500)
          .json({
            error: error instanceof Error ? error.message : "Unknown error",
          });
      }
    },
  );

  app.get(
    "/api/transcripts/:id/details",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { product } = await getUserAndProduct(req);
        const { id } = req.params;
        const transcript = await storage.getTranscript(product, id);

        if (!transcript) {
          throw new NotFoundError("Transcript");
        }

        const [insights, qaPairs, company] = await Promise.all([
          storage.getProductInsightsByTranscript(product, id),
          storage.getQAPairsByTranscript(product, id),
          transcript.companyId
            ? storage.getCompany(product, transcript.companyId)
            : Promise.resolve(undefined),
        ]);

        res.json({
          transcript,
          insights,
          qaPairs,
          company,
        });
      } catch (error) {
        handleRouteError(res, error, "GET /api/transcripts/:id/details");
      }
    },
  );

  // Product Insights
  app.get("/api/insights", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const insights = await storage.getProductInsights(product);

      // Add usage count for each category
      const categories = await storage.getCategories(product);
      const categoryUsage = new Map<string, number>();

      insights.forEach((insight) => {
        if (insight.categoryId) {
          categoryUsage.set(
            insight.categoryId,
            (categoryUsage.get(insight.categoryId) || 0) + 1,
          );
        }
      });

      const enrichedInsights: Array<
        ProductInsightWithCategory & { categoryUsageCount?: number }
      > = insights.map((insight) => ({
        ...insight,
        categoryUsageCount: insight.categoryId
          ? categoryUsage.get(insight.categoryId)
          : undefined,
      }));

      res.json(enrichedInsights);
    } catch (error) {
      handleRouteError(res, error, "GET /api/insights");
    }
  });

  app.patch(
    "/api/insights/:id/category",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { product } = await getUserAndProduct(req);
        const { id } = req.params;
        const { categoryId } = req.body;

        // Validate categoryId if provided
        if (categoryId !== null && typeof categoryId !== "string") {
          throw new ValidationError("Invalid categoryId");
        }

        if (categoryId) {
          const category = await storage.getCategory(product, categoryId);
          if (!category) {
            throw new NotFoundError("Category");
          }
        }

        const success = await storage.assignCategoryToInsight(id, categoryId);

        if (!success) {
          throw new NotFoundError("Insight");
        }

        res.json({ success: true });
      } catch (error) {
        handleRouteError(res, error, "PATCH /api/insights/:id/category");
      }
    },
  );

  app.patch("/api/insights/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const { id } = req.params;
      const { feature, context, quote, company } = req.body;

      if (!feature || !context || !quote || !company) {
        throw new ValidationError("Feature, context, quote, and company are required");
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

      const insight = await storage.updateProductInsight(
        id,
        feature,
        context,
        quote,
        company,
        companyRecord.id,
      );

      if (!insight) {
        throw new NotFoundError("Insight");
      }

      res.json(insight);
    } catch (error) {
      handleRouteError(res, error, "PATCH /api/insights/:id");
    }
  });

  app.delete("/api/insights/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.deleteProductInsight(id);

      if (!success) {
        throw new NotFoundError("Insight");
      }

      res.json({ success: true });
    } catch (error) {
      handleRouteError(res, error, "DELETE /api/insights/:id");
    }
  });

  app.post("/api/insights", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const { feature, context, quote, company, categoryId } = req.body;

      if (!feature || !context || !quote || !company) {
        throw new ValidationError("Feature, context, quote, and company are required");
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
      res
        .status(500)
        .json({
          error: error instanceof Error ? error.message : "Unknown error",
        });
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

      qaPairs.forEach((qa) => {
        if (qa.categoryId) {
          categoryUsage.set(
            qa.categoryId,
            (categoryUsage.get(qa.categoryId) || 0) + 1,
          );
        }
      });

      res.json(qaPairs);
    } catch (error) {
      handleRouteError(res, error, "GET /api/qa-pairs");
    }
  });

  app.patch(
    "/api/qa-pairs/:id/category",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { product } = await getUserAndProduct(req);
        const { id } = req.params;
        const { categoryId } = req.body;

        // Validate categoryId if provided
        if (categoryId !== null && typeof categoryId !== "string") {
          throw new ValidationError("Invalid categoryId");
        }

        if (categoryId) {
          const category = await storage.getCategory(product, categoryId);
          if (!category) {
            throw new NotFoundError("Category");
          }
        }

        const success = await storage.assignCategoryToQAPair(id, categoryId);

        if (!success) {
          throw new NotFoundError("Q&A pair");
        }

        res.json({ success: true });
      } catch (error) {
        handleRouteError(res, error, "PATCH /api/qa-pairs/:id/category");
      }
    },
  );

  app.patch("/api/qa-pairs/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const { id } = req.params;
      const { question, answer, asker, company, contactId } = req.body;

      if (!question || !answer || !asker || !company) {
        throw new ValidationError("Question, answer, asker, and company are required");
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

      const qaPair = await storage.updateQAPair(
        id,
        question,
        answer,
        asker,
        company,
        companyRecord.id,
        contactId,
      );

      if (!qaPair) {
        throw new NotFoundError("Q&A pair");
      }

      res.json(qaPair);
    } catch (error) {
      handleRouteError(res, error, "PATCH /api/qa-pairs/:id");
    }
  });

  app.delete("/api/qa-pairs/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.deleteQAPair(id);

      if (!success) {
        throw new NotFoundError("Q&A pair");
      }

      res.json({ success: true });
    } catch (error) {
      handleRouteError(res, error, "DELETE /api/qa-pairs/:id");
    }
  });

  app.patch("/api/qa-pairs/:id/star", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const { isStarred } = req.body;

      const qaPair = await storage.toggleQAPairStar(id, isStarred);

      if (!qaPair) {
        throw new NotFoundError("Q&A pair");
      }

      res.json(qaPair);
    } catch (error) {
      handleRouteError(res, error, "PATCH /api/qa-pairs/:id/star");
    }
  });

  app.post("/api/qa-pairs", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const { question, answer, asker, company, categoryId, contactId } =
        req.body;

      if (!question || !answer || !asker || !company) {
        throw new ValidationError("Question, answer, asker, and company are required");
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
      res
        .status(500)
        .json({
          error: error instanceof Error ? error.message : "Unknown error",
        });
    }
  });

  // File upload and text extraction
  app.post(
    "/api/extract-text-from-file",
    isAuthenticated,
    upload.single("file"),
    async (req: any, res) => {
      try {
        if (!req.file) {
          throw new ValidationError("No file uploaded");
        }

        const text = await extractTextFromFile(
          req.file.buffer,
          req.file.originalname,
        );

        res.json({
          text,
          filename: req.file.originalname,
          size: req.file.size,
        });
      } catch (error) {
        handleRouteError(res, error, "POST /api/extract-text-from-file");
      }
    },
  );

  // URL text extraction
  app.post(
    "/api/extract-text-from-url",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { url } = req.body;

        if (!url) {
          throw new ValidationError("URL is required");
        }

        const text = await extractTextFromUrl(url);

        res.json({
          text,
          url,
        });
      } catch (error) {
        handleRouteError(res, error, "POST /api/extract-text-from-url");
      }
    },
  );

  // Categories
  app.get("/api/categories", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const categories = await storage.getCategories(product);

      // Add usage count for insights in each category
      const insights = await storage.getProductInsights(product);
      const insightUsage = new Map<string, number>();

      insights.forEach((insight) => {
        if (insight.categoryId) {
          insightUsage.set(
            insight.categoryId,
            (insightUsage.get(insight.categoryId) || 0) + 1,
          );
        }
      });

      // Add Q&A pair count for each category
      const qaPairs = await storage.getQAPairs(product);
      const qaUsage = new Map<string, number>();

      qaPairs.forEach((qa) => {
        if (qa.categoryId) {
          qaUsage.set(qa.categoryId, (qaUsage.get(qa.categoryId) || 0) + 1);
        }
      });

      const categoriesWithCount = categories.map((cat) => ({
        ...cat,
        usageCount: insightUsage.get(cat.id) || 0,
        qaCount: qaUsage.get(cat.id) || 0,
      }));

      res.json(categoriesWithCount);
    } catch (error) {
      handleRouteError(res, error, "GET /api/categories");
    }
  });

  app.get(
    "/api/categories/company-stats",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { product } = await getUserAndProduct(req);
        const categories = await storage.getCategories(product);
        const insights = await storage.getProductInsights(product);
        const qaPairs = await storage.getQAPairs(product);

        // Count unique companies per category for insights
        const insightCompanyCount = new Map<string, Set<string>>();
        insights.forEach((insight) => {
          if (insight.categoryId && insight.companyId) {
            if (!insightCompanyCount.has(insight.categoryId)) {
              insightCompanyCount.set(insight.categoryId, new Set());
            }
            insightCompanyCount.get(insight.categoryId)!.add(insight.companyId);
          }
        });

        // Count unique companies per category for Q&A pairs
        const qaCompanyCount = new Map<string, Set<string>>();
        qaPairs.forEach((qa) => {
          if (qa.categoryId && qa.companyId) {
            if (!qaCompanyCount.has(qa.categoryId)) {
              qaCompanyCount.set(qa.categoryId, new Set());
            }
            qaCompanyCount.get(qa.categoryId)!.add(qa.companyId);
          }
        });

        const categoryStats = categories.map((cat) => ({
          id: cat.id,
          name: cat.name,
          insightCompanyCount: insightCompanyCount.get(cat.id)?.size || 0,
          qaCompanyCount: qaCompanyCount.get(cat.id)?.size || 0,
        }));

        res.json(categoryStats);
      } catch (error) {
        handleRouteError(res, error, "GET /api/categories/company-stats");
      }
    },
  );

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
      handleRouteError(res, error, "POST /api/categories");
    }
  });

  app.patch("/api/categories/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description } = req.body;

      if (!name || typeof name !== "string") {
        throw new ValidationError("Name is required");
      }

      const category = await storage.updateCategory(id, name, description);

      if (!category) {
        throw new NotFoundError("Category");
      }

      res.json(category);
    } catch (error) {
      handleRouteError(res, error, "PATCH /api/categories/:id");
    }
  });

  app.delete("/api/categories/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.deleteCategory(id);

      if (!success) {
        throw new NotFoundError("Category");
      }

      res.json({ success: true });
    } catch (error) {
      handleRouteError(res, error, "DELETE /api/categories/:id");
    }
  });

  app.get(
    "/api/categories/:id/overview",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { product } = await getUserAndProduct(req);
        const { id } = req.params;
        const overview = await storage.getCategoryOverview(product, id);

        if (!overview) {
          throw new NotFoundError("Category");
        }

        res.json(overview);
      } catch (error) {
        handleRouteError(res, error, "GET /api/categories/:id/overview");
      }
    },
  );

  // Features
  app.get("/api/features", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const features = await storage.getFeatures(product);
      res.json(features);
    } catch (error) {
      handleRouteError(res, error, "GET /api/features");
    }
  });

  app.get("/api/features/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const { id } = req.params;
      const feature = await storage.getFeature(product, id);

      if (!feature) {
        throw new NotFoundError("Feature");
      }

      res.json(feature);
    } catch (error) {
      handleRouteError(res, error, "GET /api/features/:id");
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
      handleRouteError(res, error, "POST /api/features");
    }
  });

  app.patch("/api/features/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const {
        name,
        description,
        value,
        videoLink,
        helpGuideLink,
        categoryId,
        releaseDate,
      } = req.body;

      if (!name || typeof name !== "string") {
        throw new ValidationError("Name is required");
      }

      const releaseDateValue = releaseDate ? new Date(releaseDate) : undefined;

      const feature = await storage.updateFeature(
        id,
        name,
        description,
        value,
        videoLink,
        helpGuideLink,
        categoryId,
        releaseDateValue,
      );

      if (!feature) {
        throw new NotFoundError("Feature");
      }

      res.json(feature);
    } catch (error) {
      handleRouteError(res, error, "PATCH /api/features/:id");
    }
  });

  app.delete("/api/features/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.deleteFeature(id);

      if (!success) {
        throw new NotFoundError("Feature");
      }

      res.json({ success: true });
    } catch (error) {
      handleRouteError(res, error, "DELETE /api/features/:id");
    }
  });

  // Companies
  app.get("/api/companies", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const companies = await storage.getCompanies(product);
      res.json(companies);
    } catch (error) {
      handleRouteError(res, error, "GET /api/companies");
    }
  });

  app.get("/api/dashboard/stats", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const companies = await storage.getCompanies(product);
      const stageStats = companies.reduce(
        (acc, company) => {
          const stage = company.stage || "Unknown";
          acc[stage] = (acc[stage] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      res.json({ stageStats });
    } catch (error) {
      handleRouteError(res, error, "GET /api/dashboard/stats");
    }
  });

  app.get(
    "/api/dashboard/recent-transcripts",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { product } = await getUserAndProduct(req);
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const allTranscripts = await storage.getTranscripts(product);
        const recentTranscripts = allTranscripts
          .filter((t) => new Date(t.createdAt) >= sevenDaysAgo)
          .sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          )
          .slice(0, 10);

        res.json(recentTranscripts);
      } catch (error) {
        handleRouteError(res, error, "GET /api/dashboard/recent-transcripts");
      }
    },
  );

  app.get("/api/companies/:slug", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const { slug } = req.params;
      const company = await storage.getCompanyBySlug(product, slug);

      if (!company) {
        throw new NotFoundError("Company");
      }

      res.json(company);
    } catch (error) {
      handleRouteError(res, error, "GET /api/companies/:slug");
    }
  });

  app.get(
    "/api/companies/:slug/overview",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { product } = await getUserAndProduct(req);
        const { slug } = req.params;
        const overview = await storage.getCompanyOverview(product, slug);

        if (!overview) {
          throw new NotFoundError("Company");
        }

        res.json(overview);
      } catch (error) {
        handleRouteError(res, error, "GET /api/companies/:slug/overview");
      }
    },
  );

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
      handleRouteError(res, error, "POST /api/companies");
    }
  });

  app.patch("/api/companies/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const {
        name,
        notes,
        companyDescription,
        numberOfStores,
        stage,
        pilotStartDate,
        serviceTags,
      } = req.body;

      if (!name || typeof name !== "string") {
        throw new ValidationError("Name is required");
      }

      const pilotStartDateValue = pilotStartDate
        ? new Date(pilotStartDate)
        : null;

      const company = await storage.updateCompany(
        id,
        name,
        notes,
        companyDescription,
        numberOfStores,
        stage,
        pilotStartDateValue,
        serviceTags,
      );

      if (!company) {
        throw new NotFoundError("Company");
      }

      await storage.updateCompanyNameInRelatedRecords(id, name);

      res.json(company);
    } catch (error) {
      handleRouteError(res, error, "PATCH /api/companies/:id");
    }
  });

  app.delete("/api/companies/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.deleteCompany(id);

      if (!success) {
        throw new NotFoundError("Company");
      }

      res.json({ success: true });
    } catch (error) {
      handleRouteError(res, error, "DELETE /api/companies/:id");
    }
  });

  // Contacts
  app.get(
    "/api/contacts/company/:companyId",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { product } = await getUserAndProduct(req);
        const { companyId } = req.params;
        const contacts = await storage.getContactsByCompany(product, companyId);
        res.json(contacts);
      } catch (error) {
        handleRouteError(res, error, "GET /api/contacts/company/:companyId");
      }
    },
  );

  app.post("/api/contacts", isAuthenticated, async (req, res) => {
    try {
      const data = insertContactSchema.parse(req.body);
      const contact = await storage.createContact(data);
      res.json(contact);
    } catch (error) {
      handleRouteError(res, error, "POST /api/contacts");
    }
  });

  app.patch("/api/contacts/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, nameInTranscript, jobTitle } = req.body;

      if (!name) {
        throw new ValidationError("Name is required");
      }

      const contact = await storage.updateContact(
        id,
        name,
        nameInTranscript,
        jobTitle,
      );

      if (!contact) {
        throw new NotFoundError("Contact");
      }

      res.json(contact);
    } catch (error) {
      handleRouteError(res, error, "PATCH /api/contacts/:id");
    }
  });

  app.delete("/api/contacts/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.deleteContact(id);

      if (!success) {
        throw new NotFoundError("Contact");
      }

      res.json({ success: true });
    } catch (error) {
      handleRouteError(res, error, "DELETE /api/contacts/:id");
    }
  });

  app.post(
    "/api/companies/:companyId/merge-duplicate-contacts",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { product } = await getUserAndProduct(req);
        const { companyId } = req.params;

        const company = await storage.getCompany(product, companyId);
        if (!company) {
          throw new NotFoundError("Company");
        }

        const result = await storage.mergeDuplicateContacts(product, companyId);
        res.json(result);
      } catch (error) {
        handleRouteError(res, error, "POST /api/companies/:companyId/merge-duplicate-contacts");
      }
    },
  );

  // POS Systems routes
  app.get("/api/pos-systems", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const systems = await storage.getPOSSystems(product);
      res.json(systems);
    } catch (error) {
      handleRouteError(res, error, "GET /api/pos-systems");
    }
  });

  app.get("/api/pos-systems/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { product } = await getUserAndProduct(req);
      const { id } = req.params;
      const system = await storage.getPOSSystem(product, id);

      if (!system) {
        throw new NotFoundError("POS system");
      }

      res.json(system);
    } catch (error) {
      handleRouteError(res, error, "GET /api/pos-systems/:id");
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
      handleRouteError(res, error, "POST /api/pos-systems");
    }
  });

  app.patch("/api/pos-systems/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, websiteLink, description, companyIds } = req.body;

      if (!name) {
        throw new ValidationError("Name is required");
      }

      const system = await storage.updatePOSSystem(
        id,
        name,
        websiteLink,
        description,
        companyIds,
      );

      if (!system) {
        throw new NotFoundError("POS system");
      }

      res.json(system);
    } catch (error) {
      handleRouteError(res, error, "PATCH /api/pos-systems/:id");
    }
  });

  app.delete("/api/pos-systems/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.deletePOSSystem(id);

      if (!success) {
        throw new NotFoundError("POS system");
      }

      res.json({ success: true });
    } catch (error) {
      handleRouteError(res, error, "DELETE /api/pos-systems/:id");
    }
  });

  app.post("/api/mcp/run", isAuthenticated, async (req: any, res, next) => {
    try {
      const { capability, input } = req.body;

      if (!capability) {
        throw new ValidationError("capability is required");
      }

      const result = await mcp.run(capability, input ?? {});

      res.json({ result });
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // EXTERNAL API - API Key Authentication
  // ==========================================
  
  // Middleware to validate API key
  const validateApiKey = (req: any, res: any, next: any) => {
    const apiKey = req.headers['x-api-key'];
    const expectedKey = process.env.EXTERNAL_API_KEY;
    
    if (!expectedKey) {
      return res.status(500).json({ error: "External API not configured" });
    }
    
    if (!apiKey || apiKey !== expectedKey) {
      return res.status(401).json({ error: "Invalid or missing API key" });
    }
    
    next();
  };

  // GET /api/external/transcripts - List all transcripts
  // Query params:
  //   product: "pitcrew" (default) - which product to query
  //   companyId: filter by company UUID
  //   companyName: filter by company name (partial match, case-insensitive)
  //   status: filter by processing status
  //   limit: max results (default 100)
  //   offset: pagination offset (default 0)
  app.get("/api/external/transcripts", validateApiKey, async (req: any, res) => {
    try {
      const product = (req.query.product as Product) || "pitcrew";
      const companyId = req.query.companyId as string | undefined;
      const companyName = req.query.companyName as string | undefined;
      const status = req.query.status as string | undefined;
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
      const offset = parseInt(req.query.offset as string) || 0;
      
      if (!PRODUCTS.includes(product)) {
        return res.status(400).json({ error: `Invalid product. Must be one of: ${PRODUCTS.join(", ")}` });
      }
      
      let transcripts = await storage.getTranscripts(product);
      
      // Filter by companyId if provided
      if (companyId) {
        transcripts = transcripts.filter(t => t.companyId === companyId);
      }
      
      // Filter by companyName if provided (need to fetch companies first)
      if (companyName) {
        const companies = await storage.getCompanies(product);
        const matchingCompanyIds = new Set(
          companies
            .filter(c => c.name.toLowerCase().includes(companyName.toLowerCase()))
            .map(c => c.id)
        );
        transcripts = transcripts.filter(t => t.companyId && matchingCompanyIds.has(t.companyId));
      }
      
      // Filter by status if provided
      if (status) {
        transcripts = transcripts.filter(t => t.processingStatus === status);
      }
      
      // Apply pagination
      const total = transcripts.length;
      transcripts = transcripts.slice(offset, offset + limit);
      
      res.json({
        success: true,
        total,
        count: transcripts.length,
        offset,
        limit,
        transcripts,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/external/transcripts/:id - Get transcript with full details
  app.get("/api/external/transcripts/:id", validateApiKey, async (req: any, res) => {
    try {
      const { id } = req.params;
      const product = (req.query.product as Product) || "pitcrew";
      
      if (!PRODUCTS.includes(product)) {
        return res.status(400).json({ error: `Invalid product. Must be one of: ${PRODUCTS.join(", ")}` });
      }
      
      const transcript = await storage.getTranscript(product, id);
      
      if (!transcript) {
        return res.status(404).json({ success: false, error: "Transcript not found" });
      }
      
      // Fetch all related data
      const [insights, qaPairs, customerQuestions, actionItems, chunks, company] = await Promise.all([
        storage.getProductInsightsByTranscript(product, id),
        storage.getQAPairsByTranscript(product, id),
        storage.getCustomerQuestionsByTranscript(id),
        storage.getMeetingActionItemsByTranscript(id),
        storage.getChunksForTranscript(id, 1000),
        transcript.companyId ? storage.getCompany(product, transcript.companyId) : Promise.resolve(undefined),
      ]);
      
      res.json({
        success: true,
        transcript,
        company,
        insights,
        qaPairs,
        customerQuestions,
        actionItems,
        chunks: chunks.map((c: { chunkIndex: number; speakerName: string | null; speakerRole: string | null; content: string }) => ({
          chunkIndex: c.chunkIndex,
          speakerName: c.speakerName,
          speakerRole: c.speakerRole,
          content: c.content,
        })),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });
  
  // ===== AIRTABLE INTEGRATION =====

  // Webhook endpoint for Airtable updates (cache invalidation)
  app.post("/api/airtable/webhook", async (req, res) => {
    if (!verifyAirtableWebhook(req)) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    await handleAirtableWebhook(req, res);
  });

  // Force refresh of all Airtable data (can be hit daily via cron/automation)
  app.get("/api/airtable/refresh", async (req, res) => {
    if (!verifyAirtableWebhook(req)) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    await handleAirtableRefresh(req, res);
  });

  // Get all product features from Airtable
  app.get("/api/airtable/features", isAuthenticated, async (req, res) => {
    try {
      const features = await getProductFeaturesFormatted();
      res.json({ success: true, count: features.length, features });
    } catch (error) {
      console.error("[Airtable] Error fetching features:", error);
      res.status(500).json({ success: false, error: "Failed to fetch features" });
    }
  });

  // Get all value propositions from Airtable
  app.get("/api/airtable/value-propositions", isAuthenticated, async (req, res) => {
    try {
      const valuePropositions = await getProductValuePropositionsFormatted();
      res.json({ success: true, count: valuePropositions.length, valuePropositions });
    } catch (error) {
      console.error("[Airtable] Error fetching value propositions:", error);
      res.status(500).json({ success: false, error: "Failed to fetch value propositions" });
    }
  });

  // Search product knowledge (features + value propositions)
  app.get("/api/airtable/search", isAuthenticated, async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query) {
        res.status(400).json({ success: false, error: "Missing query parameter 'q'" });
        return;
      }
      const results = await searchProductKnowledge(query);
      res.json({ 
        success: true, 
        query,
        featuresCount: results.features.length,
        valuePropositionsCount: results.valuePropositions.length,
        ...results 
      });
    } catch (error) {
      console.error("[Airtable] Error searching product knowledge:", error);
      res.status(500).json({ success: false, error: "Search failed" });
    }
  });

  // ===== DYNAMIC AIRTABLE ENDPOINTS =====

  // List all tables (auto-discovered from Airtable)
  app.get("/api/airtable/tables", isAuthenticated, async (req, res) => {
    try {
      const tables = await listTables();
      res.json({ success: true, count: tables.length, tables });
    } catch (error) {
      console.error("[Airtable] Error listing tables:", error);
      res.status(500).json({ success: false, error: "Failed to list tables" });
    }
  });

  // Get full schema (all tables with their fields)
  app.get("/api/airtable/schema", isAuthenticated, async (req, res) => {
    try {
      const schema = await discoverSchema();
      res.json({ success: true, ...schema });
    } catch (error) {
      console.error("[Airtable] Error fetching schema:", error);
      res.status(500).json({ success: false, error: "Failed to fetch schema" });
    }
  });

  // Get records from any table by name
  app.get("/api/airtable/tables/:tableName/records", isAuthenticated, async (req, res) => {
    try {
      const { tableName } = req.params;
      const records = await getRecordsByTableName(tableName);
      res.json({ success: true, table: tableName, count: records.length, records });
    } catch (error) {
      console.error(`[Airtable] Error fetching records from ${req.params.tableName}:`, error);
      const message = error instanceof Error ? error.message : "Failed to fetch records";
      res.status(500).json({ success: false, error: message });
    }
  });

  // Search across all tables
  app.get("/api/airtable/search-all", isAuthenticated, async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query) {
        res.status(400).json({ success: false, error: "Missing query parameter 'q'" });
        return;
      }
      const results = await searchAllTables(query);
      const totalMatches = results.reduce((sum, r) => sum + r.matches.length, 0);
      res.json({ 
        success: true, 
        query,
        tablesSearched: results.length,
        totalMatches,
        results,
      });
    } catch (error) {
      console.error("[Airtable] Error searching all tables:", error);
      res.status(500).json({ success: false, error: "Search failed" });
    }
  });
  
  const httpServer = createServer(app);

  return httpServer;
}
