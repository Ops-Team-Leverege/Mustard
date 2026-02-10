/**
 * Decision Layer (Intent Router + Orchestrator)
 * 
 * Purpose:
 * Central export for the Intent → Context Layers → Answer Contract architecture.
 * 
 * Flow:
 * 1. Intent Router: Classify Intent (keyword fast-path + LLM fallback)
 * 2. Compute Context Layers (intent-gated)
 * 3. Orchestrator: Select Answer Contract (after layers determined)
 * 
 * Layer: Decision Layer (routing + orchestration)
 */

import {
  Intent,
  classifyIntent,
  type IntentClassificationResult,
  type IntentDetectionMethod,
} from "./intent";

import {
  computeContextLayers,
  canAccessProductSSOT,
  canAccessSingleMeeting,
  canAccessMultiMeeting,
  getEnabledLayerNames,
  PRODUCT_IDENTITY_CONTEXT,
  type ContextLayers,
  type ContextLayerMetadata,
} from "./contextLayers";

import {
  AnswerContract,
  selectAnswerContract,
  getContractConstraints,
  type AnswerContractResult,
  type AnswerContractConstraints,
  type ContractSelectionMethod,
} from "./answerContracts";

import OpenAI from "openai";
import { AGGREGATE_SPECIFICITY_CHECK_PROMPT } from "../config/prompts";
import { MODEL_ASSIGNMENTS } from "../config/models";
import { storage } from "../storage";

export {
  Intent,
  classifyIntent,
  type IntentClassificationResult,
  type IntentDetectionMethod,
};

export {
  computeContextLayers,
  canAccessProductSSOT,
  canAccessSingleMeeting,
  canAccessMultiMeeting,
  getEnabledLayerNames,
  PRODUCT_IDENTITY_CONTEXT,
  type ContextLayers,
  type ContextLayerMetadata,
};

export {
  AnswerContract,
  selectAnswerContract,
  getContractConstraints,
  type AnswerContractResult,
  type AnswerContractConstraints,
  type ContractSelectionMethod,
};

export type ProposedInterpretation = {
  intent: string;
  contracts: string[];  // Ordered array for contract chain
  summary: string;
};

export type ThreadContext = {
  messages: Array<{
    text: string;
    isBot: boolean;
  }>;
};

export type DecisionLayerResult = {
  intent: Intent;
  intentDetectionMethod: string;
  contextLayers: ContextLayers;
  answerContract: AnswerContract;  // Primary contract (first in chain)
  contractChain?: AnswerContract[];  // Full contract chain for multi-step requests
  contractSelectionMethod: string;
  clarifyMessage?: string; // Smart clarification message when intent is CLARIFY
  proposedInterpretation?: ProposedInterpretation; // For CLARIFY: what the LLM thinks user wants
  scopeNote?: string; // Non-blocking note about scope defaults (prepended to response)
  // LLM-determined scope (passed downstream to avoid regex re-detection)
  scope?: {
    allCustomers: boolean; // True if LLM detected "all customers" scope (scopeType="all")
    scopeType: "all" | "specific" | "none"; // What kind of scope was detected
    specificCompanies: string[] | null; // Company names if scopeType="specific"
    hasTimeRange: boolean; // True if LLM detected time range
    timeRangeExplanation?: string; // e.g., "3 most recent meetings"
    customerScopeExplanation?: string; // e.g., "we've had implies all customers"
    meetingLimit?: number | null; // e.g., "3 most recent" → 3
    threadMessages?: Array<{ text: string; isBot: boolean }>; // Thread context for topic extraction
  };
  // Semantic context extraction from conversation (NEW)
  extractedCompany?: string;                        // Single company name extracted from context
  extractedCompanies?: string[];                    // Multiple companies if ambiguous
  isAmbiguous?: boolean;                           // True if multiple companies mentioned
  conversationContext?: string;                     // What is this conversation about?
  keyTopics?: string[];                            // Key topics being discussed
  shouldProceed?: boolean;                         // Should we proceed without clarification?
  clarificationSuggestion?: string;               // Specific clarification message if ambiguous
};

// Backward compatibility alias
export type ControlPlaneResult = DecisionLayerResult;

// Aggregate contracts that require scope clarification
const AGGREGATE_CONTRACTS = [
  AnswerContract.CROSS_MEETING_QUESTIONS,
  AnswerContract.PATTERN_ANALYSIS,
  AnswerContract.TREND_SUMMARY,
];

// LLM-based specificity check result
interface SpecificityCheckResult {
  hasTimeRange: boolean;
  hasCustomerScope: boolean;
  scopeType: "all" | "specific" | "none";
  specificCompanies: string[] | null;
  timeRangeExplanation: string;
  customerScopeExplanation: string;
  meetingLimit?: number | null; // e.g., "3 most recent" → 3
}

