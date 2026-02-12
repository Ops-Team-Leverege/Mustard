/**
 * Structured Interaction Metadata for Logging (v2)
 * 
 * Updated for Intent → Context Layers → Sequential Contracts architecture.
 * 
 * Key logging fields:
 * - intent: Single intent per request (immutable after classification)
 * - contract_chain: Ordered list of contracts executed
 * - ssot_mode: Per-contract authority level (descriptive/authoritative/none)
 * 
 * This metadata is logged for:
 * - End-to-end debugging via interaction_logs
 * - Testing and regression analysis
 * - Auditing LLM usage
 * - Authority control auditing
 * 
 * NOT for user-visible responses.
 */

import type { ContextLayers } from "../decisionLayer/contextLayers";
import type { Intent } from "../decisionLayer/intent";
import type { AnswerContract, SSOTMode } from "../decisionLayer/answerContracts";

export type EntryPoint = "slack" | "api" | "test";

export type LegacyIntent =
  | "next_steps"
  | "summary"
  | "attendees"
  | "binary"
  | "prep"
  | "content"
  | "unknown";

export type AnswerShape =
  | "single_value"
  | "yes_no"
  | "list"
  | "summary"
  | "none";

export type DataSource = "meeting_artifacts" | "semantic" | "product_ssot" | "not_found" | "external";

export type MeetingArtifactType =
  | "action_items"
  | "attendees"
  | "customer_questions"
  | "qa_pairs"
  | null;

export type LlmPurpose =
  | "intent_classification"
  | "contract_selection"
  | "semantic_answer"
  | "summary"
  | "routing"
  | "external_research"
  | "general_assistance"
  | null;

export type ResolutionSource =
  | "thread"
  | "extracted"
  | "explicit"
  | "last_meeting"
  | "none";

export type ClarificationType =
  | "next_steps_or_summary"
  | "takeaways_or_next_steps"
  | null;

export type ClarificationResolution =
  | "next_steps"
  | "summary"
  | null;

export type ContractChainEntry = {
  contract: AnswerContract | string;
  ssot_mode: SSOTMode;
  selection_method: "keyword" | "llm" | "default";
};

export interface InteractionMetadata {
  entry_point: EntryPoint;

  intent: Intent | LegacyIntent;
  intent_detection_method: "keyword" | "pattern" | "entity" | "llm" | "default";

  answer_contract: AnswerContract | string;
  contract_selection_method: "keyword" | "llm" | "default";

  contract_chain?: ContractChainEntry[];

  context_layers: ContextLayers;

  answer_shape: AnswerShape;

  ambiguity?: {
    detected: boolean;
    clarification_asked: boolean;
    type: ClarificationType;
  };

  clarification_state?: {
    awaiting: boolean;
    resolved_with: ClarificationResolution;
  };

  data_source: DataSource;
  artifact_type: MeetingArtifactType;

  llm_usage: {
    total_calls: number;
    purposes: LlmPurpose[];
  };

  resolution: {
    company_id?: string;
    company_name?: string;
    meeting_id?: string | null;
    company_source: ResolutionSource;
    meeting_source: ResolutionSource;
  };

  evidence_sources?: Array<{
    type: string;
    id?: string;
    snippet?: string;
  }>;

  meeting_detection?: {
    regex_result: boolean;
    llm_called: boolean;
    llm_result: boolean | null;
    llm_latency_ms: number | null;
  };

  open_assistant?: {
    intent: string;
    data_source: string;
    delegated_to_single_meeting: boolean;
  };

  isSingleMeetingMode?: boolean;
  isBinaryQuestion?: boolean;
  semanticAnswerUsed?: boolean;
  semanticConfidence?: string;

  awaitingClarification?: ClarificationType;
  pendingOffer?: string;

  test_run?: boolean;
}

export interface DecisionLayerMetadata {
  intent: Intent;
  intentDetectionMethod: "keyword" | "pattern" | "entity" | "llm" | "default";
  contextLayers: ContextLayers;
  answerContract: AnswerContract;
  contractSelectionMethod: "keyword" | "llm" | "default";
  ssotMode?: SSOTMode;
  contractChain?: ContractChainEntry[];
}

// Backward compatibility alias
export type ControlPlaneMetadata = DecisionLayerMetadata;

/**
 * Build structured metadata for interaction logging.
 * Updated for Decision Layer architecture.
 */
