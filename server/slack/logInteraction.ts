/**
 * Interaction Logging Helper
 * 
 * Bridges the old metadata format with the new interaction_logs schema.
 * Handles intent-based logging for the Decision Layer.
 */

import { storage } from "../storage";
import type { InteractionLog } from "@shared/schema";
import type { InteractionMetadata } from "./interactionMetadata";

export type LogInteractionParams = {
  slackChannelId: string;
  slackThreadId: string | null;
  slackMessageTs: string;
  userId: string | null;
  companyId: string | null;
  meetingId: string | null;
  questionText: string;
  answerText: string;
  metadata: InteractionMetadata;
  testRun?: boolean;
  capabilityName?: string;
  totalTimeMs?: number;
  progressMessageCount?: number;
};

export async function logInteraction(params: LogInteractionParams): Promise<void> {
  try {
    // Derive capability name from metadata or use provided value
    const capabilityName = params.capabilityName || 
      deriveCapabilityName(params.metadata);
    
    // Merge timing data into context layers
    const contextLayersWithTiming = {
      ...params.metadata.context_layers,
      total_time_ms: params.totalTimeMs,
      progress_message_count: params.progressMessageCount,
    };
    
    await storage.insertInteractionLog({
      entryPoint: params.metadata.entry_point,
      testRun: params.testRun || params.metadata.test_run || false,
      
      slackChannelId: params.slackChannelId,
      slackThreadId: params.slackThreadId,
      slackMessageTs: params.slackMessageTs,
      
      userId: params.userId,
      companyId: params.companyId,
      meetingId: params.meetingId,
      
      questionText: params.questionText,
      answerText: params.answerText,
      
      capabilityName,
      
      intent: String(params.metadata.intent),
      intentDetectionMethod: params.metadata.intent_detection_method,
      
      answerContract: String(params.metadata.answer_contract),
      contractSelectionMethod: params.metadata.contract_selection_method,
      
      contextLayers: contextLayersWithTiming,
      resolution: params.metadata.resolution,
      evidenceSources: params.metadata.evidence_sources || null,
      llmUsage: params.metadata.llm_usage,
    });
  } catch (err) {
    console.error("[logInteraction] Failed to log interaction:", err);
  }
}

/**
 * Derive a capability name from metadata for logging purposes.
 */
function deriveCapabilityName(metadata: InteractionMetadata): string {
  // Use answer_contract if available
  if (metadata.answer_contract) {
    return String(metadata.answer_contract);
  }
  // Fall back to intent
  if (metadata.intent) {
    return String(metadata.intent);
  }
  // Default
  return "unknown";
}

export function mapLegacyDataSource(dataSource: string): "meeting_artifacts" | "semantic" | "product_ssot" | "not_found" | "external" {
  switch (dataSource) {
    case "tier1":
    case "action_items":
    case "attendees":
    case "customer_questions":
    case "meeting_artifacts":
      return "meeting_artifacts";
    case "semantic":
      return "semantic";
    case "external":
    case "external_research":
    case "general_knowledge":
    case "hybrid":
      return "external";
    case "product_ssot":
      return "product_ssot";
    default:
      return "not_found";
  }
}

export function mapLegacyArtifactType(dataSource: string): "action_items" | "attendees" | "customer_questions" | null {
  switch (dataSource) {
    case "action_items":
      return "action_items";
    case "attendees":
      return "attendees";
    case "customer_questions":
      return "customer_questions";
    default:
      return null;
  }
}
