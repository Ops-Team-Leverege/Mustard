/**
 * Ambiguity Handler
 * 
 * Handles early ambiguity detection for preparation/briefing questions.
 * "I'm preparing for our meeting with X - what should I cover?"
 * These questions are inherently ambiguous and need clarification.
 */

import { postSlackMessage } from "../slackApi";
import { detectAmbiguity } from "../../openAssistant/singleMeetingOrchestrator";
import { extractCompanyFromMessage } from "../meetingResolver";
import { logInteraction } from "../logInteraction";
import { buildInteractionMetadata } from "../interactionMetadata";

export interface AmbiguityHandlerContext {
  channel: string;
  threadTs: string;
  messageTs: string;
  text: string;
  userId: string | null;
  testRun: boolean;
}

export interface AmbiguityHandlerResult {
  handled: boolean;
  clarificationAsked: boolean;
  companyId?: string | null;
  companyName?: string | null;
}

/**
 * Check for ambiguous preparation questions BEFORE any routing.
 * Returns { handled: true } if clarification was requested.
 */
export async function handleAmbiguity(
  ctx: AmbiguityHandlerContext
): Promise<AmbiguityHandlerResult> {
  const ambiguityCheck = detectAmbiguity(ctx.text);
  
  if (!ambiguityCheck.isAmbiguous || !ambiguityCheck.clarificationPrompt) {
    return { handled: false, clarificationAsked: false };
  }
  
  console.log(`[Slack] Early ambiguity detected - asking for clarification`);
  
  // Extract company from original question so thread context works for follow-up
  const companyContext = await extractCompanyFromMessage(ctx.text);
  console.log(`[Slack] Extracted company from preparation question: ${companyContext?.companyName || 'none'}`);
  
  if (!ctx.testRun) {
    await postSlackMessage({
      channel: ctx.channel,
      text: ambiguityCheck.clarificationPrompt,
      thread_ts: ctx.threadTs,
    });
  }
  
  // Log interaction for clarification - include company so thread context works
  logInteraction({
    slackChannelId: ctx.channel,
    slackThreadId: ctx.threadTs,
    slackMessageTs: ctx.messageTs,
    userId: ctx.userId,
    companyId: companyContext?.companyId || null,
    meetingId: null,
    questionText: ctx.text,
    answerText: ambiguityCheck.clarificationPrompt,
    metadata: buildInteractionMetadata(
      { companyId: companyContext?.companyId, companyName: companyContext?.companyName },
      {
        entryPoint: "slack",
        legacyIntent: "prep",
        answerShape: "none",
        dataSource: "not_found",
        llmPurposes: [],
        companySource: companyContext ? "extracted" : "none",
        meetingSource: "none",
        ambiguity: {
          detected: true,
          clarificationAsked: true,
          type: "next_steps_or_summary",
        },
        clarificationState: {
          awaiting: true,
          resolvedWith: null,
        },
        awaitingClarification: "next_steps_or_summary",
        testRun: ctx.testRun,
      }
    ),
    testRun: ctx.testRun,
  });
  
  return {
    handled: true,
    clarificationAsked: true,
    companyId: companyContext?.companyId,
    companyName: companyContext?.companyName,
  };
}