/**
 * Use LLM to check if the question has sufficient specificity for aggregate queries.
 * This replaces brittle regex patterns with semantic understanding.
 * 
 * When threadContext is provided, we include the full conversation history
 * so the LLM can see scope information from earlier messages (e.g., company names).
 */
async function checkAggregateSpecificity(question: string, threadContext?: ThreadContext): Promise<SpecificityCheckResult> {
  try {
    const openai = new OpenAI();

    // Build messages array with thread history for context
    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: AGGREGATE_SPECIFICITY_CHECK_PROMPT },
    ];

    // Include thread history so LLM can see company/scope from earlier messages
    if (threadContext?.messages && threadContext.messages.length > 1) {
      const historyMessages = threadContext.messages.slice(0, -1); // Exclude current message
      for (const msg of historyMessages) {
        messages.push({
          role: msg.isBot ? "assistant" : "user",
          content: msg.text,
        });
      }
    }

    // Add current question
    messages.push({ role: "user", content: question });

    const response = await openai.chat.completions.create({
      model: MODEL_ASSIGNMENTS.AGGREGATE_SPECIFICITY_CHECK,
      messages,
      temperature: 0,
      max_tokens: 200,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.log("[DecisionLayer] No content from specificity check, defaulting to needs clarification");
      return { hasTimeRange: false, hasCustomerScope: false, scopeType: "none", specificCompanies: null, timeRangeExplanation: "", customerScopeExplanation: "", meetingLimit: null };
    }

    const result = JSON.parse(content) as SpecificityCheckResult;
    console.log(`[DecisionLayer] Specificity check: hasTimeRange=${result.hasTimeRange} (${result.timeRangeExplanation}), hasCustomerScope=${result.hasCustomerScope} (${result.customerScopeExplanation}), scopeType=${result.scopeType}, specificCompanies=${JSON.stringify(result.specificCompanies)}, meetingLimit=${result.meetingLimit}`);
    return result;
  } catch (error) {
    console.error("[DecisionLayer] Specificity check failed, defaulting to needs clarification:", error);
    return { hasTimeRange: false, hasCustomerScope: false, scopeType: "none", specificCompanies: null, timeRangeExplanation: "", customerScopeExplanation: "", meetingLimit: null };
  }
}

function generateScopeNote(hasTime: boolean, hasScope: boolean): string {
  const parts: string[] = [];
  if (!hasScope) parts.push("all customers");
  if (!hasTime) parts.push("all time");
  if (parts.length === 0) return "";
  return `_Searching across ${parts.join(", ")}._`;
}

function shouldAskForTimeRange(hasTime: boolean, meetingCount: number): string {
  if (!hasTime && meetingCount > 100) {
    return `You have ${meetingCount} meetings on record. To keep the analysis focused, could you narrow the time range?

- Last month
- Last quarter  
- All time

For example: "...from the last quarter"`;
  }
  return "";
}

