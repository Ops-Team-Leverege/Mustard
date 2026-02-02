/**
 * Slack Meeting Resolution - Backward Compatibility Re-export
 * 
 * This file has been moved to server/slack/meetingResolver.ts
 * as part of the Phase 3 consolidation.
 * 
 * This re-export is maintained for backward compatibility.
 * New code should import from "../slack/meetingResolver" instead.
 * 
 * @deprecated Import from "../slack/meetingResolver" instead
 */

export {
  resolveMeetingFromSlackMessage,
  hasTemporalMeetingReference,
  hasTemporalMeetingReferenceSync,
  extractCompanyFromMessage,
  type MeetingResolutionResult,
  type MeetingResolverThreadContext,
} from "../slack/meetingResolver";
