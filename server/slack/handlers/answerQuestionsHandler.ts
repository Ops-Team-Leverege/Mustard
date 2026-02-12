/**
 * Answer Questions Handler
 * 
 * Handles follow-up requests to answer customer questions from a meeting.
 * Triggered when user says "answer those questions" after receiving customer questions.
 */

import { postSlackMessage } from "../slackApi";
import { logInteraction } from "../logInteraction";
import { buildInteractionMetadata } from "../interactionMetadata";
import { storage } from "../../storage";
import { runDecisionLayer } from "../../decisionLayer";
import { handleOpenAssistant } from "../../openAssistant";
import type { ThreadContext } from "../../mcp/context";

export interface AnswerQuestionsContext {
  channel: string;
  threadTs: string;
  messageTs: string;
  text: string;
  userId: string | null;
  testRun: boolean;
  threadContext: ThreadContext | null;
  lastResponseType: string | null;
  companyNameFromContext: string | null;
  clearProgressTimer: () => void;
}

export interface AnswerQuestionsResult {
  handled: boolean;
}

/**
 * Detects if the user wants to answer customer questions from a previous response.
 */
function wantsToAnswerQuestions(text: string): boolean {
  const lowerText = text.toLowerCase().trim();
  return /\b(answer|help\s*with|respond\s*to|draft|address)\b.{0,20}\b(those|these|the)\b.{0,10}\b(questions?)\b/i.test(lowerText) ||
         /\b(answer|help\s*with|respond\s*to)\s+(them|those|these)\b/i.test(lowerText);
}

/**
 * Handle "answer those questions" follow-up requests.
 * Routes to PRODUCT_KNOWLEDGE + DRAFT_RESPONSE to provide helpful answers.
 */
export async function handleAnswerQuestions(ctx: AnswerQuestionsContext): Promise<AnswerQuestionsResult> {
  const { channel, threadTs, messageTs, text, userId, testRun, threadContext, lastResponseType, companyNameFromContext, clearProgressTimer } = ctx;
  
  if ((lastResponseType !== "customer_questions" && lastResponseType !== "qa_pairs") || !threadContext?.meetingId || !threadContext?.companyId) {
    return { handled: false };
  }
  
  if (!wantsToAnswerQuestions(text)) {
    return { handled: false };
  }
  
  console.log(`[Slack] Detected "answer those questions" follow-up - routing to product knowledge + draft response`);
  
  let questionList: string | null = null;
  
  try {
    const qaPairs = await storage.getQAPairsByTranscriptId(threadContext.meetingId);
    
    if (qaPairs.length > 0) {
      questionList = qaPairs
        .map(q => `• ${q.question}${q.asker ? ` (asked by ${q.asker})` : ''}${q.answer ? `\n  Answer from meeting: ${q.answer}` : ''}`)
        .join('\n');
    }
  } catch (error) {
    console.error('[Slack] Error fetching Q&A pairs:', error);
  }
  
  if (!questionList) {
    const noQuestionsResponse = "I don't see any customer questions from this meeting. There might not be any recorded questions.";
    if (!testRun) {
      await postSlackMessage({
        channel,
        text: noQuestionsResponse,
        thread_ts: threadTs,
      });
    }
    clearProgressTimer();
    return { handled: true };
  }
  
  const enhancedQuestion = `Using PitCrew product knowledge, help draft responses to these customer questions from the meeting with ${companyNameFromContext || 'this company'}:\n\n${questionList}`;
  
  const decisionLayerResult = await runDecisionLayer(enhancedQuestion);
  
  const openAssistantResult = await handleOpenAssistant(enhancedQuestion, {
    userId: userId || undefined,
    threadId: threadTs,
    resolvedMeeting: {
      meetingId: threadContext.meetingId,
      companyId: threadContext.companyId,
      companyName: companyNameFromContext || 'Unknown',
      meetingDate: null,
    },
    decisionLayerResult,
  });
  
  if (!testRun) {
    await postSlackMessage({
      channel,
      text: openAssistantResult.answer,
      thread_ts: threadTs,
    });
  }
  
  logInteraction({
    slackChannelId: channel,
    slackThreadId: threadTs,
    slackMessageTs: messageTs,
    userId: userId || null,
    companyId: threadContext.companyId,
    meetingId: threadContext.meetingId,
    questionText: text,
    answerText: openAssistantResult.answer,
    metadata: buildInteractionMetadata(
      { companyId: threadContext.companyId, companyName: companyNameFromContext || undefined, meetingId: threadContext.meetingId },
      {
        entryPoint: "slack",
        legacyIntent: "content",
        answerShape: "summary",
        dataSource: "product_ssot",
        llmPurposes: ["general_assistance"],
        companySource: "thread",
        meetingSource: "thread",
        testRun,
      }
    ),
    testRun,
  });
  
  clearProgressTimer();
  return { handled: true };
}
