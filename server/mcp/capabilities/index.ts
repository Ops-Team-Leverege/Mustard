/**
 * MCP capability.
 *
 * Responsibilities:
 * - Validate and normalize user input
 * - Resolve entities (e.g. company names → IDs)
 * - Route requests to the appropriate downstream system (RAG, storage, etc.)
 *
 * Capabilities MUST NOT:
 * - Contain business logic
 * - Query the database directly (except via storage)
 * - Call LLMs directly for reasoning
 *
 * Layer: MCP (intent routing & orchestration)
 */


import { getCompanyOverview } from "./getCompanyOverview";
import { getCompanyInsights } from "./getCompanyInsights";
import { getCompanyQuestions } from "./getCompanyQuestions";
import { searchCompanyFeedback } from "./searchCompanyFeedback";
import { searchQuestions } from "./searchQuestions";
import { countCompaniesByTopic } from "./countCompaniesByTopic";
import { getLastMeeting } from "./getLastMeeting";
import { getMeetingAttendees } from "./getMeetingAttendees";

/**
 * Capability Routing Order (LLM selects based on descriptions)
 * 
 * For meeting-related questions, routing precedence:
 * 1. getMeetingAttendees - "who attended", "participants" (data retrieval)
 * 2. getLastMeeting - next steps/action items, specific Q&A, summaries
 * 
 * The LLM classifier routes based on capability descriptions.
 * getMeetingAttendees is listed BEFORE getLastMeeting so its description
 * takes precedence when both could theoretically match.
 */
export const capabilities = [
  getCompanyOverview,
  getCompanyInsights,
  getCompanyQuestions,
  searchCompanyFeedback,
  searchQuestions,
  countCompaniesByTopic,
  getMeetingAttendees,  // Before getLastMeeting - attendee questions are first-class
  getLastMeeting,
];
