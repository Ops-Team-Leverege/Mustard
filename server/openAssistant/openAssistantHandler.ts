/**
 * Open Assistant Handler - Thin Orchestration Layer
 * 
 * Purpose:
 * Wires together the focused modules to handle Open Assistant requests.
 * This layer is intentionally thin - all complex logic lives in:
 * - meetingResolver.ts: Meeting lookup and scope resolution
 * - contractExecutor.ts: Contract chain execution and evidence enforcement
 * - types.ts: Shared type definitions
 * 
 * Key Principles:
 * - Control Plane is the SOLE authority for intent classification
 * - This handler routes based on Control Plane decisions, never reclassifies
 * - Execution Plane is deterministic and follows contracts verbatim
 */

import { OpenAI } from "openai";
import { performExternalResearch, formatCitationsForDisplay, type ResearchResult } from "./externalResearch";
import { handleSingleMeetingQuestion, type SingleMeetingContext, type SingleMeetingResult } from "../mcp/singleMeetingOrchestrator";
import { Intent, type IntentClassificationResult } from "../controlPlane/intent";
import { AnswerContract, type SSOTMode, selectMultiMeetingContractChain, selectSingleMeetingContractChain } from "../controlPlane/answerContracts";

import { 
  type EvidenceSource, 
  type IntentClassification, 
  type OpenAssistantContext, 
  type OpenAssistantResult,
  defaultClassification,
  deriveEvidenceSource 
} from "./types";
import { findRelevantMeetings, searchAcrossMeetings } from "./meetingResolver";
import { executeContractChain, mapOrchestratorIntentToContract } from "./contractExecutor";

export type { EvidenceSource, IntentClassification, OpenAssistantContext, OpenAssistantResult };

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

/**
 * AMBIENT PRODUCT CONTEXT (Always On)
 * 
 * Provides product identity and framing while explicitly restricting factual authority.
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

/**
 * HARDENING: Patterns that indicate the user would benefit from factual evidence.
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

/**
 * Main entry point for Open Assistant.
 * 
 * Called from Slack events handler after initial processing.
 * Routes to appropriate handler based on Control Plane intent.
 */
export async function handleOpenAssistant(
  userMessage: string,
  context: OpenAssistantContext
): Promise<OpenAssistantResult> {
  console.log(`[OpenAssistant] Processing: "${userMessage}"`);
  
  if (context.controlPlaneResult) {
    const cpResult = context.controlPlaneResult;
    console.log(`[OpenAssistant] Using full Control Plane result: intent=${cpResult.intent}, contract=${cpResult.answerContract}, method=${cpResult.intentDetectionMethod}`);
    
    if (cpResult.intent === Intent.REFUSE) {
      return {
        answer: "I'm sorry, but that question is outside of what I can help with. I'm designed to assist with PitCrew-related topics, customer meetings, and product information.",
        intent: "general_assistance",
        intentClassification: defaultClassification("Refused by control plane"),
        controlPlaneIntent: cpResult.intent,
        answerContract: cpResult.answerContract,
        dataSource: "clarification",
        delegatedToSingleMeeting: false,
      };
    }
    
    if (cpResult.intent === Intent.CLARIFY) {
      return {
        answer: "I need a bit more context to help you effectively. Could you tell me more about what you're looking for?",
        intent: "general_assistance",
        intentClassification: defaultClassification("Clarification required by control plane"),
        controlPlaneIntent: cpResult.intent,
        answerContract: cpResult.answerContract,
        dataSource: "clarification",
        delegatedToSingleMeeting: false,
      };
    }
    
    const evidenceSource = deriveEvidenceSource(cpResult.intent);
    const classification: IntentClassification = {
      intent: evidenceSource,
      confidence: "high",
      rationale: `Derived from Control Plane: ${cpResult.intent} -> ${cpResult.answerContract}`,
      meetingRelevance: {
        referencesSpecificInteraction: cpResult.intent === Intent.SINGLE_MEETING,
        asksWhatWasSaidOrAgreed: false,
        asksAboutCustomerQuestions: false,
      },
      researchRelevance: {
        needsPublicInfo: false,
        companyOrEntityMentioned: null,
        topicForResearch: null,
      },
    };
    
    console.log(`[OpenAssistant] Evidence source: ${evidenceSource} (from Control Plane: ${cpResult.intent} -> ${cpResult.answerContract})`);
    
    if (cpResult.intent === Intent.SINGLE_MEETING) {
      return handleMeetingDataIntent(userMessage, context, classification, cpResult.answerContract);
    }
    
    if (cpResult.intent === Intent.MULTI_MEETING) {
      return handleMultiMeetingIntent(userMessage, context, classification, cpResult.answerContract);
    }
    
    if (cpResult.intent === Intent.PRODUCT_KNOWLEDGE) {
      return handleProductKnowledgeIntent(userMessage, context, classification, cpResult.answerContract);
    }
    
    return handleGeneralAssistanceIntent(userMessage, context, classification, cpResult.answerContract);
  }
  
  // CONTROL PLANE REQUIRED: No fallback to separate classifier
  console.log(`[OpenAssistant] WARNING: No Control Plane intent provided, defaulting to CLARIFY`);
  const fallbackClassification = defaultClassification("No Control Plane intent provided - clarification needed");
  
  return {
    answer: "I need a bit more context to help you effectively. Could you tell me more about what you're looking for?",
    intent: "general_assistance",
    intentClassification: fallbackClassification,
    controlPlaneIntent: Intent.CLARIFY,
    answerContract: AnswerContract.CLARIFY,
    dataSource: "clarification",
    delegatedToSingleMeeting: false,
  };
}

