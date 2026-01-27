/**
 * Open Assistant Handler
 * 
 * Purpose:
 * Extends the existing Slack/MCP flow with evidence-source-driven routing.
 * The assistant is fully open-ended in what it helps with - we only constrain
 * which evidence sources may back the response and what claims are allowed.
 * 
 * Evidence Source Routing:
 * - meeting_data: Claims backed by meeting artifacts → SingleMeetingOrchestrator
 * - external_research: Claims backed by fetched sources → ExternalResearch (citations required)
 * - general_assistance: General knowledge → GPT-5 (with disclaimers when needed)
 * - hybrid: Combines sources → each claim traced to its source
 * 
 * Key Principles:
 * - This is NOT task-type routing (write email, prep call, etc. are all allowed)
 * - Preserve single-meeting guardrails when meeting_data is the evidence source
 * - Default to general_assistance when source requirements are unclear
 * - Never re-derive deterministic artifacts
 * - When web search is available, external research requires explicit citations
 */

import { OpenAI } from "openai";
import { classifyIntent, needsClarification, type IntentClassification, type OpenAssistantIntent } from "./intentClassifier";
import { performExternalResearch, formatCitationsForDisplay, type ResearchResult } from "./externalResearch";
import { searchArtifactsSemanticly, formatArtifactResults, type ArtifactSearchResult } from "./semanticArtifactSearch";
import { handleSingleMeetingQuestion, type SingleMeetingContext, type SingleMeetingResult } from "../mcp/singleMeetingOrchestrator";
import { storage } from "../storage";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

/**
 * AMBIENT PRODUCT CONTEXT (Always On)
 * 
 * Provides product identity and framing while explicitly restricting factual authority.
 * - Resolves "what product are we talking about?"
 * - Enables natural explanations and copywriting
 * - Does NOT authorize factual claims
 * 
 * Rules:
 * - Ambient context is not evidence
 * - Ambient context must never be cited as a source of truth
 * - Ambient context controls framing only
 */
/**
 * Ambient Product Context - Authoritative Identity Prompt
 * 
 * Purpose:
 * - Removes all "Which PitCrew?" ambiguity
 * - Enables high-level explanations and copy
 * - Strictly respects SSOT authority boundaries
 * 
 * Rules:
 * - Ambient context is NOT evidence
 * - Ambient context must NEVER be cited or used to justify claims
 * - Product SSOT remains the ONLY source of authoritative product facts
 */
const AMBIENT_PRODUCT_CONTEXT = `IMPORTANT: You are an AI assistant for PitCrew employees.
There is only ONE PitCrew — the product developed by Leverege.

=== PitCrew Identity (Established Fact) ===
- PitCrew is a B2B SaaS product developed by Leverege
- It is used by automotive service businesses (e.g., tire shops, oil change centers, car washes, dealership service departments)
- When users mention "PitCrew," they ALWAYS mean this product
- Never ask for clarification about which PitCrew

=== Framing Context (Non-Authoritative) ===
Use the following only for high-level explanation and framing:
- PitCrew focuses on helping teams understand operations in automotive service environments
- It applies AI and computer vision concepts to analyze activity in service bays
- It is commonly described in terms of visibility, operational insight, and performance improvement

Do NOT treat the above as authoritative facts or guarantees.

=== Authority Rules (HARDENING - CRITICAL) ===
1. Ambient context is NOT evidence - never cite or reference it as a source of truth
2. Ambient context must NEVER justify factual claims about features, pricing, or capabilities
3. Product SSOT is the ONLY source for authoritative product information

=== Forbidden Phrasing Without Product SSOT ===
When Product SSOT data is NOT explicitly provided, you MUST NOT use phrasing like:
- "PitCrew supports..." / "PitCrew integrates with..."
- "PitCrew typically..." / "PitCrew can..."
- "According to our approach..." / "Our product..."
- Any statement implying specific feature capabilities or guarantees

Instead, use hedged language like:
- "You'd want to verify with the product team whether..."
- "For specific integration details, please check the product documentation..."
- "I don't have authoritative product data to confirm..."

=== When SSOT IS Provided ===
Only make authoritative claims when:
1. Product SSOT data is explicitly included in the context
2. The active contract permits authoritative claims (ssotMode="authoritative")
3. The claim is directly supported by the SSOT data provided`;


import { Intent, type IntentClassificationResult } from "../controlPlane/intent";
import { selectAnswerContract, AnswerContract, type SSOTMode, selectMultiMeetingContractChain, selectSingleMeetingContractChain, getContractConstraints, type ContractChain } from "../controlPlane/answerContracts";
import { type ContextLayers } from "../controlPlane/contextLayers";

export type OpenAssistantContext = {
  userId?: string;
  threadId?: string;
  conversationContext?: string;
  resolvedMeeting?: SingleMeetingContext | null;
  controlPlaneIntent?: IntentClassificationResult;
};

export type OpenAssistantResult = {
  answer: string;
  intent: OpenAssistantIntent;
  intentClassification: IntentClassification;
  controlPlaneIntent?: Intent;
  answerContract?: AnswerContract;
  answerContractChain?: AnswerContract[]; // For MULTI_MEETING contract chaining
  ssotMode?: SSOTMode;
  dataSource: "meeting_artifacts" | "external_research" | "general_knowledge" | "hybrid" | "clarification" | "product_ssot";
  researchCitations?: ResearchResult["citations"];
  artifactMatches?: ArtifactSearchResult;
  singleMeetingResult?: SingleMeetingResult;
  delegatedToSingleMeeting: boolean;
};

/**
 * Map control plane intent to evidence source intent for routing.
 */
function mapControlPlaneToEvidenceSource(cpIntent: Intent): OpenAssistantIntent {
  switch (cpIntent) {
    case Intent.SINGLE_MEETING:
    case Intent.MULTI_MEETING:
      return "meeting_data";
    case Intent.PRODUCT_KNOWLEDGE:
      return "general_assistance";
    case Intent.DOCUMENT_SEARCH:
      return "general_assistance";
    case Intent.GENERAL_HELP:
    case Intent.REFUSE:
    case Intent.CLARIFY:
    default:
      return "general_assistance";
  }
}

/**
 * Main entry point for Open Assistant.
 * 
 * Called from Slack events handler after initial processing (dedup, ack, etc.)
 * Routes to appropriate handler based on classified intent.
 * 
 * When a control plane intent is provided, it takes precedence over the
 * Open Assistant's own intent classification.
 */
