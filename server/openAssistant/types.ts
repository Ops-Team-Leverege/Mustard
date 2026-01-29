/**
 * Open Assistant Shared Types
 * 
 * Centralized type definitions used across Open Assistant modules.
 * Keeps types consistent and reduces duplication.
 */

import type { SingleMeetingContext, SingleMeetingResult } from "../mcp/singleMeetingOrchestrator";
import { Intent } from "../controlPlane/intent";
import type { AnswerContract, SSOTMode } from "../controlPlane/answerContracts";
import type { ControlPlaneResult } from "../controlPlane";
import type { ResearchResult } from "./externalResearch";
import type { ArtifactSearchResult } from "./semanticArtifactSearch";

/**
 * Evidence Source Type (derived from Control Plane intent)
 * 
 * NOTE: This is NOT a duplicate classifier. The Control Plane (server/controlPlane/intent.ts) 
 * is the SOLE authority for intent classification. This type represents the evidence source
 * that the handler uses for routing, derived directly from the Control Plane intent.
 */
export type EvidenceSource = 
  | "meeting_data"
  | "external_research" 
  | "general_assistance"
  | "hybrid";

/**
 * Intent Classification Result (Control Plane derived)
 * 
 * This type is populated from Control Plane results - never from a separate classifier.
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
  controlPlaneResult?: ControlPlaneResult;
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
 * Derive evidence source from Control Plane intent.
 * 
 * NOTE: This is NOT intent classification. The Control Plane has already classified the intent.
 * This function simply maps the Control Plane intent to the evidence source for routing.
 */
export function deriveEvidenceSource(cpIntent: Intent): EvidenceSource {
  switch (cpIntent) {
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
