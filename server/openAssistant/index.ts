/**
 * Open Assistant Module
 * 
 * Exports for the Open Assistant capability.
 * 
 * NOTE: Intent classification is handled EXCLUSIVELY by the Control Plane (server/controlPlane/intent.ts).
 * This module no longer exports any intent classification logic - the Control Plane is the single source of truth.
 */

export { performExternalResearch, formatCitationsForDisplay, type ResearchResult, type Citation } from "./externalResearch";
export { searchArtifactsSemanticly, searchArtifactsAcrossMeetings, formatArtifactResults, type ArtifactSearchResult } from "./semanticArtifactSearch";
export { handleOpenAssistant, shouldUseOpenAssistant, type OpenAssistantContext, type OpenAssistantResult } from "./openAssistantHandler";