export async function runDecisionLayer(
  question: string,
  threadContext?: ThreadContext
): Promise<DecisionLayerResult> {
  console.log(`[DecisionLayer] ✅ CONTEXT CHECKPOINT 4 - Input to Decision Layer:`);
  console.log(`  Question: "${question}"`);
  console.log(`  Thread Context: ${threadContext ? `${threadContext.messages.length} messages` : 'none'}`);
  if (threadContext?.messages) {
    console.log(`  Thread Messages Preview:`);
    threadContext.messages.slice(-2).forEach((msg, i) => {
      const preview = msg.text.length > 80 ? msg.text.substring(0, 80) + '...' : msg.text;
      console.log(`    ${msg.isBot ? 'Bot' : 'User'}: "${preview}"`);
    });
  }

  const intentResult = await classifyIntent(question, threadContext);

  console.log(`[DecisionLayer] Intent: ${intentResult.intent} (${intentResult.intentDetectionMethod})`);

  const layersMeta = computeContextLayers(intentResult.intent);

  console.log(`[DecisionLayer] Context Layers: ${JSON.stringify(layersMeta.layers)}`);

  // LLM-first: Use proposedInterpretation.contracts (single source of truth)
  const contractResult = await selectAnswerContract(
    question,
    intentResult.intent,
    layersMeta.layers,
    intentResult.proposedInterpretation?.contracts
  );

  console.log(`[DecisionLayer] Contract: ${contractResult.contract} (${contractResult.contractSelectionMethod})`);

  // For MULTI_MEETING intent, always run specificity check to get LLM-determined scope
  // This scope is passed downstream to avoid regex re-detection in meeting resolver
  let scopeInfo: DecisionLayerResult["scope"];
  let scopeNote: string | undefined;

  if (intentResult.intent === Intent.MULTI_MEETING) {
    const specificity = await checkAggregateSpecificity(question, threadContext);

    const effectiveScopeType = specificity.scopeType === "none" ? "all" : specificity.scopeType;
    const effectiveAllCustomers = effectiveScopeType === "all";

    scopeInfo = {
      allCustomers: effectiveAllCustomers,
      scopeType: effectiveScopeType,
      specificCompanies: specificity.specificCompanies,
      hasTimeRange: specificity.hasTimeRange,
      timeRangeExplanation: specificity.timeRangeExplanation,
      customerScopeExplanation: specificity.customerScopeExplanation,
      meetingLimit: specificity.meetingLimit ?? null,
      threadMessages: threadContext?.messages,
    };

    console.log(`[DecisionLayer] LLM scope detection: scopeType=${scopeInfo.scopeType}, allCustomers=${scopeInfo.allCustomers}, specificCompanies=${JSON.stringify(scopeInfo.specificCompanies)}, hasTimeRange=${scopeInfo.hasTimeRange} (${scopeInfo.timeRangeExplanation}), meetingLimit=${scopeInfo.meetingLimit}`);

    if (AGGREGATE_CONTRACTS.includes(contractResult.contract)) {
      const meetingCountRows = await storage.rawQuery(`SELECT COUNT(*) as cnt FROM transcripts`);
      const meetingCount = parseInt(meetingCountRows?.[0]?.cnt as string, 10) || 0;

      const clarifyMessage = shouldAskForTimeRange(specificity.hasTimeRange, meetingCount);

      if (clarifyMessage) {
        console.log(`[DecisionLayer] ✅ CONTEXT CHECKPOINT 5 - Requesting Clarification:`);
        console.log(`  Reason: Too many meetings (${meetingCount}) without time range`);
        console.log(`  Clarify Message: "${clarifyMessage.substring(0, 100)}..."`);

        return {
          intent: Intent.CLARIFY,
          intentDetectionMethod: "aggregate_scope_check",
          contextLayers: layersMeta.layers,
          answerContract: contractResult.contract,
          contractSelectionMethod: contractResult.contractSelectionMethod,
          clarifyMessage,
          proposedInterpretation: {
            intent: intentResult.intent.toString(),
            contracts: [contractResult.contract.toString()],
            summary: "Aggregate analysis - awaiting scope",
          },
          scope: scopeInfo,
          extractedCompany: intentResult.extractedCompany,
          extractedCompanies: intentResult.extractedCompanies,
          isAmbiguous: intentResult.isAmbiguous,
          conversationContext: intentResult.conversationContext,
          keyTopics: intentResult.keyTopics,
          shouldProceed: intentResult.shouldProceed,
          clarificationSuggestion: intentResult.clarificationSuggestion,
        };
      }
    }

    scopeNote = generateScopeNote(specificity.hasTimeRange, specificity.hasCustomerScope);
  }

  // Build contract chain from LLM-proposed contracts if available
  const contractChain = intentResult.proposedInterpretation?.contracts
    ?.map(c => AnswerContract[c as keyof typeof AnswerContract])
    .filter((c): c is AnswerContract => c !== undefined);

  const finalResult = {
    intent: intentResult.intent,
    intentDetectionMethod: intentResult.intentDetectionMethod,
    contextLayers: layersMeta.layers,
    answerContract: contractResult.contract,
    contractChain: contractChain && contractChain.length > 1 ? contractChain : undefined,
    contractSelectionMethod: contractResult.contractSelectionMethod,
    clarifyMessage: intentResult.clarifyMessage,
    proposedInterpretation: intentResult.proposedInterpretation,
    scopeNote,
    scope: scopeInfo,
    // Semantic context extraction from conversation
    extractedCompany: intentResult.extractedCompany,
    extractedCompanies: intentResult.extractedCompanies,
    isAmbiguous: intentResult.isAmbiguous,
    conversationContext: intentResult.conversationContext,
    keyTopics: intentResult.keyTopics,
    shouldProceed: intentResult.shouldProceed,
    clarificationSuggestion: intentResult.clarificationSuggestion,
  };

  console.log(`[DecisionLayer] ✅ CONTEXT CHECKPOINT 5 - Final Decision:`);
  console.log(`  Final Intent: ${finalResult.intent}`);
  console.log(`  Final Contract: ${finalResult.answerContract}`);
  console.log(`  Will Clarify: ${!!finalResult.clarifyMessage}`);
  console.log(`  Scope Info: ${scopeInfo ? 'present' : 'none'}`);
  if (scopeNote) console.log(`  Scope Note: ${scopeNote}`);

  return finalResult;
}

// Backward compatibility alias
export const runControlPlane = runDecisionLayer;
