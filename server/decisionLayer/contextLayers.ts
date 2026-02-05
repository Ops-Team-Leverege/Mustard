/**
 * Context Layers System
 * 
 * Purpose:
 * Context Layers represent what information the model is allowed to see.
 * They are computed after intent resolution and before answer contract selection.
 * 
 * Key Principle:
 * - product_identity is ALWAYS ON (establishes PitCrew context)
 * - All other layers are intent-gated (no implicit inclusion)
 * 
 * Layer: Decision Layer (Context Layer Computation)
 */

import { Intent } from "./intent";

export type ContextLayers = {
  product_identity: boolean;
  product_ssot: boolean;
  single_meeting: boolean;
  multi_meeting: boolean;
  document_context: boolean;
  slack_search: boolean;
};

export type ContextLayerMetadata = {
  layers: ContextLayers;
  reason: string;
  intent: Intent;
};

// ============================================================================
// SCOPE TYPES
// Scope represents what data the execution plane is allowed to access.
// MULTI_MEETING and SINGLE_MEETING use identical structure, only scope size differs.
// ============================================================================

export type SingleMeetingScope = {
  type: "single_meeting";
  meetingId: string;
  companyId?: string;
  companyName?: string;
};

export type MultiMeetingScope = {
  type: "multi_meeting";
  meetingIds: string[];
  filters?: {
    company?: string;
    topic?: string;
    timeRange?: {
      start?: Date;
      end?: Date;
    };
  };
};

export type MeetingScope = SingleMeetingScope | MultiMeetingScope;

export const PRODUCT_IDENTITY_CONTEXT = {
  name: "PitCrew",
  company: "Leverege",
  description: "This assistant operates in the context of PitCrew, a product developed by Leverege.",
};

export function computeContextLayers(intent: Intent): ContextLayerMetadata {
  const layers: ContextLayers = {
    product_identity: true,
    product_ssot: false,
    single_meeting: false,
    multi_meeting: false,
    document_context: false,
    slack_search: false,
  };

  let reason = "product_identity always enabled. ";

  switch (intent) {
    case Intent.SINGLE_MEETING:
      layers.single_meeting = true;
      reason += "single_meeting enabled for SINGLE_MEETING intent.";
      break;

    case Intent.MULTI_MEETING:
      layers.multi_meeting = true;
      reason += "multi_meeting enabled for MULTI_MEETING intent.";
      break;

    case Intent.PRODUCT_KNOWLEDGE:
      layers.product_ssot = true;
      reason += "product_ssot enabled for PRODUCT_KNOWLEDGE intent.";
      break;

    case Intent.DOCUMENT_SEARCH:
      layers.document_context = true;
      reason += "document_context enabled for DOCUMENT_SEARCH intent.";
      break;

    case Intent.EXTERNAL_RESEARCH:
      // External research can chain with product knowledge
      layers.product_ssot = true;
      reason += "product_ssot enabled for EXTERNAL_RESEARCH (for value prop chaining).";
      break;

    case Intent.SLACK_SEARCH:
      layers.slack_search = true;
      reason += "slack_search enabled for SLACK_SEARCH intent.";
      break;

    case Intent.GENERAL_HELP:
      reason += "No additional layers for GENERAL_HELP intent.";
      break;
  }

  return {
    layers,
    reason,
    intent,
  };
}

export function canAccessProductSSOT(layers: ContextLayers): boolean {
  return layers.product_ssot;
}

export function canAccessSingleMeeting(layers: ContextLayers): boolean {
  return layers.single_meeting;
}

export function canAccessMultiMeeting(layers: ContextLayers): boolean {
  return layers.multi_meeting;
}

export function canAccessDocuments(layers: ContextLayers): boolean {
  return layers.document_context;
}

export function getEnabledLayerNames(layers: ContextLayers): string[] {
  const enabled: string[] = [];
  if (layers.product_identity) enabled.push("product_identity");
  if (layers.product_ssot) enabled.push("product_ssot");
  if (layers.single_meeting) enabled.push("single_meeting");
  if (layers.multi_meeting) enabled.push("multi_meeting");
  if (layers.document_context) enabled.push("document_context");
  if (layers.slack_search) enabled.push("slack_search");
  return enabled;
}
