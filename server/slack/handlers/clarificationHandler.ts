/**
 * Clarification Handler
 * 
 * Handles follow-up responses to clarification requests:
 * 1. "next_steps_or_summary" - User selects next steps or summary
 * 2. "proposed_interpretation" - User confirms with "yes", "1", etc.
 * 3. "slack_search" - User accepts offer to search Slack after a meeting-based response
 */

import { postSlackMessage } from "../slackApi";
import { handleSingleMeetingQuestion, type SingleMeetingContext } from "../../openAssistant/singleMeetingOrchestrator";
import { handleOpenAssistant } from "../../openAssistant";
import { logInteraction, mapLegacyDataSource } from "../logInteraction";
import { buildInteractionMetadata, type LegacyIntent, type ClarificationResolution } from "../interactionMetadata";
import { storage } from "../../storage";
import type { ThreadContext } from "../../mcp/context";
import { AnswerContract } from "../../decisionLayer/answerContracts";
import { Intent } from "../../decisionLayer/intent";

export interface ClarificationContext {
  channel: string;
  threadTs: string;
  messageTs: string;
  text: string;
  userId: string | null;
  testRun: boolean;
  threadContext?: ThreadContext;
  awaitingClarification: string | null;
  companyNameFromContext: string | null;
  storedProposedInterpretation: { intent: string; contract: string; summary: string } | null;
  originalQuestion: string | null;
  pendingOffer: string | null;
}

export interface ClarificationResult {
  handled: boolean;
  responseType?: 'next_steps' | 'summary' | 'confirmed' | 'slack_search';
  meetingId?: string | null;
}

/**
 * Handle "next steps" or "summary" response to clarification.
 */
export async function handleNextStepsOrSummaryResponse(
  ctx: ClarificationContext
): Promise<ClarificationResult> {
  if (ctx.awaitingClarification !== "next_steps_or_summary" || !ctx.threadContext?.companyId) {
    return { handled: false };
  }
  
  const lowerText = ctx.text.toLowerCase().trim();
  const isNextStepsResponse = /\b(next\s*steps?|action\s*items?|follow[- ]?ups?|commitments?)\b/i.test(lowerText);
  const isSummaryResponse = /\b(summary|summarize|overview|brief)\b/i.test(lowerText);
  
  if (!isNextStepsResponse && !isSummaryResponse) {
    return { handled: false };
  }
  
  console.log(`[Slack] Clarification response detected: ${isNextStepsResponse ? 'next_steps' : 'summary'}`);
  
  // Get the last meeting for this company (fast DB query, no LLM)
  const lastMeetingRows = await storage.rawQuery(`
    SELECT t.id, t.meeting_date, c.name as company_name
    FROM transcripts t
    JOIN companies c ON t.company_id = c.id
    WHERE t.company_id = $1
    ORDER BY COALESCE(t.meeting_date, t.created_at) DESC
    LIMIT 1
  `, [ctx.threadContext.companyId]);
  
  if (!lastMeetingRows || lastMeetingRows.length === 0) {
    return { handled: false };
  }
  
  const meeting = lastMeetingRows[0];
  const meetingId = meeting.id as string;
  const companyName = (meeting.company_name as string) || ctx.companyNameFromContext || "Unknown";
  const meetingDate = meeting.meeting_date ? new Date(meeting.meeting_date as string) : null;
  
  const singleMeetingContext: SingleMeetingContext = {
    meetingId,
    companyId: ctx.threadContext.companyId,
    companyName,
    meetingDate,
  };
  
  // Route directly to single-meeting orchestrator with explicit contract (enforces Decision Layer authority)
  const result = await handleSingleMeetingQuestion(
    singleMeetingContext,
    isNextStepsResponse ? "What are the next steps?" : "Give me a brief summary",
    false,
    isNextStepsResponse ? AnswerContract.NEXT_STEPS : AnswerContract.MEETING_SUMMARY
  );
  
  if (!ctx.testRun) {
    await postSlackMessage({
      channel: ctx.channel,
      text: result.answer,
      thread_ts: ctx.threadTs,
    });
  }
  
  // Log interaction with structured metadata
  const responseType = isNextStepsResponse ? 'next_steps' : 'summary';
  logInteraction({
    slackChannelId: ctx.channel,
    slackThreadId: ctx.threadTs,
    slackMessageTs: ctx.messageTs,
    userId: ctx.userId,
    companyId: ctx.threadContext.companyId,
    meetingId,
    questionText: ctx.text,
    answerText: result.answer,
    metadata: buildInteractionMetadata(
      { companyId: ctx.threadContext.companyId, meetingId },
      {
        entryPoint: "slack",
        legacyIntent: isNextStepsResponse ? "next_steps" : "summary",
        answerShape: isNextStepsResponse ? "list" : "summary",
        dataSource: mapLegacyDataSource(result.dataSource),
        artifactType: isNextStepsResponse ? "action_items" : null,
        llmPurposes: isNextStepsResponse ? [] : ["summary"],
        companySource: "thread",
        meetingSource: "last_meeting",
        clarificationState: {
          awaiting: false,
          resolvedWith: responseType as ClarificationResolution,
        },
        testRun: ctx.testRun,
      }
    ),
    testRun: ctx.testRun,
  });
  
  return {
    handled: true,
    responseType,
    meetingId,
  };
}