export async function handleOpenAssistant(
  userMessage: string,
  context: OpenAssistantContext
): Promise<OpenAssistantResult> {
  console.log(`[OpenAssistant] Processing: "${userMessage}"`);
  
  if (context.controlPlaneIntent) {
    const cpIntent = context.controlPlaneIntent;
    console.log(`[OpenAssistant] Using control plane intent: ${cpIntent.intent} (${cpIntent.intentDetectionMethod})`);
    
    if (cpIntent.intent === Intent.REFUSE) {
      return {
        answer: "I'm sorry, but that question is outside of what I can help with. I'm designed to assist with PitCrew-related topics, customer meetings, and product information.",
        intent: "general_assistance",
        intentClassification: defaultClassification("Refused by control plane"),
        controlPlaneIntent: cpIntent.intent,
        answerContract: AnswerContract.REFUSE,
        dataSource: "clarification",
        delegatedToSingleMeeting: false,
      };
    }
    
    if (cpIntent.intent === Intent.CLARIFY && cpIntent.needsSplit) {
      const splitMessage = cpIntent.splitOptions 
        ? `I can help with that, but let's do it one step at a time. Which would you like first: ${cpIntent.splitOptions.join(" or ")}?`
        : "I can help with that, but let's do it one step at a time. Could you tell me which part you'd like me to focus on first?";
      
      return {
        answer: splitMessage,
        intent: "general_assistance",
        intentClassification: defaultClassification("Split required by control plane"),
        controlPlaneIntent: cpIntent.intent,
        answerContract: AnswerContract.CLARIFY,
        dataSource: "clarification",
        delegatedToSingleMeeting: false,
      };
    }
    
    const mappedIntent = mapControlPlaneToEvidenceSource(cpIntent.intent);
    const fakeClassification: IntentClassification = {
      intent: mappedIntent,
      confidence: cpIntent.confidence > 0.8 ? "high" : cpIntent.confidence > 0.5 ? "medium" : "low",
      rationale: cpIntent.reason || "Mapped from control plane intent",
      meetingRelevance: {
        referencesSpecificInteraction: cpIntent.intent === Intent.SINGLE_MEETING,
        asksWhatWasSaidOrAgreed: false,
        asksAboutCustomerQuestions: false,
      },
      researchRelevance: {
        needsPublicInfo: false,
        companyOrEntityMentioned: null,
        topicForResearch: null,
      },
    };
    
    console.log(`[OpenAssistant] Mapped to evidence source: ${mappedIntent}`);
    
    if (cpIntent.intent === Intent.SINGLE_MEETING) {
      return handleMeetingDataIntent(userMessage, context, fakeClassification);
    }
    
    if (cpIntent.intent === Intent.MULTI_MEETING) {
      return handleMultiMeetingIntent(userMessage, context, fakeClassification);
    }
    
    if (cpIntent.intent === Intent.PRODUCT_KNOWLEDGE) {
      return handleProductKnowledgeIntent(userMessage, context, fakeClassification);
    }
    
    return handleGeneralAssistanceIntent(userMessage, context, fakeClassification);
  }
  
  const intentClassification = await classifyIntent(
    userMessage,
    context.conversationContext
  );
  
  console.log(`[OpenAssistant] Intent: ${intentClassification.intent} (${intentClassification.confidence})`);
  console.log(`[OpenAssistant] Rationale: ${intentClassification.rationale}`);

  const clarificationPrompt = needsClarification(intentClassification);
  if (clarificationPrompt) {
    return {
      answer: clarificationPrompt,
      intent: intentClassification.intent,
      intentClassification,
      dataSource: "clarification",
      delegatedToSingleMeeting: false,
    };
  }

  switch (intentClassification.intent) {
    case "meeting_data":
      return handleMeetingDataIntent(userMessage, context, intentClassification);
    
    case "external_research":
      return handleExternalResearchIntent(userMessage, context, intentClassification);
    
    case "general_assistance":
      return handleGeneralAssistanceIntent(userMessage, context, intentClassification);
    
    case "hybrid":
      return handleHybridIntent(userMessage, context, intentClassification);
    
    default:
      return handleGeneralAssistanceIntent(userMessage, context, intentClassification);
  }
}

