/**
 * Centralized LLM Model Registry
 * 
 * This file serves as the single source of truth for all LLM model selections
 * throughout the application. Changing a model here will update all usages.
 * 
 * MODEL TIERS:
 * 
 * FAST_CLASSIFICATION - gpt-4o-mini
 *   Speed: ~100-300ms | Cost: Lowest | Quality: Good for structured tasks
 *   Use for: Intent classification, quick decisions, progress messages,
 *            simple extractions, confidence scoring
 * 
 * STANDARD_REASONING - gpt-4o  
 *   Speed: ~500-1500ms | Cost: Medium | Quality: High
 *   Use for: Product knowledge responses, customer question extraction,
 *            general assistance, semantic searches, action extraction
 * 
 * HEAVY_ANALYSIS - gpt-5
 *   Speed: ~1500-3000ms | Cost: Highest | Quality: Best
 *   Use for: Transcript analysis, complex multi-step reasoning,
 *            synthesizing large documents, executive summaries
 *   Note: gpt-5 only supports temperature=1 (default)
 * 
 * STREAMING variants use the same models but are marked for clarity
 * when streaming responses are expected.
 */

export const LLM_MODELS = {
  /**
   * Fast, cheap model for quick classification and simple tasks.
   * ~100-300ms response time. Use for intent routing, confidence scoring,
   * progress message generation, and simple structured outputs.
   */
  FAST_CLASSIFICATION: "gpt-4o-mini",

  /**
   * Balanced model for most reasoning tasks.
   * ~500-1500ms response time. Use for product knowledge, customer questions,
   * general assistance, semantic search, and action extraction.
   */
  STANDARD_REASONING: "gpt-4o",

  /**
   * Most capable model for complex analysis.
   * ~1500-3000ms response time. Use for transcript analysis, complex synthesis,
   * and executive-level summaries. Note: Only supports temperature=1.
   */
  HEAVY_ANALYSIS: "gpt-5",
} as const;

export type LLMModelType = typeof LLM_MODELS[keyof typeof LLM_MODELS];

/**
 * Helper to get model description for logging
 */
export function getModelDescription(model: LLMModelType): string {
  switch (model) {
    case LLM_MODELS.FAST_CLASSIFICATION:
      return "fast-classification (gpt-4o-mini)";
    case LLM_MODELS.STANDARD_REASONING:
      return "standard-reasoning (gpt-4o)";
    case LLM_MODELS.HEAVY_ANALYSIS:
      return "heavy-analysis (gpt-5)";
    default:
      return model;
  }
}

/**
 * Specific model assignments by task type.
 * This provides explicit documentation for why each task uses a specific model.
 */
export const MODEL_ASSIGNMENTS = {
  // Control Plane / Intent Classification
  INTENT_CLASSIFICATION: LLM_MODELS.FAST_CLASSIFICATION,
  CONTRACT_SELECTION: LLM_MODELS.FAST_CLASSIFICATION,
  LLM_INTERPRETATION: LLM_MODELS.FAST_CLASSIFICATION,
  
  // Progress & UX
  PROGRESS_MESSAGES: LLM_MODELS.FAST_CLASSIFICATION,
  DOCUMENT_TITLE_GENERATION: LLM_MODELS.FAST_CLASSIFICATION,
  
  // Semantic Search & RAG
  ARTIFACT_SEARCH: LLM_MODELS.FAST_CLASSIFICATION,
  MEETING_RESOLUTION: LLM_MODELS.FAST_CLASSIFICATION,
  RAG_COMPOSITION: LLM_MODELS.FAST_CLASSIFICATION,
  
  // Customer Questions & Extraction
  CUSTOMER_QUESTION_EXTRACTION: LLM_MODELS.STANDARD_REASONING,
  QUESTION_ANSWER_RESOLUTION: LLM_MODELS.STANDARD_REASONING,
  ACTION_ITEM_EXTRACTION: LLM_MODELS.STANDARD_REASONING,
  
  // Response Generation
  PRODUCT_KNOWLEDGE_RESPONSE: LLM_MODELS.STANDARD_REASONING,
  GENERAL_ASSISTANCE: LLM_MODELS.STANDARD_REASONING,
  EXTERNAL_RESEARCH: LLM_MODELS.STANDARD_REASONING,
  SINGLE_MEETING_RESPONSE: LLM_MODELS.STANDARD_REASONING,
  
  // Heavy Analysis
  TRANSCRIPT_ANALYSIS: LLM_MODELS.HEAVY_ANALYSIS,
  EXECUTIVE_SUMMARY: LLM_MODELS.HEAVY_ANALYSIS,
  COMPLEX_SYNTHESIS: LLM_MODELS.HEAVY_ANALYSIS,
} as const;
