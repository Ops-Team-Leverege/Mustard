/**
 * Control Plane
 * 
 * Purpose:
 * Central export for the Intent → Context Layers → Answer Contract architecture.
 * 
 * Flow:
 * 1. Classify Intent (keyword fast-path + LLM fallback)
 * 2. Compute Context Layers (intent-gated)
 * 3. Select Answer Contract (after layers determined)
 * 
 * Layer: Control Plane (orchestration)
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

export type ControlPlaneResult = {
  intent: Intent;
  intentDetectionMethod: string;
  contextLayers: ContextLayers;
  answerContract: AnswerContract;
  contractSelectionMethod: string;
  clarifyMessage?: string; // Smart clarification message when intent is CLARIFY
  proposedInterpretation?: ProposedInterpretation; // For CLARIFY: what the LLM thinks user wants
};

// Aggregate contracts that require scope clarification
const AGGREGATE_CONTRACTS = [
  AnswerContract.CROSS_MEETING_QUESTIONS,
  AnswerContract.PATTERN_ANALYSIS,
  AnswerContract.TREND_SUMMARY,
];

// Patterns that indicate time range is specified
const TIME_RANGE_PATTERNS = [
  /\b(last|past)\s+(week|month|quarter|year|\d+\s*days?)\b/i,
  /\b(this|current)\s+(week|month|quarter|year)\b/i,
  /\b(since|from|after|before)\s+\w+/i,
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  /\b(q[1-4]|20[0-9]{2})\b/i,
  /\b(all\s+time|ever|always)\b/i,
  /\b(recent|recently)\b/i,
];

// Patterns that indicate customer scope is specified
const CUSTOMER_SCOPE_PATTERNS = [
  /\b(all\s+customers?|every\s+customer|across\s+all)\b/i,
  /\bfor\s+[A-Z][a-z]+/i, // "for Costco", "for Amazon"
  /\b(specific|particular)\s+customer/i,
];

function hasTimeRange(question: string): boolean {
  return TIME_RANGE_PATTERNS.some(p => p.test(question));
}

function hasCustomerScope(question: string): boolean {
  return CUSTOMER_SCOPE_PATTERNS.some(p => p.test(question));
}

function generateAggregateClarifyMessage(question: string, contract: AnswerContract): string {
  const hasTime = hasTimeRange(question);
  const hasScope = hasCustomerScope(question);
  
  if (!hasTime && !hasScope) {
    return `Great question! To give you the best analysis, could you clarify:

1. **Time range**: Last month, last quarter, or all time?
2. **Scope**: All customers, or a specific customer?

For example: "Show me customer concerns from the last quarter across all customers"`;
  }
  
  if (!hasTime) {
    return `I can help with that! What time range would you like me to analyze?

- Last month
- Last quarter  
- All time

For example: "...from the last quarter"`;
  }
  
  if (!hasScope) {
    return `Got it! Would you like me to look at:

- **All customers** - patterns across everyone
- **A specific customer** - just mention their name

For example: "...across all customers" or "...for Costco"`;
  }
  
  return "";
}

export async function runControlPlane(
  question: string,
  threadContext?: ThreadContext
): Promise<ControlPlaneResult> {
  const intentResult = await classifyIntent(question, threadContext);
  
  console.log(`[ControlPlane] Intent: ${intentResult.intent} (${intentResult.intentDetectionMethod})`);
  
  const layersMeta = computeContextLayers(intentResult.intent);
  
  console.log(`[ControlPlane] Context Layers: ${JSON.stringify(layersMeta.layers)}`);
  
  const contractResult = await selectAnswerContract(
    question,
    intentResult.intent,
    layersMeta.layers
  );
  
  console.log(`[ControlPlane] Contract: ${contractResult.contract} (${contractResult.contractSelectionMethod})`);

  // Check if this is an aggregate contract that needs scope clarification
  if (AGGREGATE_CONTRACTS.includes(contractResult.contract)) {
    const clarifyMessage = generateAggregateClarifyMessage(question, contractResult.contract);
    
    if (clarifyMessage) {
      console.log(`[ControlPlane] Aggregate contract detected, requesting scope clarification`);
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
      };
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
  };
}
