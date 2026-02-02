/**
 * Single-Meeting Orchestrator - Backward Compatibility Re-export
 * 
 * This file has been moved to server/openAssistant/singleMeetingOrchestrator.ts
 * as part of the Execution Layer consolidation (Phase 2).
 * 
 * This re-export is maintained for backward compatibility.
 * New code should import from "../openAssistant/singleMeetingOrchestrator" instead.
 * 
 * @deprecated Import from "../openAssistant/singleMeetingOrchestrator" instead
 */

export {
  handleSingleMeetingQuestion,
  detectAmbiguity,
  isBinaryQuestion,
  type SingleMeetingContext,
  type SingleMeetingResult,
} from "../openAssistant/singleMeetingOrchestrator";
