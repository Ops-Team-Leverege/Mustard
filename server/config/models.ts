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

  /**
   * Streaming-capable model for progressive response delivery.
   * Same quality as STANDARD_REASONING but marked for streaming use cases.
   * Use when responses should stream to Slack or UI progressively.
   */
  STREAMING_RESPONSE: "gpt-4o",
} as const;

/**
 * Gemini model constants for web-grounded research.
 * Gemini is used for external research with real-time web access.
 */
export const GEMINI_MODELS = {
  /**
   * Fast Gemini model with web grounding capabilities.
   * Used for semantic transcript analysis with 1M token context window.
   */
  FLASH: "gemini-2.5-flash",

  /**
   * Gemini 3 Pro for advanced reasoning and research.
   * 1M token context window, 64K output tokens.
   * Used for General Help responses and external research.
   */
  PRO: "gemini-3-pro-preview",
} as const;

/**
 * Claude model constants for Anthropic's models.
 */
export const CLAUDE_MODELS = {
  /**
   * Claude Opus 4.6 - Anthropic's most capable model.
   * 200K token context (1M beta), 128K output tokens.
   * Best for complex reasoning, coding, and agentic workflows.
   */
  OPUS: "claude-opus-4-6",
} as const;

export type GeminiModelType = typeof GEMINI_MODELS[keyof typeof GEMINI_MODELS];

export type ClaudeModelType = typeof CLAUDE_MODELS[keyof typeof CLAUDE_MODELS];

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
    case LLM_MODELS.STREAMING_RESPONSE:
      return "streaming-response (gpt-4o)";
    default:
      return model;
  }
}

/**
 * Specific model assignments by task type.
 * This provides explicit documentation for why each task uses a specific model.
 */
export const MODEL_ASSIGNMENTS = {
  // Decision Layer / Intent Router - Standard reasoning for better thread context understanding
  INTENT_CLASSIFICATION: LLM_MODELS.STANDARD_REASONING,
  CONTRACT_SELECTION: LLM_MODELS.FAST_CLASSIFICATION,
  LLM_INTERPRETATION: LLM_MODELS.FAST_CLASSIFICATION,
  AGGREGATE_SPECIFICITY_CHECK: LLM_MODELS.FAST_CLASSIFICATION,
  FORMAT_PREFERENCE_EXTRACTION: LLM_MODELS.FAST_CLASSIFICATION,

  // Progress & UX - Fast for immediate feedback
  PROGRESS_MESSAGES: LLM_MODELS.FAST_CLASSIFICATION,
  DOCUMENT_TITLE_GENERATION: LLM_MODELS.FAST_CLASSIFICATION,

  // Slack Search - Standard reasoning for both extraction and synthesis
  SLACK_QUERY_EXTRACTION: LLM_MODELS.STANDARD_REASONING,
  SLACK_SEARCH_SYNTHESIS: LLM_MODELS.STANDARD_REASONING,

  // Semantic Search & RAG - Standard for quality semantic matching
  ARTIFACT_SEARCH: LLM_MODELS.STANDARD_REASONING,
  MEETING_RESOLUTION: LLM_MODELS.STANDARD_REASONING,
  RAG_COMPOSITION: LLM_MODELS.STANDARD_REASONING,

  // Customer Questions & Extraction - Standard for accurate extraction
  CUSTOMER_QUESTION_EXTRACTION: LLM_MODELS.STANDARD_REASONING,
  QUESTION_ANSWER_RESOLUTION: LLM_MODELS.STANDARD_REASONING,
  ACTION_ITEM_EXTRACTION: LLM_MODELS.STANDARD_REASONING,

  // Response Generation (non-streaming) - Standard for quality responses
  PRODUCT_KNOWLEDGE_RESPONSE: LLM_MODELS.STANDARD_REASONING,
  GENERAL_ASSISTANCE: LLM_MODELS.STANDARD_REASONING,
  EXTERNAL_RESEARCH: LLM_MODELS.STANDARD_REASONING,
  SINGLE_MEETING_RESPONSE: LLM_MODELS.STANDARD_REASONING,

  // Streaming Response Generation - For progressive Slack updates
  PRODUCT_KNOWLEDGE_STREAMING: LLM_MODELS.STREAMING_RESPONSE,
  GENERAL_ASSISTANCE_STREAMING: LLM_MODELS.STREAMING_RESPONSE,

  // Heavy Analysis - GPT-5 for complex multi-step reasoning
  TRANSCRIPT_ANALYSIS: LLM_MODELS.HEAVY_ANALYSIS,
  EXECUTIVE_SUMMARY: LLM_MODELS.HEAVY_ANALYSIS,
  COMPLEX_SYNTHESIS: LLM_MODELS.HEAVY_ANALYSIS,

  // Semantic Answer - Gemini 2.5 Flash for fast transcript analysis with 1M context
  SEMANTIC_ANSWER_SYNTHESIS: GEMINI_MODELS.FLASH,

  /**
   * GENERAL_HELP responses - comprehensive document generation
   * Uses Claude Opus 4.6 for advanced reasoning and long-form content
   * ~8000 token responses for executive-ready documents
   * Fallback chain: Claude → Gemini 3 Pro → OpenAI GPT-4o
   */
  GENERAL_HELP_RESPONSE: GEMINI_MODELS.FLASH,
  GENERAL_HELP_FALLBACK_1: GEMINI_MODELS.PRO,
  GENERAL_HELP_FALLBACK_2: LLM_MODELS.STANDARD_REASONING,

  // Multi-Meeting Synthesis - Pattern analysis across meetings
  MULTI_MEETING_SYNTHESIS: LLM_MODELS.STANDARD_REASONING,

  // Gemini - Web-grounded research tasks (Gemini 3 Pro for deeper analysis)
  EXTERNAL_RESEARCH_WEB: GEMINI_MODELS.PRO,
  WEBSITE_ANALYSIS: GEMINI_MODELS.PRO,
} as const;

/**
 * Token limits by model
 */
export const TOKEN_LIMITS: Record<string, number> = {
  [LLM_MODELS.FAST_CLASSIFICATION]: 1000,
  [LLM_MODELS.STANDARD_REASONING]: 2000,
  [LLM_MODELS.HEAVY_ANALYSIS]: 4000,
  [GEMINI_MODELS.FLASH]: 8000,
  [GEMINI_MODELS.PRO]: 8000,
  [CLAUDE_MODELS.OPUS]: 8000,
};
