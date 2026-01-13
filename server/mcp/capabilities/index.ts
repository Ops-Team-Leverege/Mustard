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

export const capabilities = [
  getCompanyOverview,
  getCompanyInsights,
  getCompanyQuestions,
  searchCompanyFeedback,
  searchQuestions,
  countCompaniesByTopic,
  getLastMeeting,
];
