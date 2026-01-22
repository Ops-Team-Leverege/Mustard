/**
 * Open Assistant Module
 * 
 * Exports for the Open Assistant capability that extends
 * the existing Slack/MCP flow with intent-driven branching.
 */

export { classifyIntent, needsClarification, type IntentClassification, type OpenAssistantIntent } from "./intentClassifier";
export { performExternalResearch, formatCitationsForDisplay, type ResearchResult, type Citation } from "./externalResearch";
export { searchArtifactsSemanticly, searchArtifactsAcrossMeetings, formatArtifactResults, type ArtifactSearchResult } from "./semanticArtifactSearch";
export { handleOpenAssistant, shouldUseOpenAssistant, type OpenAssistantContext, type OpenAssistantResult } from "./openAssistantHandler";