function defaultClassification(rationale: string): IntentClassification {
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
 * Map SingleMeetingOrchestrator's internal intent to an AnswerContract.
 * 
 * The orchestrator has its own intent classification (extractive/aggregative/summary)
 * which we map to the appropriate contract. The chain's primary contract is used
 * as a fallback if the orchestrator intent doesn't map directly.
 */
function mapOrchestratorIntentToContract(
  orchestratorIntent: "extractive" | "aggregative" | "summary",
  chainPrimaryContract: AnswerContract
): AnswerContract {
  switch (orchestratorIntent) {
    case "extractive":
      return AnswerContract.EXTRACTIVE_FACT;
    case "aggregative":
      return AnswerContract.AGGREGATIVE_LIST;
    case "summary":
      return AnswerContract.MEETING_SUMMARY;
    default:
      return chainPrimaryContract;
  }
}

/**
 * Handle meeting_data intent by delegating to SingleMeetingOrchestrator.
 * Preserves all existing guardrails and artifact read-only constraints.
 * 
 * When no meeting is resolved, attempts to find relevant meetings by:
 * 1. Extracting company/person names from the query
 * 2. Searching for meetings with matching companies/contacts
 * 3. Delegating to single meeting if one match, or searching across if multiple
 */
async function handleMeetingDataIntent(
  userMessage: string,
  context: OpenAssistantContext,
  classification: IntentClassification
): Promise<OpenAssistantResult> {
  console.log(`[OpenAssistant] Routing to meeting data path`);
  
  // If meeting is already resolved, delegate directly
  if (context.resolvedMeeting) {
    // Select contract chain based on user message and scope
    const scope = {
      meetingId: context.resolvedMeeting.meetingId,
      companyId: context.resolvedMeeting.companyId,
      companyName: context.resolvedMeeting.companyName,
    };
    const chain = selectSingleMeetingContractChain(userMessage, scope);
    console.log(`[OpenAssistant] Selected SINGLE_MEETING chain: [${chain.contracts.join(" → ")}]`);
    
    const singleMeetingResult = await handleSingleMeetingQuestion(
      context.resolvedMeeting,
      userMessage,
      false
    );

    // Map orchestrator internal intent to contract if needed
    const actualContract = mapOrchestratorIntentToContract(singleMeetingResult.intent, chain.primaryContract);

    return {
      answer: singleMeetingResult.answer,
      intent: "meeting_data",
      intentClassification: classification,
      controlPlaneIntent: Intent.SINGLE_MEETING,
      answerContract: actualContract,
      answerContractChain: chain.contracts,
      ssotMode: "none" as SSOTMode,
      dataSource: "meeting_artifacts",
      singleMeetingResult,
      delegatedToSingleMeeting: true,
    };
  }

  // No meeting resolved - try to find relevant meetings
  console.log(`[OpenAssistant] No meeting resolved, searching for relevant meetings`);
  
  const meetingSearch = await findRelevantMeetings(userMessage, classification);
  
  if (meetingSearch.meetings.length === 0) {
    // HARDENING: Scope resolution failure → CLARIFY (not partial answer)
    // SINGLE_MEETING with no resolvable meeting must route to CLARIFY
    console.log(`[OpenAssistant] Scope resolution failed: no meetings found for SINGLE_MEETING intent`);
    return {
      answer: `I couldn't find any meetings matching your query. ${meetingSearch.searchedFor ? `I searched for: "${meetingSearch.searchedFor}"` : ''}\n\nCould you provide more details? For example:\n- The company or customer name\n- When the meeting took place\n- Who you spoke with`,
      intent: "meeting_data",
      intentClassification: classification,
      controlPlaneIntent: Intent.CLARIFY,
      answerContract: AnswerContract.CLARIFY,
      ssotMode: "none" as SSOTMode,
      dataSource: "clarification",
      delegatedToSingleMeeting: false,
    };
  }

  if (meetingSearch.meetings.length === 1) {
    // Single meeting found - delegate to SingleMeetingOrchestrator
    const meeting = meetingSearch.meetings[0];
    console.log(`[OpenAssistant] Found single meeting: ${meeting.companyName} (${meeting.meetingId})`);
    
    // Select contract chain based on user message and scope
    const scope = {
      meetingId: meeting.meetingId,
      companyId: meeting.companyId,
      companyName: meeting.companyName,
    };
    const chain = selectSingleMeetingContractChain(userMessage, scope);
    console.log(`[OpenAssistant] Selected SINGLE_MEETING chain: [${chain.contracts.join(" → ")}]`);
    
    const singleMeetingResult = await handleSingleMeetingQuestion(
      meeting,
      userMessage,
      false
    );

    // Map orchestrator internal intent to contract
    const actualContract = mapOrchestratorIntentToContract(singleMeetingResult.intent, chain.primaryContract);

    return {
      answer: singleMeetingResult.answer,
      intent: "meeting_data",
      intentClassification: classification,
      controlPlaneIntent: Intent.SINGLE_MEETING,
      answerContract: actualContract,
      answerContractChain: chain.contracts,
      ssotMode: "none" as SSOTMode,
      dataSource: "meeting_artifacts",
      singleMeetingResult,
      delegatedToSingleMeeting: true,
    };
  }

  // Multiple meetings found - route through executeContractChain for uniform constraint enforcement
  console.log(`[OpenAssistant] Found ${meetingSearch.meetings.length} meetings, routing to MULTI_MEETING path`);
  
  // Build scope from resolved meetings with coverage metadata
  const uniqueCompanies2 = new Set(meetingSearch.meetings.map(m => m.companyId));
  const scope = {
    type: "multi_meeting" as const,
    meetingIds: meetingSearch.meetings.map(m => m.meetingId),
    filters: meetingSearch.searchedFor ? { topic: meetingSearch.searchedFor } : undefined,
    coverage: {
      totalMeetingsSearched: meetingSearch.meetings.length,
      matchingMeetingsCount: meetingSearch.meetings.length,
      uniqueCompaniesRepresented: uniqueCompanies2.size,
    },
  };
  
  // Select contract chain based on intent, scope, and inferred tasks
  const chain = selectMultiMeetingContractChain(userMessage, scope);
  console.log(`[OpenAssistant] Selected MULTI_MEETING chain: [${chain.contracts.join(" → ")}] (coverage: ${scope.coverage.matchingMeetingsCount} meetings)`);
  
  // HARDENING: Route through executeContractChain for uniform constraint/threshold enforcement
  const chainResult = await executeContractChain(chain, userMessage, meetingSearch.meetings);
  
  return {
    answer: chainResult.finalOutput,
    intent: "meeting_data",
    intentClassification: classification,
    controlPlaneIntent: Intent.MULTI_MEETING,
    answerContract: chain.primaryContract,
    answerContractChain: chain.contracts,
    ssotMode: "none" as SSOTMode,
    dataSource: "meeting_artifacts",
    artifactMatches: undefined,
    delegatedToSingleMeeting: false,
  };
}

/**
 * Handle MULTI_MEETING intent explicitly.
 * 
 * Uses contract chaining for richer cross-meeting analysis:
 * - Single contracts: PATTERN_ANALYSIS, COMPARISON, TREND_SUMMARY, CROSS_MEETING_QUESTIONS
 * - Chains: QUESTIONS_PATTERN_CHAIN, COMPARISON_TREND_CHAIN
 * 
 * Chaining executes contracts in sequence, where each contract
 * can use the output of previous contracts as context.
 */
async function handleMultiMeetingIntent(
  userMessage: string,
  context: OpenAssistantContext,
  classification: IntentClassification
): Promise<OpenAssistantResult> {
  console.log(`[OpenAssistant] Routing to MULTI_MEETING path`);
  
  const meetingSearch = await findRelevantMeetings(userMessage, classification);
  
  if (meetingSearch.meetings.length === 0) {
    // HARDENING: Scope resolution failure → CLARIFY (not partial answer)
    // MULTI_MEETING with empty result set must route to CLARIFY
    console.log(`[OpenAssistant] Scope resolution failed: no meetings found for MULTI_MEETING intent`);
    return {
      answer: `I couldn't find any meetings matching your query for cross-meeting analysis. ${meetingSearch.searchedFor ? `I searched for: "${meetingSearch.searchedFor}"` : ''}\n\nCould you provide more details? For example:\n- Specific companies or customers\n- A time period to search within\n- Topics or themes to look for`,
      intent: "meeting_data",
      intentClassification: classification,
      controlPlaneIntent: Intent.CLARIFY,
      answerContract: AnswerContract.CLARIFY,
      ssotMode: "none" as SSOTMode,
      dataSource: "clarification",
      delegatedToSingleMeeting: false,
    };
  }
  
  // Build scope from resolved meetings with coverage metadata
  const uniqueCompanies = new Set(meetingSearch.meetings.map(m => m.companyId));
  const scope = {
    type: "multi_meeting" as const,
    meetingIds: meetingSearch.meetings.map(m => m.meetingId),
    filters: meetingSearch.searchedFor ? { topic: meetingSearch.searchedFor } : undefined,
    coverage: {
      totalMeetingsSearched: meetingSearch.meetings.length,
      matchingMeetingsCount: meetingSearch.meetings.length,
      uniqueCompaniesRepresented: uniqueCompanies.size,
    },
  };
  
  // Select contract chain based on intent, scope, and inferred tasks
  const chain = selectMultiMeetingContractChain(userMessage, scope);
  const isChained = chain.contracts.length > 1;
  console.log(`[OpenAssistant] Selected MULTI_MEETING chain: [${chain.contracts.join(" → ")}] (${isChained ? "chained" : "single"}, coverage: ${scope.coverage.matchingMeetingsCount} meetings, ${scope.coverage.uniqueCompaniesRepresented} companies)`);
  
  // Execute contract chain
  const chainResult = await executeContractChain(chain, userMessage, meetingSearch.meetings);
  
  return {
    answer: chainResult.finalOutput,
    intent: "meeting_data",
    intentClassification: classification,
    controlPlaneIntent: Intent.MULTI_MEETING,
    answerContract: chain.primaryContract,
    answerContractChain: chain.contracts,
    ssotMode: "none" as SSOTMode,
    dataSource: "meeting_artifacts",
    delegatedToSingleMeeting: false,
  };
}

/**
 * Execute a contract chain for MULTI_MEETING queries.
 * 
 * Each contract in the chain:
 * - Receives the output of the previous contract as context
 * - Has its own constraints and output format
 * - Contributes to the final response
 */
/**
 * Structured decision log for contract chain execution.
 * HARDENING: Logs should explain WHY decisions were made.
 */
type ContractExecutionDecision = {
  contract: AnswerContract;
  authority: SSOTMode;
  authorityValidated: boolean;
  evidenceCount: number;
  executionOutcome: "executed" | "short_circuit_clarify" | "short_circuit_refuse" | "evidence_threshold_not_met" | "empty_evidence";
};

async function executeContractChain(
  chain: ContractChain,
  userMessage: string,
  meetings: SingleMeetingContext[]
): Promise<{ finalOutput: string; chainResults: Array<{ contract: AnswerContract; output: string }> }> {
  const chainResults: Array<{ contract: AnswerContract; output: string }> = [];
  const executionDecisions: ContractExecutionDecision[] = [];
  let previousOutput = "";
  
  // HARDENING: Check for CLARIFY contract (validation failure)
  if (chain.clarifyReason) {
    console.log(`[OpenAssistant] Chain validation failed, returning CLARIFY: ${chain.clarifyReason}`);
    return { 
      finalOutput: chain.clarifyReason, 
      chainResults: [{ contract: AnswerContract.CLARIFY, output: chain.clarifyReason }] 
    };
  }
  
  for (const contract of chain.contracts) {
    const constraints = getContractConstraints(contract);
    
    // HARDENING: Authority validation - authoritative contracts require explicit Product SSOT
    // Authority is assigned by Control Plane, never inferred by Execution Plane
    const decision: ContractExecutionDecision = {
      contract,
      authority: constraints.ssotMode,
      authorityValidated: true,
      evidenceCount: meetings.length,
      executionOutcome: "executed",
    };
    
    if (constraints.ssotMode === "authoritative") {
      // HARDENING: Authoritative contracts ALWAYS require explicit Product SSOT
      // Authority is never inferred - if SSOT is unavailable, refuse
      console.warn(`[OpenAssistant] Authoritative contract ${contract} requires Product SSOT - refusing without explicit evidence`);
      decision.authorityValidated = false;
      decision.executionOutcome = "short_circuit_refuse";
      executionDecisions.push(decision);
      
      // Always refuse authoritative contracts without SSOT - no partial answers
      return { 
        finalOutput: "I can't provide authoritative product information without verified product documentation. For accurate details about features, pricing, or integrations, please check the product knowledge base or contact the product team.",
        chainResults: [{ contract: AnswerContract.REFUSE, output: "Authority requirements not met: Product SSOT unavailable" }]
      };
    }
    
    // HARDENING: Check evidence threshold
    if (constraints.minEvidenceThreshold && meetings.length < constraints.minEvidenceThreshold) {
      console.log(`[OpenAssistant] Evidence threshold not met: need ${constraints.minEvidenceThreshold}, have ${meetings.length}`);
      decision.executionOutcome = "evidence_threshold_not_met";
      
      if (constraints.emptyResultBehavior === "clarify") {
        executionDecisions.push(decision);
        return {
          finalOutput: `I need more data to provide a reliable ${getContractHeader(contract).toLowerCase()}. Found ${meetings.length} meeting(s), but need at least ${constraints.minEvidenceThreshold} for this type of analysis.`,
          chainResults: [{ contract: AnswerContract.CLARIFY, output: "Evidence threshold not met" }]
        };
      }
    }
    
    console.log(`[OpenAssistant] Executing contract: ${contract} (authority: ${constraints.ssotMode}, format: ${constraints.responseFormat}, meetings: ${meetings.length})`);
    
    // Build context with previous contract output
    const contextForContract = previousOutput 
      ? `Previous analysis:\n${previousOutput}\n\nNow applying ${contract} analysis:`
      : "";
    
    // Execute the contract with the appropriate context - returns structured evidence result
    const executionResult = await executeMultiMeetingContract(
      contract,
      userMessage,
      meetings,
      contextForContract,
      constraints
    );
    
    // Update decision with actual evidence data
    decision.evidenceCount = executionResult.evidenceCount;
    
    // HARDENING: Evidence-based emptyResultBehavior enforcement using structured evidence data
    if (!executionResult.evidenceFound && constraints.emptyResultBehavior) {
      console.log(`[OpenAssistant] Contract ${contract} returned no evidence (count=${executionResult.evidenceCount}, meetingsContributing=${executionResult.meetingsWithEvidence}), applying emptyResultBehavior: ${constraints.emptyResultBehavior}`);
      decision.executionOutcome = "empty_evidence";
      
      if (constraints.emptyResultBehavior === "refuse") {
        executionDecisions.push(decision);
        return {
          finalOutput: `I couldn't find reliable information to answer your question about ${getContractHeader(contract).toLowerCase()}. I searched ${meetings.length} meeting(s) but found no matching evidence. Please try rephrasing or narrowing your question.`,
          chainResults: [{ contract: AnswerContract.REFUSE, output: "Empty evidence - refused" }]
        };
      } else if (constraints.emptyResultBehavior === "clarify") {
        executionDecisions.push(decision);
        return {
          finalOutput: `I searched ${meetings.length} meeting(s) but couldn't find specific evidence for your question. Could you clarify what you're looking for or try a different search?`,
          chainResults: [{ contract: AnswerContract.CLARIFY, output: "Empty evidence - clarification needed" }]
        };
      }
      // "return_empty" falls through - return the output as-is
    }
    
    chainResults.push({ contract, output: executionResult.output });
    previousOutput = executionResult.output;
    executionDecisions.push(decision);
  }
  
  // Log execution decisions for observability
  console.log(`[OpenAssistant] Contract chain execution complete:`, 
    JSON.stringify(executionDecisions.map(d => ({
      contract: d.contract,
      authority: d.authority,
      validated: d.authorityValidated,
      outcome: d.executionOutcome
    }))));
  
  // For chained contracts, format the final output with clear sections
  let finalOutput: string;
  if (chain.contracts.length > 1) {
    finalOutput = chainResults.map((r, i) => {
      const header = getContractHeader(r.contract);
      return `**${header}**\n${r.output}`;
    }).join("\n\n");
  } else {
    finalOutput = chainResults[0]?.output || "No results found.";
  }
  
  return { finalOutput, chainResults };
}

/**
 * Structured result from contract execution with evidence tracking.
 */
interface ContractExecutionResult {
  output: string;
  evidenceFound: boolean;
  evidenceCount: number;  // Number of distinct pieces of evidence (questions, items, etc.)
  meetingsWithEvidence: number;  // How many meetings contributed evidence
}

/**
 * Fetch actual evidence from database for contracts that support it.
 * Returns structured counts from real data, not LLM output heuristics.
 */
async function fetchActualEvidence(
  contract: AnswerContract,
  meetings: SingleMeetingContext[]
): Promise<{ count: number; meetingsWithEvidence: number; items: unknown[] }> {
  const meetingIds = meetings.map(m => m.meetingId);
  let items: unknown[] = [];
  let meetingsWithEvidence = 0;
  
  try {
    switch (contract) {
      case AnswerContract.CROSS_MEETING_QUESTIONS:
      case AnswerContract.CUSTOMER_QUESTIONS:
        // Fetch actual customer questions from database
        for (const meetingId of meetingIds) {
          const questions = await storage.getCustomerQuestionsByTranscript(meetingId);
          if (questions.length > 0) {
            items.push(...questions);
            meetingsWithEvidence++;
          }
        }
        break;
        
      case AnswerContract.ATTENDEES:
        // Fetch actual attendee data from transcripts
        for (const meeting of meetings) {
          const transcript = await storage.getTranscript("PitCrew", meeting.meetingId);
          if (transcript) {
            const hasAttendees = (transcript.leverageTeam && transcript.leverageTeam.length > 0) ||
                                 (transcript.customerNames && transcript.customerNames.length > 0);
            if (hasAttendees) {
              items.push({ meetingId: meeting.meetingId, attendees: transcript.leverageTeam, customers: transcript.customerNames });
              meetingsWithEvidence++;
            }
          }
        }
        break;
        
      default:
        // For other contracts (PATTERN_ANALYSIS, TREND_SUMMARY, COMPARISON),
        // we use the meetings themselves as evidence since they're analytical
        items = meetings;
        meetingsWithEvidence = meetings.length;
    }
  } catch (error) {
    console.warn(`[fetchActualEvidence] Error fetching evidence for ${contract}:`, error);
    // Fall through to return empty if database query fails
  }
  
  return {
    count: items.length,
    meetingsWithEvidence,
    items,
  };
}

/**
 * Execute a single contract for MULTI_MEETING analysis.
 * Returns structured result with evidence tracking for emptyResultBehavior enforcement.
 * 
 * HARDENING: For contracts that extract specific data (CUSTOMER_QUESTIONS, ATTENDEES),
 * we fetch actual evidence from the database first to determine if evidence exists.
 */
async function executeMultiMeetingContract(
  contract: AnswerContract,
  userMessage: string,
  meetings: SingleMeetingContext[],
  previousContext: string,
  constraints: { ssotMode: SSOTMode; responseFormat: string; requiresCitation: boolean }
): Promise<ContractExecutionResult> {
  // HARDENING: Fetch actual evidence from database for contracts that support it
  const actualEvidence = await fetchActualEvidence(contract, meetings);
  console.log(`[executeMultiMeetingContract] ${contract}: actual evidence count=${actualEvidence.count}, meetingsWithEvidence=${actualEvidence.meetingsWithEvidence}`);
  
  // For extraction contracts (CUSTOMER_QUESTIONS, ATTENDEES), use actual evidence as ground truth
  const isExtractionContract = [
    AnswerContract.CROSS_MEETING_QUESTIONS,
    AnswerContract.CUSTOMER_QUESTIONS,
    AnswerContract.ATTENDEES,
  ].includes(contract);
  
  // If extraction contract has no actual evidence, return early with empty result
  if (isExtractionContract && actualEvidence.count === 0) {
    return {
      output: `No ${contract === AnswerContract.ATTENDEES ? 'attendee information' : 'customer questions'} found in the searched meetings.`,
      evidenceFound: false,
      evidenceCount: 0,
      meetingsWithEvidence: 0,
    };
  }
  
  // Build contract-specific prompt
  const contractPrompt = getContractPrompt(contract, previousContext);
  const fullQuery = contractPrompt ? `${contractPrompt}\n\nUser question: ${userMessage}` : userMessage;
  
  // Execute the search (LLM-based synthesis)
  const rawOutput = await searchAcrossMeetings(fullQuery, meetings);
  
  // Use actual evidence counts for extraction contracts, fallback to heuristics for analytical contracts
  if (isExtractionContract) {
    return {
      output: rawOutput,
      evidenceFound: actualEvidence.count > 0,
      evidenceCount: actualEvidence.count,
      meetingsWithEvidence: actualEvidence.meetingsWithEvidence,
    };
  }
  
  // For analytical contracts (PATTERN_ANALYSIS, COMPARISON, TREND_SUMMARY),
  // use output heuristics since they synthesize rather than extract
  const evidenceResult = analyzeOutputForEvidence(contract, rawOutput, meetings.length);
  
  return {
    output: rawOutput,
    evidenceFound: evidenceResult.found,
    evidenceCount: evidenceResult.count,
    meetingsWithEvidence: evidenceResult.meetingsContributing,
  };
}

/**
 * Analyze contract output to determine evidence presence.
 * Uses contract-specific heuristics to count distinct evidence items.
 */
function analyzeOutputForEvidence(
  contract: AnswerContract,
  output: string,
  totalMeetings: number
): { found: boolean; count: number; meetingsContributing: number } {
  // Early exit for clearly empty outputs
  if (!output || output.length < 15) {
    return { found: false, count: 0, meetingsContributing: 0 };
  }
  
  // Explicit "no evidence" phrases
  const noEvidencePatterns = [
    /no (data|evidence|results|questions|items|attendees|information) (found|available|detected)/i,
    /could not find|couldn't find|unable to (find|locate)/i,
    /no specific (questions|concerns|topics)/i,
    /didn't (find|mention|discuss)/i,
  ];
  
  for (const pattern of noEvidencePatterns) {
    if (pattern.test(output)) {
      return { found: false, count: 0, meetingsContributing: 0 };
    }
  }
  
  // Contract-specific evidence counting
  let evidenceCount = 0;
  let meetingsContributing = 0;
  
  switch (contract) {
    case AnswerContract.CROSS_MEETING_QUESTIONS:
    case AnswerContract.CUSTOMER_QUESTIONS:
      // Count question marks as proxy for extracted questions
      evidenceCount = (output.match(/\?/g) || []).length;
      // Count meeting references (e.g., "In the Les Schwab meeting...")
      meetingsContributing = Math.min(totalMeetings, (output.match(/\b(meeting|call|conversation)\b/gi) || []).length);
      break;
      
    case AnswerContract.ATTENDEES:
      // Count names (capitalized words in sequence)
      evidenceCount = (output.match(/[A-Z][a-z]+ [A-Z][a-z]+/g) || []).length;
      meetingsContributing = Math.min(totalMeetings, 1);
      break;
      
    case AnswerContract.PATTERN_ANALYSIS:
    case AnswerContract.TREND_SUMMARY:
      // Count bullet points or numbered items as patterns/trends
      evidenceCount = (output.match(/^[\-\*\d\.]+\s/gm) || []).length;
      if (evidenceCount === 0) {
        // Fallback: count sentences as evidence
        evidenceCount = Math.max(1, (output.match(/\./g) || []).length);
      }
      meetingsContributing = totalMeetings;  // Patterns inherently span meetings
      break;
      
    case AnswerContract.COMPARISON:
      // Count comparison indicators
      evidenceCount = (output.match(/\b(differ|similar|unlike|whereas|however|in contrast)\b/gi) || []).length;
      meetingsContributing = Math.min(totalMeetings, 2);  // Comparison needs at least 2
      break;
      
    default:
      // Generic: count sentences as evidence items
      evidenceCount = Math.max(1, (output.match(/[.!?]/g) || []).length);
      meetingsContributing = 1;
  }
  
  return {
    found: evidenceCount > 0,
    count: evidenceCount,
    meetingsContributing: Math.max(0, meetingsContributing),
  };
}

/**
 * Get a human-readable header for a contract in chained output.
 */
function getContractHeader(contract: AnswerContract): string {
  switch (contract) {
    case AnswerContract.CROSS_MEETING_QUESTIONS:
      return "Customer Questions Across Meetings";
    case AnswerContract.PATTERN_ANALYSIS:
      return "Pattern Analysis";
    case AnswerContract.COMPARISON:
      return "Comparison";
    case AnswerContract.TREND_SUMMARY:
      return "Trend Summary";
    default:
      return contract;
  }
}

/**
 * Get contract-specific prompting instructions.
 */
function getContractPrompt(contract: AnswerContract, previousContext: string): string {
  const contextPrefix = previousContext ? `${previousContext}\n\n` : "";
  
  switch (contract) {
    case AnswerContract.CROSS_MEETING_QUESTIONS:
      return `${contextPrefix}Focus on extracting and listing customer questions from these meetings. Include verbatim quotes where possible.`;
    case AnswerContract.PATTERN_ANALYSIS:
      return `${contextPrefix}Analyze patterns and recurring themes across these meetings. Identify what comes up frequently.`;
    case AnswerContract.COMPARISON:
      return `${contextPrefix}Compare and contrast the discussions across these meetings. Highlight key differences.`;
    case AnswerContract.TREND_SUMMARY:
      return `${contextPrefix}Summarize how topics or concerns have evolved over time across these meetings.`;
    default:
      return contextPrefix;
  }
}

/**
 * Select appropriate contract for MULTI_MEETING queries.
 * Uses keyword-first deterministic matching.
 * 
 * IMPORTANT: Keywords are used only to infer the analytical task
 * (e.g., comparison vs pattern), not to create new intent categories
 * or topic-specific contracts.
 * 
 * This is task inference within a fixed intent, not intent classification.
 */
function selectMultiMeetingContract(userMessage: string): AnswerContract {
  const msg = userMessage.toLowerCase();
  
  // Pattern analysis keywords
  if (/pattern|recurring|common|theme|frequently|often|always/i.test(msg)) {
    return AnswerContract.PATTERN_ANALYSIS;
  }
  
  // Comparison keywords
  if (/compare|difference|differ|contrast|versus|vs\.?|between/i.test(msg)) {
    return AnswerContract.COMPARISON;
  }
  
  // Trend/time-based keywords
  if (/trend|over time|change|evolving|growing|declining|progression/i.test(msg)) {
    return AnswerContract.TREND_SUMMARY;
  }
  
  // Cross-meeting questions
  if (/questions|asked|concerns|issues|objections/i.test(msg)) {
    return AnswerContract.CROSS_MEETING_QUESTIONS;
  }
  
  // Default to pattern analysis for general cross-meeting queries
  return AnswerContract.PATTERN_ANALYSIS;
}

/**
 * Handle external_research intent.
 * 
 * Note: Web search is not yet integrated. When citations are empty,
 * the response is general knowledge with a clear disclaimer.
 */
async function handleExternalResearchIntent(
  userMessage: string,
  context: OpenAssistantContext,
  classification: IntentClassification
): Promise<OpenAssistantResult> {
  console.log(`[OpenAssistant] Routing to external research path`);
  
  const researchResult = await performExternalResearch(
    userMessage,
    classification.researchRelevance.companyOrEntityMentioned,
    classification.researchRelevance.topicForResearch
  );

  const hasCitations = researchResult.citations.length > 0;
  const formattedCitations = formatCitationsForDisplay(researchResult.citations);
  
  let fullAnswer = researchResult.answer;
  if (hasCitations) {
    fullAnswer += formattedCitations;
  } else if (researchResult.disclaimer) {
    fullAnswer += `\n\n_${researchResult.disclaimer}_`;
  }

  return {
    answer: fullAnswer,
    intent: "external_research",
    intentClassification: classification,
    dataSource: hasCitations ? "external_research" : "general_knowledge",
    researchCitations: researchResult.citations,
    delegatedToSingleMeeting: false,
  };
}

/**
 * Handle general_assistance intent using GPT-5 for general help.
 * 
 * Uses ambient product context for framing but does NOT make authoritative claims
 * about product features, pricing, or integrations without Product SSOT.
 */
/**
 * HARDENING: Patterns that indicate the user would benefit from factual evidence.
 * If matched, route to CLARIFY instead of proceeding with GENERAL_HELP.
 */
const NEEDS_FACTUAL_EVIDENCE_PATTERNS = [
  /what (?:did|was) (?:discussed|said|agreed|mentioned)/i,
  /(?:from|in|during) (?:the|my|our) (?:meeting|call|demo)/i,
  /(?:customer|client) (?:said|asked|mentioned|wanted)/i,
  /(?:action items?|next steps?|commitments?) from/i,
  /(?:does|can|will) pitcrew (?:integrate|support|have|include|work with)/i,
  /(?:what|how much) (?:does|is) (?:the )?(?:pricing|cost|price)/i,
  /(?:available|included) (?:in|on|for) (?:the )?(?:pro|advanced|enterprise)/i,
];

/**
 * Check if a request would materially benefit from factual evidence.
 */
function wouldBenefitFromEvidence(message: string): { needsEvidence: boolean; reason?: string } {
  const lower = message.toLowerCase();
  
  for (const pattern of NEEDS_FACTUAL_EVIDENCE_PATTERNS) {
    if (pattern.test(lower)) {
      return { 
        needsEvidence: true, 
        reason: "This question appears to ask about specific meeting outcomes or product capabilities." 
      };
    }
  }
  
  return { needsEvidence: false };
}

async function handleGeneralAssistanceIntent(
  userMessage: string,
  context: OpenAssistantContext,
  classification: IntentClassification
): Promise<OpenAssistantResult> {
  console.log(`[OpenAssistant] Routing to general assistance path`);
  
  // HARDENING: GENERAL_HELP guardrail
  // If request would materially benefit from factual meeting or product evidence, trigger CLARIFY
  const evidenceCheck = wouldBenefitFromEvidence(userMessage);
  if (evidenceCheck.needsEvidence) {
    console.log(`[OpenAssistant] GENERAL_HELP guardrail triggered: ${evidenceCheck.reason}`);
    return {
      answer: `${evidenceCheck.reason}\n\nTo give you accurate information, could you:\n- For meeting questions: specify which customer or meeting you're asking about\n- For product questions: let me know what specific capability you want to verify\n\nThis helps me provide verified information rather than general guidance.`,
      intent: "general_assistance",
      intentClassification: classification,
      controlPlaneIntent: Intent.CLARIFY,
      answerContract: AnswerContract.CLARIFY,
      dataSource: "clarification",
      delegatedToSingleMeeting: false,
    };
  }
  
  const response = await openai.chat.completions.create({
    model: "gpt-5",
    messages: [
      {
        role: "system",
        content: `${AMBIENT_PRODUCT_CONTEXT}

You are a helpful business assistant for the PitCrew team. Provide clear, professional help with the user's request.

=== ALLOWED (Advisory, Creative, Framing) ===
- Drafting emails, messages, and documents
- Explaining concepts and answering general questions
- Providing suggestions and recommendations
- Helping with planning and organization
- High-level descriptions of what PitCrew does and its value

=== STRICTLY FORBIDDEN ===
- Asserting factual meeting outcomes (what was said, decided, agreed)
- Guaranteeing product features, pricing, integrations, or availability
- Making claims that require Product SSOT or meeting evidence
- Implying you have access to specific meeting data

If you're unsure whether something requires evidence, err on the side of asking the user to be more specific.`,
      },
      {
        role: "user",
        content: userMessage,
      },
    ],
  });

  const answer = response.choices[0]?.message?.content || "I'm not sure how to help with that. Could you rephrase your question?";

  return {
    answer,
    intent: "general_assistance",
    intentClassification: classification,
    controlPlaneIntent: Intent.GENERAL_HELP,
    answerContract: AnswerContract.GENERAL_RESPONSE,
    ssotMode: "none" as SSOTMode,
    dataSource: "general_knowledge",
    delegatedToSingleMeeting: false,
  };
}

/**
 * Handle PRODUCT_KNOWLEDGE intent with proper authority control.
 * 
 * Uses ambient context for framing and descriptive explanations.
 * For authoritative claims (features, pricing, integrations), requires Product SSOT.
 * 
 * TODO: Integrate Airtable Product SSOT for authoritative claims.
 */
async function handleProductKnowledgeIntent(
  userMessage: string,
  context: OpenAssistantContext,
  classification: IntentClassification
): Promise<OpenAssistantResult> {
  console.log(`[OpenAssistant] Routing to product knowledge path`);
  
  const response = await openai.chat.completions.create({
    model: "gpt-5",
    messages: [
      {
        role: "system",
        content: `${AMBIENT_PRODUCT_CONTEXT}

You are answering a product knowledge question about PitCrew.

AUTHORITY RULES:
- For general "how does it work" questions: Provide high-level explanations about purpose, value, and outcomes
- For specific feature questions: Say what you know at a high level, but add "I'd recommend checking our product documentation for the latest details"
- For pricing questions: Say "For current pricing information, please check with the sales team or product documentation"
- For integration questions: Provide general framing but note that specific integration details should be verified

NEVER fabricate specific:
- Pricing numbers or tiers
- Integration compatibility claims
- Feature availability by tier
- Technical specifications

Keep responses helpful but appropriately bounded by what can be safely stated without authoritative product data.`,
      },
      {
        role: "user",
        content: userMessage,
      },
    ],
  });

  const answer = response.choices[0]?.message?.content || "I'd be happy to help with product information. Could you be more specific about what you'd like to know?";

  return {
    answer,
    intent: "meeting_data", // Maps to "product_knowledge" for logging
    intentClassification: classification,
    controlPlaneIntent: Intent.PRODUCT_KNOWLEDGE,
    answerContract: AnswerContract.PRODUCT_EXPLANATION,
    ssotMode: "descriptive",
    dataSource: "product_ssot", // Indicates product context was used
    delegatedToSingleMeeting: false,
  };
}

/**
 * Handle hybrid intent by combining meeting data and external research.
 */
async function handleHybridIntent(
  userMessage: string,
  context: OpenAssistantContext,
  classification: IntentClassification
): Promise<OpenAssistantResult> {
  console.log(`[OpenAssistant] Routing to hybrid path (meeting + research)`);
  
  const [meetingDataResult, researchResult] = await Promise.all([
    context.resolvedMeeting 
      ? handleMeetingDataIntent(userMessage, context, classification)
      : Promise.resolve(null),
    performExternalResearch(
      userMessage,
      classification.researchRelevance.companyOrEntityMentioned,
      classification.researchRelevance.topicForResearch
    ),
  ]);

  const synthesized = await synthesizeHybridResponse(
    userMessage,
    meetingDataResult,
    researchResult,
    classification
  );

  return {
    answer: synthesized,
    intent: "hybrid",
    intentClassification: classification,
    dataSource: "hybrid",
    researchCitations: researchResult.citations,
    singleMeetingResult: meetingDataResult?.singleMeetingResult,
    delegatedToSingleMeeting: Boolean(meetingDataResult?.delegatedToSingleMeeting),
  };
}

/**
 * Synthesize a response combining meeting data and external research.
 */
async function synthesizeHybridResponse(
  originalQuery: string,
  meetingResult: OpenAssistantResult | null,
  researchResult: ResearchResult,
  classification: IntentClassification
): Promise<string> {
  const meetingContext = meetingResult?.answer || "No meeting data available.";
  const researchContext = researchResult.answer || "No external research results.";
  const hasCitations = researchResult.citations.length > 0;
  const citations = formatCitationsForDisplay(researchResult.citations);

  const researchNote = hasCitations 
    ? "from public sources" 
    : "based on general knowledge (web search not currently available)";

  const response = await openai.chat.completions.create({
    model: "gpt-5",
    messages: [
      {
        role: "system",
        content: `You are synthesizing information from two sources to answer the user's question:

1. MEETING DATA (from internal records of past meetings):
${meetingContext}

2. EXTERNAL INFORMATION (${researchNote}):
${researchContext}

Combine these sources into a coherent, helpful answer. Be clear about which information comes from meeting records vs external sources. If there are contradictions, note them.`,
      },
      {
        role: "user",
        content: originalQuery,
      },
    ],
  });

  const synthesizedAnswer = response.choices[0]?.message?.content || "Unable to synthesize response.";
  
  if (hasCitations) {
    return synthesizedAnswer + citations;
  } else if (researchResult.disclaimer) {
    return synthesizedAnswer + `\n\n_${researchResult.disclaimer}_`;
  }
  return synthesizedAnswer;
}

/**
 * Find relevant meetings based on company/person names in the query.
 * Uses fuzzy matching on company names and contact names.
 */
type MeetingSearchResult = {
  meetings: SingleMeetingContext[];
  searchedFor: string;
};

async function findRelevantMeetings(
  userMessage: string,
  classification: IntentClassification
): Promise<MeetingSearchResult> {
  const { storage } = await import("../storage");
  
  // Extract search terms from the message
  const searchTerms = extractSearchTerms(userMessage);
  console.log(`[OpenAssistant] Searching for meetings with terms: ${searchTerms.join(", ")}`);
  
  // If no terms extracted, try a broad fallback search using key words from the message
  if (searchTerms.length === 0) {
    console.log(`[OpenAssistant] No search terms extracted, trying fallback word search`);
    const fallbackMeetings = await fallbackMeetingSearch(userMessage);
    return { 
      meetings: fallbackMeetings, 
      searchedFor: "(fallback search)" 
    };
  }

  // Search for companies matching any of the terms
  const companyMatches = await searchCompanies(searchTerms);
  
  if (companyMatches.length === 0) {
    // Try searching contacts/attendees
    const contactMatches = await searchContacts(searchTerms);
    if (contactMatches.length > 0) {
      return {
        meetings: contactMatches,
        searchedFor: searchTerms.join(", "),
      };
    }
    
    // Still no matches - try fallback search
    console.log(`[OpenAssistant] No company/contact matches, trying fallback search`);
    const fallbackMeetings = await fallbackMeetingSearch(userMessage);
    return { 
      meetings: fallbackMeetings, 
      searchedFor: searchTerms.join(", ") + " (+ fallback)" 
    };
  }

  // Get the most recent meeting for each matching company
  const meetings: SingleMeetingContext[] = [];
  for (const company of companyMatches) {
    const transcriptRows = await storage.rawQuery(`
      SELECT t.id, t.meeting_date, c.name as company_name, c.id as company_id
      FROM transcripts t
      JOIN companies c ON t.company_id = c.id
      WHERE t.company_id = $1
      ORDER BY COALESCE(t.meeting_date, t.created_at) DESC
      LIMIT 1
    `, [company.id]);

    if (transcriptRows && transcriptRows.length > 0) {
      const row = transcriptRows[0];
      meetings.push({
        meetingId: row.id as string,
        companyId: row.company_id as string,
        companyName: row.company_name as string,
        meetingDate: row.meeting_date ? new Date(row.meeting_date as string) : null,
      });
    }
  }

  return {
    meetings,
    searchedFor: searchTerms.join(", "),
  };
}

/**
 * Fallback search: extract significant words and search companies directly.
 * Used when extractSearchTerms fails to find proper nouns/acronyms.
 */
async function fallbackMeetingSearch(message: string): Promise<SingleMeetingContext[]> {
  const { storage } = await import("../storage");
  
  // Extract significant words (3+ chars, not common stop words)
  const stopWords = new Set([
    "the", "and", "for", "are", "but", "not", "you", "all", "can", "had", 
    "her", "was", "one", "our", "out", "day", "get", "has", "him", "his",
    "how", "its", "let", "may", "new", "now", "old", "see", "way", "who",
    "did", "does", "what", "when", "where", "which", "while", "with", "about",
    "said", "they", "this", "that", "from", "have", "been", "some", "could",
    "would", "should", "their", "there", "these", "those", "being", "other",
  ]);
  
  const words = message
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 3 && !stopWords.has(w.toLowerCase()));
  
  console.log(`[OpenAssistant] Fallback search words: ${words.join(", ")}`);
  
  // Try each word as a company search
  const meetings: SingleMeetingContext[] = [];
  const seenCompanyIds = new Set<string>();
  
  for (const word of words.slice(0, 5)) { // Limit to first 5 words
    const rows = await storage.rawQuery(`
      SELECT DISTINCT t.id as meeting_id, t.meeting_date, c.id as company_id, c.name as company_name
      FROM transcripts t
      JOIN companies c ON t.company_id = c.id
      WHERE c.name ILIKE $1
      ORDER BY COALESCE(t.meeting_date, t.created_at) DESC
      LIMIT 2
    `, [`%${word}%`]);
    
    if (rows) {
      for (const row of rows) {
        if (!seenCompanyIds.has(row.company_id as string)) {
          seenCompanyIds.add(row.company_id as string);
          meetings.push({
            meetingId: row.meeting_id as string,
            companyId: row.company_id as string,
            companyName: row.company_name as string,
            meetingDate: row.meeting_date ? new Date(row.meeting_date as string) : null,
          });
        }
      }
    }
  }
  
  return meetings;
}

