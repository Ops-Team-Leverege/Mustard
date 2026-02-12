/**
 * Shared Meeting Types
 * 
 * Core type definitions for meeting scope resolution used across:
 * - Decision Layer (intent routing)
 * - Execution Layer (contract execution)
 * - Slack event handling
 * 
 * These types are the single source of truth for meeting context.
 */

/**
 * Context for a resolved single meeting.
 * Used by the Execution Layer when executing single-meeting contracts.
 */
export type SingleMeetingContext = {
  meetingId: string;
  companyId: string;
  companyName: string;
  meetingDate?: Date | null;
};

/**
 * Thread context for meeting resolution.
 * Passed from Slack threads to maintain meeting scope across messages.
 */
export type MeetingThreadContext = {
  meetingId?: string | null;
  companyId?: string | null;
};

/**
 * Result of meeting resolution attempt.
 * Discriminated union for type-safe handling of resolution outcomes.
 */
export type MeetingResolutionResult =
  | { resolved: true; meetingId: string; companyId: string; companyName: string; meetingDate?: Date | null; wasAutoSelected?: boolean }
  | { resolved: false; needsClarification: true; message: string; options?: Array<{ meetingId: string; date: Date; companyName: string }> }
  | { resolved: false; needsClarification: false; reason: string };

/**
 * Result from single meeting execution.
 */
export type SingleMeetingResult = {
  answer: string;
  intent: "extractive" | "aggregative" | "summary" | "drafting";
  dataSource: "attendees" | "qa_pairs" | "action_items" | "transcript" | "summary" | "semantic" | "not_found" | "clarification" | "binary_answer";
  evidence?: string;
  pendingOffer?: "summary" | "slack_search";
  semanticAnswerUsed?: boolean;
  semanticConfidence?: "high" | "medium" | "low";
  semanticError?: string;
  isClarificationRequest?: boolean;
  isBinaryQuestion?: boolean;
  progressMessage?: string;
};

/**
 * Meeting search result with optional topic filter.
 */
export type MeetingSearchResult = {
  meetings: SingleMeetingContext[];
  searchedFor: string;
  topic?: string;
};
