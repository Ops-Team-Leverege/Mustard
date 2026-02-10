/**
 * Application Constants
 * 
 * Centralized configuration values used across the application.
 * Consolidates magic numbers and hardcoded values for easier maintenance.
 */

/**
 * Meeting-related constants
 */
export const MEETING_CONSTANTS = {
  /**
   * Meeting-like words that users use to refer to meetings.
   * Used in regex patterns for meeting resolution.
   */
  MEETING_WORDS: "meeting|call|transcript|sync|session|conversation|chat|touchpoint|demo|visit",

  /**
   * Maximum chunk size for transcript splitting (characters).
   */
  MAX_CHUNK_SIZE: 15000,

  /**
   * Maximum number of chunks to retrieve for semantic search.
   */
  MAX_CHUNKS_FOR_SEARCH: 10,
} as const;

/**
 * Progress message configuration
 */
export const PROGRESS_MESSAGE_CONSTANTS = {
  /**
   * Maximum number of progress messages to send during processing.
   */
  MAX_PROGRESS_MESSAGES: 4,

  /**
   * Delay between progress messages (milliseconds).
   * Actual delay is randomized around this value.
   */
  BASE_DELAY_MS: 8000,
} as const;

/**
 * Timeout configuration
 */
export const TIMEOUT_CONSTANTS = {
  /**
   * OpenAI API timeout for very long transcripts (milliseconds).
   */
  TRANSCRIPT_ANALYSIS_TIMEOUT_MS: 180000, // 3 minutes

  /**
   * Standard API timeout (milliseconds).
   */
  STANDARD_API_TIMEOUT_MS: 60000, // 1 minute

  /**
   * Website fetch timeout (milliseconds).
   */
  WEBSITE_FETCH_MS: 10000, // 10 seconds

  /**
   * Max age (seconds) of a Slack request timestamp before it's rejected as a replay attack.
   */
  SLACK_SIGNATURE_TOLERANCE_SECONDS: 300, // 5 minutes
} as const;

export const TIMEOUTS = TIMEOUT_CONSTANTS;

/**
 * Session and authentication configuration
 */
export const AUTH_CONSTANTS = {
  /**
   * Session TTL (milliseconds).
   */
  SESSION_TTL_MS: 7 * 24 * 60 * 60 * 1000, // 1 week

  /**
   * OIDC configuration cache duration (milliseconds).
   */
  OIDC_CONFIG_CACHE_MS: 3600 * 1000, // 1 hour
} as const;

/**
 * Rate limiting configuration
 */
export const RATE_LIMIT_CONSTANTS = {
  /**
   * Authentication rate limit window (milliseconds).
   */
  AUTH_WINDOW_MS: 15 * 60 * 1000, // 15 minutes

  /**
   * Maximum authentication attempts per window.
   */
  AUTH_MAX_ATTEMPTS: 10,
} as const;

/**
 * Batch processing configuration
 */
export const CONTENT_LIMITS = {
  /**
   * Maximum characters to keep from fetched website content.
   */
  WEBSITE_CONTENT_MAX_CHARS: 50000,
} as const;

export const BATCH_CONSTANTS = {
  /**
   * Default batch size for processing operations.
   */
  DEFAULT_BATCH_SIZE: 50,

  /**
   * Maximum batch size to prevent memory issues.
   */
  MAX_BATCH_SIZE: 100,
} as const;