/**
 * Extract company/person names from user message.
 * Handles:
 * - Proper nouns (Tyler Wiggins, Les Schwab)
 * - All-caps acronyms (ACE, IT, ROI)
 * - Mixed case (iPhone, PitCrew)
 * - Quoted strings
 */
function extractSearchTerms(message: string): string[] {
  const terms: string[] = [];
  
  // Common words to filter out (lowercase for comparison)
  const commonWords = new Set([
    "what", "who", "where", "when", "why", "how", "the", "this", "that", 
    "can", "could", "would", "should", "did", "does", "do", "is", "are", 
    "was", "were", "has", "have", "had", "will", "shall", "may", "might", 
    "must", "find", "show", "tell", "give", "help", "get", "let", "make", 
    "want", "need", "like", "think", "know", "say", "said", "about", "from",
    "with", "for", "and", "or", "but", "not", "all", "any", "some", "their",
    "they", "them", "our", "we", "you", "your", "its", "his", "her", "him",
    "she", "he", "it", "be", "been", "being", "am", "an", "a", "to", "of",
    "in", "on", "at", "by", "up", "out", "if", "so", "no", "yes", "my",
    "roi", "tv", "api", "it", // common acronyms that aren't company names
  ]);
  
  // 1. Match proper nouns (capitalized words like Tyler Wiggins, Les Schwab)
  const properNounPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
  let match;
  while ((match = properNounPattern.exec(message)) !== null) {
    const term = match[1];
    if (!commonWords.has(term.toLowerCase())) {
      terms.push(term);
    }
  }

  // 2. Match all-caps acronyms (ACE, HVAC, POS) - 2-10 uppercase letters
  const acronymPattern = /\b([A-Z]{2,10})\b/g;
  while ((match = acronymPattern.exec(message)) !== null) {
    const term = match[1];
    if (!commonWords.has(term.toLowerCase())) {
      terms.push(term);
    }
  }

  // 3. Match multi-word company names with mixed case (e.g., Jiffy Lube, Les Schwab)
  const multiWordPattern = /\b([A-Z][a-z]+(?:\s+[A-Z]?[a-z]+)+)\b/g;
  while ((match = multiWordPattern.exec(message)) !== null) {
    const term = match[1];
    if (!commonWords.has(term.toLowerCase()) && term.split(" ").length <= 4) {
      terms.push(term);
    }
  }

  // 4. Quoted strings
  const quotedPattern = /"([^"]+)"/g;
  while ((match = quotedPattern.exec(message)) !== null) {
    terms.push(match[1]);
  }

  return Array.from(new Set(terms)); // Dedupe
}

