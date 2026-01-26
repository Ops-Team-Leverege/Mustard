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

export type ControlPlaneResult = {
  intent: Intent;
  intentDetectionMethod: string;
  contextLayers: ContextLayers;
  answerContract: AnswerContract;
  contractSelectionMethod: string;
};

export async function runControlPlane(question: string): Promise<ControlPlaneResult> {
  const intentResult = await classifyIntent(question);
  
  console.log(`[ControlPlane] Intent: ${intentResult.intent} (${intentResult.intentDetectionMethod})`);
  
  const layersMeta = computeContextLayers(intentResult.intent);
  
  console.log(`[ControlPlane] Context Layers: ${JSON.stringify(layersMeta.layers)}`);
  
  const contractResult = await selectAnswerContract(
    question,
    intentResult.intent,
    layersMeta.layers
  );
  
  console.log(`[ControlPlane] Contract: ${contractResult.contract} (${contractResult.contractSelectionMethod})`);

  return {
    intent: intentResult.intent,
    intentDetectionMethod: intentResult.intentDetectionMethod,
    contextLayers: layersMeta.layers,
    answerContract: contractResult.contract,
    contractSelectionMethod: contractResult.contractSelectionMethod,
  };
}
