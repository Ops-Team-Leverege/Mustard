/**
 * Structured Interaction Metadata for Single-Meeting Logging
 * 
 * This metadata is logged in resolved_entities (JSONB) for:
 * - Testing and regression analysis
 * - Debugging execution paths
 * - Auditing LLM usage
 * 
 * NOT for user-visible responses.
 */

export type EntryPoint = "preflight" | "single_meeting" | "mcp_router";

export type Intent = 
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

export type DataSource = "tier1" | "semantic" | "not_found";

export type Tier1Entity = 
  | "action_items" 
  | "attendees" 
  | "customer_questions" 
  | null;

export type LlmPurpose = 
  | "semantic_answer" 
  | "summary" 
  | "routing" 
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

export interface InteractionMetadata {
  entry_point: EntryPoint;
  intent: Intent;
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
  tier1_entity: Tier1Entity;
  
  llm: {
    used: boolean;
    purpose: LlmPurpose;
  };
  
  resolution: {
    company_source: ResolutionSource;
    meeting_source: ResolutionSource;
  };

  // Backward-compatible fields (still included for existing queries)
  companyId?: string;
  companyName?: string;
  meetingId?: string | null;
  isSingleMeetingMode?: boolean;
  isBinaryQuestion?: boolean;
  semanticAnswerUsed?: boolean;
  semanticConfidence?: string;
  
  // CRITICAL: Legacy fields required for thread context fast-path
  // These must remain at top level for getLastInteractionByThread to work
  awaitingClarification?: ClarificationType;
  pendingOffer?: string;
  
  // Test run indicator for filtering test data
  test_run?: boolean;
}

/**
 * Build structured metadata for interaction logging.
 * 
 * @param base - Core identification fields
 * @param execution - Execution path metadata
 * @returns Complete metadata object for resolved_entities
 */
export function buildInteractionMetadata(
  base: {
    companyId?: string;
    companyName?: string;
    meetingId?: string | null;
  },
  execution: {
    entryPoint: EntryPoint;
    intent: Intent;
    answerShape: AnswerShape;
    dataSource: DataSource;
    tier1Entity?: Tier1Entity;
    llmUsed: boolean;
    llmPurpose?: LlmPurpose;
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
    isBinaryQuestion?: boolean;
    semanticAnswerUsed?: boolean;
    semanticConfidence?: string;
    // Legacy fields for thread context fast-path
    awaitingClarification?: ClarificationType;
    pendingOffer?: string;
    // Test run indicator
    testRun?: boolean;
  }
): InteractionMetadata {
  return {
    // Structured execution metadata
    entry_point: execution.entryPoint,
    intent: execution.intent,
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
    tier1_entity: execution.tier1Entity || null,
    
    llm: {
      used: execution.llmUsed,
      purpose: execution.llmPurpose || null,
    },
    
    resolution: {
      company_source: execution.companySource || "none",
      meeting_source: execution.meetingSource || "none",
    },
    
    // Backward-compatible fields
    companyId: base.companyId,
    companyName: base.companyName,
    meetingId: base.meetingId,
    isSingleMeetingMode: execution.entryPoint === "single_meeting",
    isBinaryQuestion: execution.isBinaryQuestion,
    semanticAnswerUsed: execution.semanticAnswerUsed,
    semanticConfidence: execution.semanticConfidence,
    
    // CRITICAL: Legacy fields for thread context fast-path
    awaitingClarification: execution.awaitingClarification,
    pendingOffer: execution.pendingOffer,
    
    // Test run indicator
    test_run: execution.testRun,
  };
}