/**
 * Search companies by fuzzy name matching.
 */
async function searchCompanies(searchTerms: string[]): Promise<Array<{ id: string; name: string }>> {
  const { storage } = await import("../storage");
  const results: Array<{ id: string; name: string }> = [];

  for (const term of searchTerms) {
    // Use ILIKE for case-insensitive partial matching
    const rows = await storage.rawQuery(`
      SELECT id, name FROM companies 
      WHERE name ILIKE $1 OR name ILIKE $2
      LIMIT 5
    `, [`%${term}%`, `${term}%`]);

    if (rows) {
      for (const row of rows) {
        if (!results.find(r => r.id === row.id)) {
          results.push({ id: row.id as string, name: row.name as string });
        }
      }
    }
  }

  return results;
}

/**
 * Search contacts/attendees and return their meetings.
 */
async function searchContacts(searchTerms: string[]): Promise<SingleMeetingContext[]> {
  const { storage } = await import("../storage");
  const meetings: SingleMeetingContext[] = [];

  for (const term of searchTerms) {
    // Search in transcript attendees (contacts)
    const rows = await storage.rawQuery(`
      SELECT DISTINCT t.id as meeting_id, t.meeting_date, c.id as company_id, c.name as company_name
      FROM transcripts t
      JOIN companies c ON t.company_id = c.id
      LEFT JOIN contacts ct ON ct.company_id = c.id
      WHERE ct.name ILIKE $1
      ORDER BY COALESCE(t.meeting_date, t.created_at) DESC
      LIMIT 3
    `, [`%${term}%`]);

    if (rows) {
      for (const row of rows) {
        if (!meetings.find(m => m.meetingId === row.meeting_id)) {
          meetings.push({
            meetingId: row.meeting_id as string,
            companyId: row.company_id as string,
            companyName: row.company_name as string,
            meetingDate: row.meeting_date ? new Date(row.meeting_date as string) : null,
          });
        }
      }
    }
  }

  return meetings;
}

