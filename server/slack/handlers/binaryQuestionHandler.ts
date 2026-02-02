/**
 * Binary Question Handler
 * 
 * Fast path for existence checks like:
 * "Is there a meeting with Walmart?"
 * Returns "Yes, on [date]. Want details?" instead of a full summary.
 */

import { postSlackMessage } from "../slackApi";
import { isBinaryQuestion } from "../../openAssistant/singleMeetingOrchestrator";
import { extractCompanyFromMessage } from "../meetingResolver";
import { logInteraction } from "../logInteraction";
import { buildInteractionMetadata, type DataSource } from "../interactionMetadata";
import { storage } from "../../storage";

export interface BinaryQuestionContext {
  channel: string;
  threadTs: string;
  messageTs: string;
  text: string;
  userId: string | null;
  testRun: boolean;
}

export interface BinaryQuestionResult {
  handled: boolean;
  meetingId?: string | null;
  companyId?: string | null;
  companyName?: string | null;
}

/**
 * Check if this is a binary existence question and handle it with a fast DB query.
 * Returns { handled: true } if we answered the question.
 */
export async function handleBinaryQuestion(
  ctx: BinaryQuestionContext
): Promise<BinaryQuestionResult> {
  if (!isBinaryQuestion(ctx.text)) {
    return { handled: false };
  }
  
  // Check if it's an existence question about a company meeting
  const existenceMatch = ctx.text.match(
    /\b(?:is|are|was|were|do|does|did)\s+(?:there|we|they)\s+(?:a|any)\s+(?:meeting|call|transcript)s?\s+(?:with|for|about)\s+(.+?)(?:\?|$)/i
  );
  
  if (!existenceMatch) {
    return { handled: false };
  }
  
  const searchTerm = existenceMatch[1].trim().replace(/[?.,!]$/, '');
  console.log(`[Slack] Binary existence question detected for: "${searchTerm}"`);
  
  // Try to find the company
  const companyContext = await extractCompanyFromMessage(ctx.text);
  
  if (!companyContext) {
    return { handled: false };
  }
  
  // Fast DB query to check for meetings
  const meetingRows = await storage.rawQuery(`
    SELECT t.id, t.meeting_date, c.name as company_name
    FROM transcripts t
    JOIN companies c ON t.company_id = c.id
    WHERE t.company_id = $1
    ORDER BY COALESCE(t.meeting_date, t.created_at) DESC
    LIMIT 1
  `, [companyContext.companyId]);
  
  let response: string;
  let meetingId: string | null = null;
  
  if (meetingRows && meetingRows.length > 0) {
    const meeting = meetingRows[0];
    meetingId = meeting.id as string;
    const meetingDate = meeting.meeting_date 
      ? new Date(meeting.meeting_date as string).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "recently";
    
    response = `Yes, we have a meeting with ${companyContext.companyName} from ${meetingDate}. Would you like a summary or the action items?`;
  } else {
    response = `I don't see any meetings with ${companyContext.companyName} in our records.`;
  }
  
  if (!ctx.testRun) {
    await postSlackMessage({
      channel: ctx.channel,
      text: response,
      thread_ts: ctx.threadTs,
    });
  }
  
  // Log interaction
  logInteraction({
    slackChannelId: ctx.channel,
    slackThreadId: ctx.threadTs,
    slackMessageTs: ctx.messageTs,
    userId: ctx.userId,
    companyId: companyContext.companyId,
    meetingId,
    questionText: ctx.text,
    answerText: response,
    metadata: buildInteractionMetadata(
      { companyId: companyContext.companyId, companyName: companyContext.companyName, meetingId },
      {
        entryPoint: "slack",
        legacyIntent: "binary",
        answerShape: "yes_no",
        dataSource: (meetingId ? "transcript" : "not_found") as DataSource,
        llmPurposes: [],
        companySource: "extracted",
        meetingSource: meetingId ? "last_meeting" : "none",
        isBinaryQuestion: true,
        clarificationState: meetingId ? {
          awaiting: true,
          resolvedWith: null,
        } : undefined,
        awaitingClarification: meetingId ? "takeaways_or_next_steps" : undefined,
        testRun: ctx.testRun,
      }
    ),
    testRun: ctx.testRun,
  });
  
  return {
    handled: true,
    meetingId,
    companyId: companyContext.companyId,
    companyName: companyContext.companyName,
  };
}
