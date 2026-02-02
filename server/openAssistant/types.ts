/**
 * Open Assistant Shared Types
 * 
 * Centralized type definitions used across Open Assistant modules.
 * Keeps types consistent and reduces duplication.
 */

import type { SingleMeetingContext, SingleMeetingResult } from "../mcp/singleMeetingOrchestrator";
import { Intent } from "../decisionLayer/intent";
import type { AnswerContract, SSOTMode } from "../decisionLayer/answerContracts";
import type { DecisionLayerResult } from "../decisionLayer";
import type { ResearchResult } from "./externalResearch";
import type { ArtifactSearchResult } from "./semanticArtifactSearch";

/**
 * Evidence Source Type (derived from Decision Layer intent)
 * 
 * NOTE: This is NOT a duplicate classifier. The Intent Router (server/decisionLayer/intent.ts) 
 * is the SOLE authority for intent classification. This type represents the evidence source
 * that the handler uses for routing, derived directly from the Decision Layer intent.
 */
export type EvidenceSource = 
  | "meeting_data"
  | "external_research" 
  | "general_assistance"
  | "hybrid";

/**
 * Intent Classification Result (Decision Layer derived)
 * 
 * This type is populated from Decision Layer results - never from a separate classifier.
 * Kept for API compatibility with existing handler functions.
 */
export type IntentClassification = {
  intent: EvidenceSource;
  confidence: "high" | "medium" | "low";
  rationale: string;
  meetingRelevance: {
    referencesSpecificInteraction: boolean;
    asksWhatWasSaidOrAgreed: boolean;
    asksAboutCustomerQuestions: boolean;
  };
  researchRelevance: {
    needsPublicInfo: boolean;
    companyOrEntityMentioned: string | null;
    topicForResearch: string | null;
  };
  suggestedClarification?: string;
};

export type SlackStreamingContext = {
  channel: string;
  messageTs: string;
  threadTs: string;
};

export type ThreadMessage = {
  text: string;
  isBot: boolean;
};

export type OpenAssistantContext = {
  userId?: string;
  threadId?: string;
  conversationContext?: string;
  threadMessages?: ThreadMessage[];
  resolvedMeeting?: SingleMeetingContext | null;
  decisionLayerResult?: DecisionLayerResult;
  slackStreaming?: SlackStreamingContext;
};

export type OpenAssistantResult = {
  answer: string;
  intent: EvidenceSource;
  intentClassification: IntentClassification;
  controlPlaneIntent?: Intent;
  answerContract?: AnswerContract;
  answerContractChain?: AnswerContract[];
  ssotMode?: SSOTMode;
  dataSource: "meeting_artifacts" | "external_research" | "general_knowledge" | "hybrid" | "clarification" | "product_ssot";
  researchCitations?: ResearchResult["citations"];
  artifactMatches?: ArtifactSearchResult;
  singleMeetingResult?: SingleMeetingResult;
  delegatedToSingleMeeting: boolean;
  evidenceSources?: string[];
  progressMessage?: string; // Optional: User-friendly message explaining what we're doing (for long operations)
};

/**
 * Structured decision log for contract chain execution.
 * HARDENING: Logs should explain WHY decisions were made.
 */
export type ContractExecutionDecision = {
  contract: AnswerContract;
  authority: SSOTMode;
  authorityValidated: boolean;
  evidenceCount: number;
  executionOutcome: "executed" | "short_circuit_clarify" | "short_circuit_refuse" | "evidence_threshold_not_met" | "empty_evidence";
};

/**
 * Create a default classification with low confidence.
 */
export function defaultClassification(rationale: string): IntentClassification {
  return {
    intent: "general_assistance",
    confidence: "low",
    rationale,
    meetingRelevance: {
      referencesSpecificInteraction: false,
      asksWhatWasSaidOrAgreed: false,
      asksAboutCustomerQuestions: false,
    },
    researchRelevance: {
      needsPublicInfo: false,
      companyOrEntityMentioned: null,
      topicForResearch: null,
    },
  };
}

/**
 * Derive evidence source from Decision Layer intent.
 * 
 * NOTE: This is NOT intent classification. The Intent Router has already classified the intent.
 * This function simply maps the Decision Layer intent to the evidence source for routing.
 */
export function deriveEvidenceSource(dlIntent: Intent): EvidenceSource {
  switch (dlIntent) {
    case Intent.SINGLE_MEETING:
    case Intent.MULTI_MEETING:
      return "meeting_data";
    case Intent.PRODUCT_KNOWLEDGE:
      return "general_assistance";
    case Intent.EXTERNAL_RESEARCH:
      return "general_assistance"; // External research uses web sources
    case Intent.DOCUMENT_SEARCH:
      return "general_assistance";
    case Intent.GENERAL_HELP:
    case Intent.REFUSE:
    case Intent.CLARIFY:
    default:
      return "general_assistance";
  }
}
