/**
 * Open Assistant Module
 * 
 * Exports for the Open Assistant capability.
 * 
 * Architecture:
 * - openAssistantHandler.ts: Thin orchestration layer (wires modules together)
 * - meetingResolver.ts: Meeting lookup and scope resolution
 * - contractExecutor.ts: Contract chain execution and evidence enforcement
 * - types.ts: Shared type definitions
 * 
 * NOTE: Intent classification is handled EXCLUSIVELY by the Intent Router (server/decisionLayer/intent.ts).
 * This module no longer exports any intent classification logic - the Decision Layer is the single source of truth.
 */

export { performExternalResearch, formatCitationsForDisplay, type ResearchResult, type Citation } from "./externalResearch";
export { searchArtifactsSemanticly, searchArtifactsAcrossMeetings, formatArtifactResults, type ArtifactSearchResult } from "./semanticArtifactSearch";
export { handleOpenAssistant, shouldUseOpenAssistant, type OpenAssistantContext, type OpenAssistantResult } from "./openAssistantHandler";
export { findRelevantMeetings, searchAcrossMeetings, extractSearchTerms, extractTopic, type MeetingSearchResult } from "./meetingResolver";
export { executeContractChain, mapOrchestratorIntentToContract, type CoverageContext } from "./contractExecutor";
export { type EvidenceSource, type IntentClassification, defaultClassification, deriveEvidenceSource } from "./types";