export function buildInteractionMetadata(
  base: {
    companyId?: string;
    companyName?: string;
    meetingId?: string | null;
  },
  execution: {
    entryPoint: EntryPoint;
    decisionLayer?: DecisionLayerMetadata;
    legacyIntent?: LegacyIntent;
    answerShape: AnswerShape;
    dataSource: DataSource;
    artifactType?: MeetingArtifactType;
    llmPurposes?: LlmPurpose[];
    companySource?: ResolutionSource;
    meetingSource?: ResolutionSource;
    ambiguity?: {
      detected: boolean;
      clarificationAsked: boolean;
      type: ClarificationType;
    };
    clarificationState?: {
      awaiting: boolean;
      resolvedWith: ClarificationResolution;
    };
    evidenceSources?: Array<{
      type: string;
      id?: string;
      snippet?: string;
    }>;
    isBinaryQuestion?: boolean;
    semanticAnswerUsed?: boolean;
    semanticConfidence?: string;
    awaitingClarification?: ClarificationType;
    pendingOffer?: string;
    lastResponseType?: string; // For follow-up context (e.g., "customer_questions")
    testRun?: boolean;
    meetingDetection?: {
      regexResult: boolean;
      llmCalled: boolean;
      llmResult: boolean | null;
      llmLatencyMs: number | null;
    };
    openAssistant?: {
      intent: string;
      dataSource: string;
      delegatedToSingleMeeting: boolean;
    };
  }
): InteractionMetadata {
  const llmPurposes = execution.llmPurposes || [];

  const defaultContextLayers: ContextLayers = {
    product_identity: true,
    product_ssot: false,
    single_meeting: false,
    multi_meeting: false,
    slack_search: false,
  };

  // Build context layers with follow-up tracking
  const contextLayers = {
    ...(execution.decisionLayer?.contextLayers || defaultContextLayers),
    ...(execution.lastResponseType && { lastResponseType: execution.lastResponseType }),
  };

  return {
    entry_point: execution.entryPoint,

    intent: execution.decisionLayer?.intent || execution.legacyIntent || "unknown",
    intent_detection_method: execution.decisionLayer?.intentDetectionMethod || "default",

    answer_contract: execution.decisionLayer?.answerContract || "GENERAL_RESPONSE",
    contract_selection_method: execution.decisionLayer?.contractSelectionMethod || "default",

    contract_chain: execution.decisionLayer?.contractChain,

    context_layers: contextLayers,

    answer_shape: execution.answerShape,

    ambiguity: execution.ambiguity ? {
      detected: execution.ambiguity.detected,
      clarification_asked: execution.ambiguity.clarificationAsked,
      type: execution.ambiguity.type,
    } : undefined,

    clarification_state: execution.clarificationState ? {
      awaiting: execution.clarificationState.awaiting,
      resolved_with: execution.clarificationState.resolvedWith,
    } : undefined,

    data_source: execution.dataSource,
    artifact_type: execution.artifactType || null,

    llm_usage: {
      total_calls: llmPurposes.filter(p => p !== null).length,
      purposes: llmPurposes,
    },

    resolution: {
      company_id: base.companyId,
      company_name: base.companyName,
      meeting_id: base.meetingId,
      company_source: execution.companySource || "none",
      meeting_source: execution.meetingSource || "none",
    },

    evidence_sources: execution.evidenceSources,

    meeting_detection: execution.meetingDetection ? {
      regex_result: execution.meetingDetection.regexResult,
      llm_called: execution.meetingDetection.llmCalled,
      llm_result: execution.meetingDetection.llmResult,
      llm_latency_ms: execution.meetingDetection.llmLatencyMs,
    } : undefined,

    open_assistant: execution.openAssistant ? {
      intent: execution.openAssistant.intent,
      data_source: execution.openAssistant.dataSource,
      delegated_to_single_meeting: execution.openAssistant.delegatedToSingleMeeting,
    } : undefined,

    isSingleMeetingMode: execution.entryPoint === "slack",
    isBinaryQuestion: execution.isBinaryQuestion,
    semanticAnswerUsed: execution.semanticAnswerUsed,
    semanticConfidence: execution.semanticConfidence,

    awaitingClarification: execution.awaitingClarification,
    pendingOffer: execution.pendingOffer,

    test_run: execution.testRun,
  };
}

export {
  type Intent,
  type AnswerContract,
  type ContextLayers,
};