/**
 * Handle SINGLE_MEETING intent by delegating to SingleMeetingOrchestrator.
 */
async function handleMeetingDataIntent(
  userMessage: string,
  context: OpenAssistantContext,
  classification: IntentClassification,
  contract?: AnswerContract
): Promise<OpenAssistantResult> {
  console.log(`[OpenAssistant] Routing to meeting data path${contract ? ` (CP contract: ${contract})` : ''}`);
  
  if (context.resolvedMeeting) {
    const scope = {
      meetingId: context.resolvedMeeting.meetingId,
      companyId: context.resolvedMeeting.companyId,
      companyName: context.resolvedMeeting.companyName,
    };
    
    // USE CONTROL PLANE CONTRACT when provided (Control Plane is sole authority)
    // Only fall back to internal selection when CP contract not provided (legacy paths)
    let primaryContract: AnswerContract;
    let contractChain: AnswerContract[];
    
    if (contract) {
      // Control Plane provided the contract - use it directly
      primaryContract = contract;
      contractChain = [contract];
      console.log(`[OpenAssistant] Using CP-provided contract: ${contract}`);
    } else {
      // Legacy path (no CP context) - use internal selection
      const chain = selectSingleMeetingContractChain(userMessage, scope);
      primaryContract = chain.primaryContract;
      contractChain = chain.contracts;
      console.log(`[OpenAssistant] Legacy path - selected chain: [${chain.contracts.join(" → ")}]`);
    }
    
    // Pass the primary contract to the orchestrator to skip deprecated classification
    const singleMeetingResult = await handleSingleMeetingQuestion(
      context.resolvedMeeting,
      userMessage,
      false,
      primaryContract
    );

    return {
      answer: singleMeetingResult.answer,
      intent: "meeting_data",
      intentClassification: classification,
      controlPlaneIntent: Intent.SINGLE_MEETING,
      answerContract: primaryContract,
      answerContractChain: contractChain,
      ssotMode: "none" as SSOTMode,
      dataSource: "meeting_artifacts",
      singleMeetingResult,
      delegatedToSingleMeeting: true,
    };
  }

  console.log(`[OpenAssistant] No meeting resolved, searching for relevant meetings`);
  
  const meetingSearch = await findRelevantMeetings(userMessage, classification);
  
  if (meetingSearch.meetings.length === 0) {
    console.log(`[OpenAssistant] Scope resolution failed: SINGLE_MEETING intent, searched for: "${meetingSearch.searchedFor || 'nothing specific'}", candidates found: 0`);
    console.log(`[OpenAssistant] Scope resolution decision: CLARIFY (reason: no meetings matched search criteria)`);
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
    const meeting = meetingSearch.meetings[0];
    console.log(`[OpenAssistant] Found single meeting: ${meeting.companyName} (${meeting.meetingId})`);
    
    const scope = {
      meetingId: meeting.meetingId,
      companyId: meeting.companyId,
      companyName: meeting.companyName,
    };
    
    // USE CONTROL PLANE CONTRACT when provided (Control Plane is sole authority)
    let primaryContract: AnswerContract;
    let contractChain: AnswerContract[];
    
    if (contract) {
      primaryContract = contract;
      contractChain = [contract];
      console.log(`[OpenAssistant] Using CP-provided contract: ${contract}`);
    } else {
      const chain = selectSingleMeetingContractChain(userMessage, scope);
      primaryContract = chain.primaryContract;
      contractChain = chain.contracts;
      console.log(`[OpenAssistant] Legacy path - selected chain: [${chain.contracts.join(" → ")}]`);
    }
    
    // Pass the primary contract to the orchestrator
    const singleMeetingResult = await handleSingleMeetingQuestion(
      meeting,
      userMessage,
      false,
      primaryContract
    );

    return {
      answer: singleMeetingResult.answer,
      intent: "meeting_data",
      intentClassification: classification,
      controlPlaneIntent: Intent.SINGLE_MEETING,
      answerContract: primaryContract,
      answerContractChain: contractChain,
      ssotMode: "none" as SSOTMode,
      dataSource: "meeting_artifacts",
      singleMeetingResult,
      delegatedToSingleMeeting: true,
    };
  }

  // Multiple meetings found - route through MULTI_MEETING path
  console.log(`[OpenAssistant] Found ${meetingSearch.meetings.length} meetings, routing to MULTI_MEETING path`);
  
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
  
  const chain = selectMultiMeetingContractChain(userMessage, scope);
  console.log(`[OpenAssistant] Selected MULTI_MEETING chain: [${chain.contracts.join(" → ")}] (coverage: ${scope.coverage.matchingMeetingsCount} meetings)`);
  
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
 * Handle MULTI_MEETING intent.
 */
async function handleMultiMeetingIntent(
  userMessage: string,
  context: OpenAssistantContext,
  classification: IntentClassification,
  contract?: AnswerContract
): Promise<OpenAssistantResult> {
  console.log(`[OpenAssistant] Routing to MULTI_MEETING path${contract ? ` (CP contract: ${contract})` : ''}`);
  
  const meetingSearch = await findRelevantMeetings(userMessage, classification);
  
  if (meetingSearch.meetings.length === 0) {
    console.log(`[OpenAssistant] Scope resolution failed: MULTI_MEETING intent, searched for: "${meetingSearch.searchedFor || 'all meetings'}", candidates found: 0`);
    console.log(`[OpenAssistant] Scope resolution decision: CLARIFY (reason: no meetings matched search criteria for cross-meeting analysis)`);
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
  
  // USE CONTROL PLANE CONTRACT when provided (Control Plane is sole authority)
  let primaryContract: AnswerContract;
  let contractChain: AnswerContract[];
  
  if (contract) {
    // Control Plane provided the contract - use it directly
    primaryContract = contract;
    contractChain = [contract];
    console.log(`[OpenAssistant] Using CP-provided contract: ${contract}`);
  } else {
    // Legacy path (no CP context) - use internal selection
    const chain = selectMultiMeetingContractChain(userMessage, scope);
    primaryContract = chain.primaryContract;
    contractChain = chain.contracts;
    console.log(`[OpenAssistant] Legacy path - selected chain: [${chain.contracts.join(" → ")}]`);
  }
  
  const chainResult = await executeContractChain(
    { contracts: contractChain, primaryContract, selectionMethod: "keyword" },
    userMessage,
    meetingSearch.meetings
  );
  
  return {
    answer: chainResult.finalOutput,
    intent: "meeting_data",
    intentClassification: classification,
    controlPlaneIntent: Intent.MULTI_MEETING,
    answerContract: primaryContract,
    answerContractChain: contractChain,
    ssotMode: "none" as SSOTMode,
    dataSource: "meeting_artifacts",
    delegatedToSingleMeeting: false,
  };
}

/**
 * Handle PRODUCT_KNOWLEDGE intent.
 */
async function handleProductKnowledgeIntent(
  userMessage: string,
  context: OpenAssistantContext,
  classification: IntentClassification,
  contract?: AnswerContract
): Promise<OpenAssistantResult> {
  console.log(`[OpenAssistant] Routing to product knowledge path${contract ? ` (CP contract: ${contract})` : ''}`);
  
  // USE CONTROL PLANE CONTRACT when provided
  const actualContract = contract || AnswerContract.PRODUCT_EXPLANATION;
  
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
    intent: "meeting_data",
    intentClassification: classification,
    controlPlaneIntent: Intent.PRODUCT_KNOWLEDGE,
    answerContract: actualContract,
    ssotMode: "descriptive",
    dataSource: "product_ssot",
    delegatedToSingleMeeting: false,
  };
}

/**
 * Handle GENERAL_HELP intent.
 */
async function handleGeneralAssistanceIntent(
  userMessage: string,
  context: OpenAssistantContext,
  classification: IntentClassification,
  contract?: AnswerContract
): Promise<OpenAssistantResult> {
  console.log(`[OpenAssistant] Routing to general assistance path${contract ? ` (CP contract: ${contract})` : ''}`);
  
  // USE CONTROL PLANE CONTRACT when provided
  const actualContract = contract || AnswerContract.GENERAL_RESPONSE;
  
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
    answerContract: actualContract,
    ssotMode: "none" as SSOTMode,
    dataSource: "general_knowledge",
    delegatedToSingleMeeting: false,
  };
}

/**
 * Determine if the Open Assistant path should be used.
 * 
 * IMPORTANT: This function no longer performs intent classification.
 * The Control Plane (server/controlPlane/intent.ts) is the SOLE authority.
 */
export function shouldUseOpenAssistant(
  resolvedMeeting: SingleMeetingContext | null
): { useOpenAssistant: boolean } {
  return { useOpenAssistant: true };
}
