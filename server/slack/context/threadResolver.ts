/**
 * Thread Resolver
 * 
 * Resolves thread context from prior interactions.
 * Enables natural follow-ups without conversation memory or hallucination risk.
 */

import { storage } from "../../storage";
import type { ThreadContext } from "../../mcp/context";

export interface ThreadResolutionResult {
  threadContext?: ThreadContext;
  awaitingClarification: string | null;
  companyNameFromContext: string | null;
  storedProposedInterpretation: { intent: string; contract: string; summary: string } | null;
  originalQuestion: string | null;
  lastResponseType: string | null;
  pendingOffer: string | null;
}

/**
 * Determines whether to reuse thread context from a prior interaction.
 * 
 * Returns FALSE (resolve fresh) if the user explicitly overrides context:
 * - References a different customer/company
 * - Mentions "different meeting", "another call", "last quarter", etc.
 * - Explicitly names a new entity
 */
export function shouldReuseThreadContext(messageText: string): boolean {
  // Short clarification answers (< 5 words) should always reuse context
  // These are typically answers like "last month", "all customers", "yes", "1", etc.
  const wordCount = messageText.trim().split(/\s+/).length;
  if (wordCount < 5) {
    return true;
  }

  // Only check override patterns for longer messages that might be new questions
  const overridePatterns = [
    /\b(different|another|other)\s+(meeting|call|customer|company)\b/i,
    // Only trigger on "what about last quarter" or "show me last month" - not bare "last month"
    /\b(what|show|tell|give|from|in)\s+(about\s+)?last\s+(quarter|month|year)\b/i,
    /\bwith\s+[A-Z][a-z]+\s+(about|regarding)\b/i, // "with CompanyName about..."
    /\bfor\s+[A-Z][a-z]+\b/i, // "for CompanyName"
    /\b(switch|change)\s+to\b/i,
  ];

  return !overridePatterns.some(pattern => pattern.test(messageText));
}

/**
 * Resolve thread context from prior interactions.
 * Only looks up context if this is a reply and context should be reused.
 */
export async function resolveThreadContext(
  threadTs: string,
  text: string,
  isReply: boolean
): Promise<ThreadResolutionResult> {
  const emptyResult: ThreadResolutionResult = {
    threadContext: undefined,
    awaitingClarification: null,
    companyNameFromContext: null,
    storedProposedInterpretation: null,
    originalQuestion: null,
    lastResponseType: null,
    pendingOffer: null,
  };

  if (!isReply) {
    console.log(`[ThreadResolver] Not a reply - returning empty context`);
    return emptyResult;
  }

  if (!shouldReuseThreadContext(text)) {
    console.log("[ThreadResolver] User explicitly overriding context - resolving fresh");
    return emptyResult;
  }

  try {
    const priorInteraction = await storage.getLastInteractionByThread(threadTs);
    if (!priorInteraction) {
      console.log(`[ThreadResolver] No prior interaction found for thread ${threadTs}`);
      return emptyResult;
    }

    // Use new schema fields directly, with fallback to resolution JSON
    const resolution = priorInteraction.resolution as Record<string, unknown> | null;
    const threadContext: ThreadContext = {
      meetingId: priorInteraction.meetingId || (resolution?.meeting_id as string | null) || null,
      companyId: priorInteraction.companyId || (resolution?.company_id as string | null) || null,
    };

    // Check awaiting clarification from resolution metadata
    const contextLayers = priorInteraction.contextLayers as Record<string, unknown> | null;
    const awaitingClarification = (contextLayers?.awaitingClarification as string) || null;
    const companyNameFromContext = (resolution?.company_name as string) || null;

    // Check for stored proposed interpretation (for "yes" or numbered responses)
    const storedProposedInterpretation = (contextLayers?.proposedInterpretation as { intent: string; contract: string; summary: string }) || null;
    const originalQuestion = priorInteraction.questionText || null;

    // Track what the last response was about (for follow-up context)
    const lastResponseType = (contextLayers?.lastResponseType as string) || null;

    // Surface pending offer from interaction metadata for follow-up handling
    // Refinement 4: Expire offers after 5 minutes to prevent stale state
    const OFFER_EXPIRY_MS = 5 * 60 * 1000;
    let pendingOfferValue = (resolution?.pendingOffer as string) || null;
    const offerTimestamp = (resolution?.offerTimestamp as number) || null;
    if (pendingOfferValue && offerTimestamp && (Date.now() - offerTimestamp > OFFER_EXPIRY_MS)) {
      console.log(`[ThreadResolver] Pending offer "${pendingOfferValue}" expired (age: ${Math.round((Date.now() - offerTimestamp) / 1000)}s)`);
      pendingOfferValue = null;
    }

    console.log(`[ThreadResolver] ✅ CONTEXT CHECKPOINT 1 - Thread Resolution:`);
    console.log(`  Thread: ${threadTs}`);
    console.log(`  Meeting: ${threadContext.meetingId || 'none'}`);
    console.log(`  Company: ${threadContext.companyId || 'none'} (${companyNameFromContext || 'no name'})`);
    console.log(`  Awaiting Clarification: ${awaitingClarification || 'none'}`);
    console.log(`  Proposed Interpretation: ${storedProposedInterpretation ? 'yes' : 'none'}`);
    console.log(`  Last Response Type: ${lastResponseType || 'none'}`);
    console.log(`  Pending Offer: ${pendingOfferValue || 'none'}`);

    return {
      threadContext,
      awaitingClarification,
      companyNameFromContext,
      storedProposedInterpretation,
      originalQuestion,
      lastResponseType,
      pendingOffer: pendingOfferValue,
    };
  } catch (err) {
    // Non-fatal - just proceed without context
    console.error("[ThreadResolver] Failed to lookup prior interaction:", err);
    return emptyResult;
  }
}
