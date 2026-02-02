/**
 * Validation Middleware
 * 
 * Provides Zod-based request validation for body, params, and query.
 * Integrates with existing error handling via ValidationError.
 */

import { Request, Response, NextFunction, RequestHandler } from "express";
import { z, ZodSchema, ZodError } from "zod";
import { ValidationError } from "../utils/errorHandler";

export interface ValidationSchemas {
  body?: ZodSchema;
  params?: ZodSchema;
  query?: ZodSchema;
}

/**
 * Creates a validation middleware that validates request parts against Zod schemas.
 * 
 * @example
 * app.patch("/api/transcripts/:id", 
 *   isAuthenticated, 
 *   validate({ 
 *     params: z.object({ id: z.string().uuid() }),
 *     body: updateTranscriptSchema 
 *   }), 
 *   async (req, res) => { ... }
 * );
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schemas.params) {
        req.params = schemas.params.parse(req.params);
      }
      if (schemas.query) {
        (req as any).query = schemas.query.parse(req.query);
      }
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const messages = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
        next(new ValidationError(messages));
      } else {
        next(error);
      }
    }
  };
}

// Common parameter schemas
export const commonSchemas = {
  id: z.object({
    id: z.string().min(1, "ID is required"),
  }),
  uuidId: z.object({
    id: z.string().uuid("Invalid UUID format"),
  }),
  pagination: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
  search: z.object({
    q: z.string().optional(),
    search: z.string().optional(),
  }),
};

// Update schemas for PATCH endpoints
export const updateSchemas = {
  transcript: z.object({
    name: z.string().nullable().optional(),
    createdAt: z.string().datetime().optional(),
    mainMeetingTakeaways: z.string().nullable().optional(),
    nextSteps: z.string().nullable().optional(),
    supportingMaterials: z.array(z.string()).optional(),
    transcript: z.string().nullable().optional(),
  }).refine(data => Object.keys(data).length > 0, {
    message: "At least one field must be provided for update",
  }),

  insight: z.object({
    feature: z.string().min(1, "Feature is required"),
    context: z.string().min(1, "Context is required"),
    quote: z.string().min(1, "Quote is required"),
    company: z.string().min(1, "Company is required"),
  }),

  qaPair: z.object({
    question: z.string().min(1, "Question is required"),
    answer: z.string().min(1, "Answer is required"),
    asker: z.string().min(1, "Asker is required"),
    company: z.string().min(1, "Company is required"),
    contactId: z.string().nullable().optional(),
  }),

  qaPairStar: z.object({
    isStarred: z.boolean(),
  }),

  category: z.object({
    name: z.string().min(1, "Name is required"),
    description: z.string().nullable().optional(),
  }),

  feature: z.object({
    name: z.string().min(1, "Name is required"),
    description: z.string().nullable().optional(),
    value: z.string().nullable().optional(),
    videoLink: z.string().url().nullable().optional(),
    helpGuideLink: z.string().url().nullable().optional(),
    categoryId: z.string().nullable().optional(),
    releaseDate: z.string().datetime().nullable().optional(),
  }),

  company: z.object({
    name: z.string().min(1, "Name is required"),
    notes: z.string().nullable().optional(),
    companyDescription: z.string().nullable().optional(),
    numberOfStores: z.string().nullable().optional(),
    stage: z.string().nullable().optional(),
    pilotStartDate: z.string().datetime().nullable().optional(),
    serviceTags: z.array(z.string()).nullable().optional(),
  }),

  contact: z.object({
    name: z.string().min(1, "Name is required"),
    nameInTranscript: z.string().nullable().optional(),
    jobTitle: z.string().nullable().optional(),
  }),

  posSystem: z.object({
    name: z.string().min(1, "Name is required"),
    websiteLink: z.string().url().nullable().optional(),
    description: z.string().nullable().optional(),
    companyIds: z.array(z.string()).nullable().optional(),
  }),
};

// Query parameter schemas for search/list endpoints
export const querySchemas = {
  transcriptList: z.object({
    search: z.string().optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    sortBy: z.enum(["createdAt", "meetingDate", "name"]).optional(),
    sortOrder: z.enum(["asc", "desc"]).optional(),
  }),

  insightList: z.object({
    search: z.string().optional(),
    categoryId: z.string().optional(),
    companyId: z.string().optional(),
  }),

  qaPairList: z.object({
    search: z.string().optional(),
    categoryId: z.string().optional(),
    companyId: z.string().optional(),
    starred: z.coerce.boolean().optional(),
  }),

  externalApi: z.object({
    product: z.string().optional(),
    search: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),
};

export type UpdateTranscriptInput = z.infer<typeof updateSchemas.transcript>;
export type UpdateInsightInput = z.infer<typeof updateSchemas.insight>;
export type UpdateQAPairInput = z.infer<typeof updateSchemas.qaPair>;
export type UpdateCategoryInput = z.infer<typeof updateSchemas.category>;
export type UpdateFeatureInput = z.infer<typeof updateSchemas.feature>;
export type UpdateCompanyInput = z.infer<typeof updateSchemas.company>;
export type UpdateContactInput = z.infer<typeof updateSchemas.contact>;
export type UpdatePosSystemInput = z.infer<typeof updateSchemas.posSystem>;
