/**
 * Slack Context Index
 * 
 * Re-exports all context modules for easy importing.
 */

export { createProgressManager, type ProgressContext, type ProgressManager } from './progressManager';
export { resolveThreadContext, shouldReuseThreadContext, type ThreadResolutionResult } from './threadResolver';
export {
  resolveMeetingFromSlackMessage,
  hasTemporalMeetingReference,
  extractCompanyFromMessage,
  type MeetingResolutionResult,
} from './meetingResolver';
export { resolveCompany, type CompanyMention } from './companyResolver';