/**
 * Search across multiple meetings for relevant information.
 */
async function searchAcrossMeetings(
  userMessage: string,
  meetings: SingleMeetingContext[]
): Promise<string> {
  console.log(`[OpenAssistant] Searching across ${meetings.length} meetings`);
  
  // Collect results from each meeting
  const allResults: Array<{
    companyName: string;
    meetingDate: string;
    answer: string;
  }> = [];

  for (const meeting of meetings.slice(0, 5)) { // Limit to 5 meetings
    try {
      const result = await handleSingleMeetingQuestion(meeting, userMessage, false);
      if (result.dataSource !== "not_found") {
        allResults.push({
          companyName: meeting.companyName,
          meetingDate: meeting.meetingDate?.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) || "Unknown date",
          answer: result.answer,
        });
      }
    } catch (err) {
      console.error(`[OpenAssistant] Error searching meeting ${meeting.meetingId}:`, err);
    }
  }

  if (allResults.length === 0) {
    return `I searched across ${meetings.length} meeting(s) with ${meetings.map(m => m.companyName).join(", ")}, but couldn't find information related to your question.`;
  }

  // Format combined response
  const formattedResults = allResults.map(r => 
    `**${r.companyName}** (${r.meetingDate}):\n${r.answer}`
  ).join("\n\n---\n\n");

  return `Here's what I found across ${allResults.length} meeting(s):\n\n${formattedResults}`;
}

/**
 * Determine if the Open Assistant path should be used.
 * 
 * The Open Assistant path is used when:
 * - No meeting is resolved AND user intent appears to be general assistance/research
 * - OR user explicitly asks for research or general help
 * 
 * The existing single-meeting path is used when:
 * - Meeting is resolved AND user intent is meeting_data
 */
export async function shouldUseOpenAssistant(
  userMessage: string,
  resolvedMeeting: SingleMeetingContext | null
): Promise<{ useOpenAssistant: boolean; classification?: IntentClassification }> {
  if (resolvedMeeting) {
    return { useOpenAssistant: false };
  }

  const classification = await classifyIntent(userMessage);
  
  if (classification.intent === "meeting_data" && classification.meetingRelevance.referencesSpecificInteraction) {
    return { useOpenAssistant: false, classification };
  }

  return { useOpenAssistant: true, classification };
}
