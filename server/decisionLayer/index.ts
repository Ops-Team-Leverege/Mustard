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
  canAccessDocuments,
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
  canAccessDocuments,
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
  contract: string;
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
  answerContract: AnswerContract;
  contractSelectionMethod: string;
  clarifyMessage?: string; // Smart clarification message when intent is CLARIFY
  proposedInterpretation?: ProposedInterpretation; // For CLARIFY: what the LLM thinks user wants
  // LLM-determined scope (passed downstream to avoid regex re-detection)
  scope?: {
    allCustomers: boolean; // True if LLM detected "all customers" scope
    hasTimeRange: boolean; // True if LLM detected time range
    timeRangeExplanation?: string; // e.g., "3 most recent meetings"
    customerScopeExplanation?: string; // e.g., "we've had implies all customers"
    meetingLimit?: number | null; // e.g., "3 most recent" → 3
  };
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
  timeRangeExplanation: string;
  customerScopeExplanation: string;
  meetingLimit?: number | null; // e.g., "3 most recent" → 3
}

/**
 * Use LLM to check if the question has sufficient specificity for aggregate queries.
 * This replaces brittle regex patterns with semantic understanding.
 */
async function checkAggregateSpecificity(question: string): Promise<SpecificityCheckResult> {
  try {
    const openai = new OpenAI();
    
    const response = await openai.chat.completions.create({
      model: MODEL_ASSIGNMENTS.AGGREGATE_SPECIFICITY_CHECK,
      messages: [
        { role: "system", content: AGGREGATE_SPECIFICITY_CHECK_PROMPT },
        { role: "user", content: question },
      ],
      temperature: 0,
      max_tokens: 200,
      response_format: { type: "json_object" },
    });
    
    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.log("[DecisionLayer] No content from specificity check, defaulting to needs clarification");
      return { hasTimeRange: false, hasCustomerScope: false, timeRangeExplanation: "", customerScopeExplanation: "", meetingLimit: null };
    }
    
    const result = JSON.parse(content) as SpecificityCheckResult;
    console.log(`[DecisionLayer] Specificity check: hasTimeRange=${result.hasTimeRange} (${result.timeRangeExplanation}), hasCustomerScope=${result.hasCustomerScope} (${result.customerScopeExplanation}), meetingLimit=${result.meetingLimit}`);
    return result;
  } catch (error) {
    console.error("[DecisionLayer] Specificity check failed, defaulting to needs clarification:", error);
    return { hasTimeRange: false, hasCustomerScope: false, timeRangeExplanation: "", customerScopeExplanation: "", meetingLimit: null };
  }
}

function generateAggregateClarifyMessage(hasTime: boolean, hasScope: boolean): string {
  if (!hasTime && !hasScope) {
    return `To give you the best analysis, could you clarify:

1. **Time range**: Last month, last quarter, or all time?
2. **Scope**: All customers, or a specific customer?

For example: "Show me customer concerns from the last quarter across all customers"`;
  }
  
  if (!hasTime) {
    return `What time range would you like me to analyze?

- Last month
- Last quarter  
- All time

For example: "...from the last quarter"`;
  }
  
  if (!hasScope) {
    return `Would you like me to look at:

- **All customers** - patterns across everyone
- **A specific customer** - just mention their name

For example: "...across all customers" or "...for Costco"`;
  }
  
  return "";
}

export async function runDecisionLayer(
  question: string,
  threadContext?: ThreadContext
): Promise<DecisionLayerResult> {
  const intentResult = await classifyIntent(question, threadContext);
  
  console.log(`[DecisionLayer] Intent: ${intentResult.intent} (${intentResult.intentDetectionMethod})`);
  
  const layersMeta = computeContextLayers(intentResult.intent);
  
  console.log(`[DecisionLayer] Context Layers: ${JSON.stringify(layersMeta.layers)}`);
  
  const contractResult = await selectAnswerContract(
    question,
    intentResult.intent,
    layersMeta.layers,
    intentResult.proposedInterpretation?.contract
  );
  
  console.log(`[DecisionLayer] Contract: ${contractResult.contract} (${contractResult.contractSelectionMethod})`);

  // For MULTI_MEETING intent, always run specificity check to get LLM-determined scope
  // This scope is passed downstream to avoid regex re-detection in meeting resolver
  let scopeInfo: DecisionLayerResult["scope"];
  
  if (intentResult.intent === Intent.MULTI_MEETING) {
    const specificity = await checkAggregateSpecificity(question);
    
    scopeInfo = {
      allCustomers: specificity.hasCustomerScope,
      hasTimeRange: specificity.hasTimeRange,
      timeRangeExplanation: specificity.timeRangeExplanation,
      customerScopeExplanation: specificity.customerScopeExplanation,
      meetingLimit: specificity.meetingLimit ?? null,
    };
    
    console.log(`[DecisionLayer] LLM scope detection: allCustomers=${scopeInfo.allCustomers} (${scopeInfo.customerScopeExplanation}), hasTimeRange=${scopeInfo.hasTimeRange} (${scopeInfo.timeRangeExplanation}), meetingLimit=${scopeInfo.meetingLimit}`);
    
    // For aggregate contracts, check if we need clarification
    if (AGGREGATE_CONTRACTS.includes(contractResult.contract)) {
      const clarifyMessage = generateAggregateClarifyMessage(specificity.hasTimeRange, specificity.hasCustomerScope);
      
      if (clarifyMessage) {
        console.log(`[DecisionLayer] Aggregate contract detected, requesting scope clarification`);
        return {
          intent: Intent.CLARIFY,
          intentDetectionMethod: "aggregate_scope_check",
          contextLayers: layersMeta.layers,
          answerContract: contractResult.contract,
          contractSelectionMethod: contractResult.contractSelectionMethod,
          clarifyMessage,
          proposedInterpretation: {
            intent: intentResult.intent.toString(),
            contract: contractResult.contract.toString(),
            summary: "Aggregate analysis - awaiting scope",
          },
          scope: scopeInfo,
        };
      }
    }
  }

  return {
    intent: intentResult.intent,
    intentDetectionMethod: intentResult.intentDetectionMethod,
    contextLayers: layersMeta.layers,
    answerContract: contractResult.contract,
    contractSelectionMethod: contractResult.contractSelectionMethod,
    clarifyMessage: intentResult.clarifyMessage,
    proposedInterpretation: intentResult.proposedInterpretation,
    scope: scopeInfo,
  };
}

// Backward compatibility alias
export const runControlPlane = runDecisionLayer;