/**
 * Handle confirmation response ("yes", "1", etc.) to proposed interpretation.
 */
export async function handleProposedInterpretationConfirmation(
  ctx: ClarificationContext
): Promise<ClarificationResult> {
  if (!ctx.storedProposedInterpretation || !ctx.originalQuestion) {
    return { handled: false };
  }
  
  const interpretation = ctx.storedProposedInterpretation;
  const proposedIntent = interpretation.intent;
  const proposedContract = interpretation.contract;
  const lowerText = ctx.text.toLowerCase().trim();
  
  // Detect confirmation patterns: "yes", "1", "first one", "that", "go ahead", etc.
  const isConfirmation = /^(yes|yeah|yep|yup|ok|okay|sure|1|first|that|go\s*ahead|do\s*it|please)$/i.test(lowerText) ||
                        /^(sounds?\s*good|let'?s?\s*do\s*(it|that)|proceed)$/i.test(lowerText);
  
  if (!isConfirmation) {
    return { handled: false };
  }
  
  console.log(`[Slack] Clarification confirmed - using proposed interpretation: intent=${proposedIntent}, contract=${proposedContract}`);
  
  // Map intent string to Intent enum
  const intentMap: Record<string, Intent> = {
    "SINGLE_MEETING": Intent.SINGLE_MEETING,
    "MULTI_MEETING": Intent.MULTI_MEETING, 
    "PRODUCT_KNOWLEDGE": Intent.PRODUCT_KNOWLEDGE,
    "EXTERNAL_RESEARCH": Intent.EXTERNAL_RESEARCH,
    "GENERAL_HELP": Intent.GENERAL_HELP,
  };
  
  const mappedIntent: Intent = intentMap[proposedIntent] ?? Intent.GENERAL_HELP;
  
  // Map contract string to AnswerContract enum
  const mappedContract: AnswerContract = (proposedContract in AnswerContract) 
    ? AnswerContract[proposedContract as keyof typeof AnswerContract] 
    : AnswerContract.GENERAL_RESPONSE;
  
  // Create synthetic Decision Layer result with the stored interpretation
  const syntheticDecisionLayer = {
    intent: mappedIntent,
    answerContract: mappedContract,
    intentDetectionMethod: "clarification_followup" as const,
    contractSelectionMethod: "clarification_followup" as const,
    contextLayers: {
      product_identity: true,
      product_ssot: false,
      single_meeting: mappedIntent === Intent.SINGLE_MEETING,
      multi_meeting: mappedIntent === Intent.MULTI_MEETING,
      slack_search: false,
    },
  };
  
  // Route to Open Assistant with the original question and confirmed interpretation
  const openAssistantResult = await handleOpenAssistant(ctx.originalQuestion, {
    userId: ctx.userId || undefined,
    threadId: ctx.threadTs,
    resolvedMeeting: ctx.threadContext?.meetingId ? {
      meetingId: ctx.threadContext.meetingId,
      companyId: ctx.threadContext.companyId || '',
      companyName: ctx.companyNameFromContext || 'Unknown',
      meetingDate: null,
    } : null,
    decisionLayerResult: syntheticDecisionLayer,
  });
  
  if (!ctx.testRun) {
    await postSlackMessage({
      channel: ctx.channel,
      text: openAssistantResult.answer,
      thread_ts: ctx.threadTs,
    });
  }
  
  // Log interaction
  logInteraction({
    slackChannelId: ctx.channel,
    slackThreadId: ctx.threadTs,
    slackMessageTs: ctx.messageTs,
    userId: ctx.userId,
    companyId: ctx.threadContext?.companyId || null,
    meetingId: ctx.threadContext?.meetingId || null,
    questionText: ctx.originalQuestion,
    answerText: openAssistantResult.answer,
    metadata: buildInteractionMetadata(
      { companyId: ctx.threadContext?.companyId || undefined, meetingId: ctx.threadContext?.meetingId },
      {
        entryPoint: "slack",
        legacyIntent: proposedIntent.toLowerCase() as LegacyIntent,
        answerShape: "summary",
        dataSource: mapLegacyDataSource(openAssistantResult.dataSource),
        clarificationState: {
          awaiting: false,
          resolvedWith: "confirmed" as ClarificationResolution,
        },
        testRun: ctx.testRun,
      }
    ),
    testRun: ctx.testRun,
  });
  
  return {
    handled: true,
    responseType: 'confirmed',
    meetingId: ctx.threadContext?.meetingId,
  };
}

/**
 * Handle affirmative response to a Slack search offer.
 * When the bot offered "I can also check Slack..." and the user says yes.
 * Routes through OpenAssistant with a synthetic Decision Layer result to
 * maintain the Decision Layer as sole authority for intent/contract selection.
 */
export async function handleSlackSearchOfferResponse(
  ctx: ClarificationContext
): Promise<ClarificationResult> {
  if (ctx.pendingOffer !== "slack_search") {
    return { handled: false };
  }

  const lowerText = ctx.text.toLowerCase().trim();

  const isAffirmative = /^(yes|yeah|yep|yup|ok|okay|sure|1|please|do\s*it|go\s*ahead)$/i.test(lowerText) ||
                        /^(sounds?\s*good|let'?s?\s*do\s*(it|that)|proceed|check\s*(it|slack)|search\s*slack)$/i.test(lowerText);

  if (!isAffirmative) {
    return { handled: false };
  }

  const searchQuestion = ctx.originalQuestion || ctx.text;
  console.log(`[Slack] Slack search offer accepted - searching for: "${searchQuestion.substring(0, 100)}..."`);

  try {
    const syntheticDecisionLayer = {
      intent: Intent.SLACK_SEARCH,
      answerContract: AnswerContract.SLACK_MESSAGE_SEARCH,
      intentDetectionMethod: "pattern" as const,
      contractSelectionMethod: "default" as const,
      contextLayers: {
        product_identity: true,
        product_ssot: false,
        single_meeting: false,
        multi_meeting: false,
        slack_search: true,
      },
      extractedCompany: ctx.companyNameFromContext || undefined,
    };

    const result = await handleOpenAssistant(searchQuestion, {
      userId: ctx.userId || undefined,
      threadId: ctx.threadTs,
      conversationContext: ctx.companyNameFromContext ? `Company: ${ctx.companyNameFromContext}` : undefined,
      decisionLayerResult: syntheticDecisionLayer,
    });

    if (!ctx.testRun) {
      await postSlackMessage({
        channel: ctx.channel,
        text: result.answer,
        thread_ts: ctx.threadTs,
      });
    }

    logInteraction({
      slackChannelId: ctx.channel,
      slackThreadId: ctx.threadTs,
      slackMessageTs: ctx.messageTs,
      userId: ctx.userId,
      companyId: ctx.threadContext?.companyId || null,
      meetingId: ctx.threadContext?.meetingId || null,
      questionText: searchQuestion,
      answerText: result.answer,
      metadata: buildInteractionMetadata(
        { companyId: ctx.threadContext?.companyId || undefined, meetingId: ctx.threadContext?.meetingId },
        {
          entryPoint: "slack",
          decisionLayer: {
            intent: Intent.SLACK_SEARCH,
            intentDetectionMethod: "pattern",
            contextLayers: syntheticDecisionLayer.contextLayers,
            answerContract: AnswerContract.SLACK_MESSAGE_SEARCH,
            contractSelectionMethod: "default",
          },
          answerShape: "summary",
          dataSource: mapLegacyDataSource(result.dataSource),
          clarificationState: {
            awaiting: false,
            resolvedWith: "confirmed" as ClarificationResolution,
          },
          testRun: ctx.testRun,
        }
      ),
      testRun: ctx.testRun,
    });

    return {
      handled: true,
      responseType: 'slack_search',
      meetingId: ctx.threadContext?.meetingId,
    };
  } catch (err) {
    console.error(`[Slack] Failed to execute Slack search from offer:`, err);

    const errorMessage = "I wasn't able to search Slack right now. You can try asking me directly with something like \"search Slack for [topic]\".";

    if (!ctx.testRun) {
      await postSlackMessage({
        channel: ctx.channel,
        text: errorMessage,
        thread_ts: ctx.threadTs,
      });
    }

    return {
      handled: true,
      responseType: 'slack_search',
    };
  }
}
