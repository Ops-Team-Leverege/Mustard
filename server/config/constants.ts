/**
 * Centralized Constants
 * 
 * All magic numbers and configuration values should be defined here.
 * Grouped by domain for easy discovery and maintenance.
 */

// ============================================================================
// MEETING LIMITS
// ============================================================================
export const MEETING_LIMITS = {
  /** Maximum transcripts to fetch for cross-meeting analysis */
  MAX_TOTAL_TRANSCRIPTS: 100,
  /** Maximum meetings to fetch per company */
  MAX_MEETINGS_PER_COMPANY: 25,
  /** Default chunk limit for meeting content */
  CHUNK_LIMIT_DEFAULT: 50,
  /** Extended chunk limit when looking for commitments (end of meetings) */
  CHUNK_LIMIT_COMMITMENTS: 5000,
  /** Chunk limit for full transcript retrieval */
  CHUNK_LIMIT_FULL: 1000,
  /** Chunk limit for meeting summaries */
  CHUNK_LIMIT_SUMMARY: 100,
} as const;

// ============================================================================
// STREAMING
// ============================================================================
export const STREAMING = {
  /** Minimum interval between Slack message updates (ms) */
  UPDATE_INTERVAL_MS: 1000,
  /** Minimum characters accumulated before first Slack update */
  MIN_CONTENT_FOR_UPDATE: 50,
} as const;

// ============================================================================
// TIMEOUTS
// ============================================================================
export const TIMEOUTS = {
  /** Timeout for website fetch operations (ms) */
  WEBSITE_FETCH_MS: 15000,
  /** Timeout for semantic answer operations (ms) */
  SEMANTIC_ANSWER_MS: 60000,
  /** Slack signature tolerance (seconds) - 5 minutes */
  SLACK_SIGNATURE_TOLERANCE_SECONDS: 300,
} as const;

// ============================================================================
// CONTENT LIMITS
// ============================================================================
export const CONTENT_LIMITS = {
  /** Maximum characters for website content */
  WEBSITE_CONTENT_MAX_CHARS: 15000,
  /** Truncation length for chunk previews */
  CHUNK_PREVIEW_LENGTH: 300,
  /** Truncation length for log messages */
  LOG_PREVIEW_LENGTH: 50,
  /** Truncation length for question displays */
  QUESTION_PREVIEW_LENGTH: 100,
} as const;

// ============================================================================
// LLM TOKENS
// ============================================================================
export const LLM_TOKENS = {
  /** Max tokens for progress message generation */
  PROGRESS_MESSAGE_MAX: 50,
  /** Max tokens for synthesis operations */
  SYNTHESIS_MAX: 2000,
} as const;

// ============================================================================
// SEMANTIC SEARCH
// ============================================================================
export const SEMANTIC_SEARCH = {
  /** Minimum relevance score to include in results (0-100) */
  MIN_RELEVANCE_SCORE: 50,
  /** High relevance threshold */
  HIGH_RELEVANCE_THRESHOLD: 80,
} as const;
