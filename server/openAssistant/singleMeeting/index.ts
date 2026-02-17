/**
 * Single Meeting Module
 * 
 * Executes Decision Layer contracts against single meeting data.
 * The Decision Layer is the sole authority for contract selection.
 * This module executes contracts deterministically.
 */

import { AnswerContract } from "../../decisionLayer/answerContracts";
import { type SingleMeetingContext, type SingleMeetingResult } from "../../meeting";
import { UNCERTAINTY_RESPONSE } from "./helpers";
import {
  handleExtractiveIntent,
  handleAggregativeIntent,
  handleSummaryIntent,
  handleDraftingIntent,
} from "./handlers";
import { semanticAnswerSingleMeeting } from "../../slack/semanticAnswerSingleMeeting";

export { type SingleMeetingContext, type SingleMeetingResult } from "../../meeting";

/**
 * Execute a single meeting contract.
 * 
 * Routes directly on Decision Layer contracts — no pre-checks or reclassification.
 * The Decision Layer is the sole authority for contract selection.
 */
export async function executeSingleMeetingContract(
  ctx: SingleMeetingContext,
  question: string,
  contract: AnswerContract,
  requiresSemantic?: boolean
): Promise<SingleMeetingResult> {
  console.log(`[SingleMeeting] Executing contract=${contract} for meeting ${ctx.meetingId}`);
  console.log(`[SingleMeeting] Question: "${question.substring(0, 100)}..."`);

  const isSemantic = requiresSemantic ?? true;

  switch (contract) {
    case AnswerContract.EXTRACTIVE_FACT:
    case AnswerContract.ATTENDEES:
    case AnswerContract.CUSTOMER_QUESTIONS:
    case AnswerContract.NEXT_STEPS: {
      const result = await handleExtractiveIntent(ctx, question, contract);

      let semanticError: string | undefined;

      const artifactCompleteContracts = [
        AnswerContract.NEXT_STEPS,
        AnswerContract.ATTENDEES,
        AnswerContract.CUSTOMER_QUESTIONS,
      ];
      const artifactDataSources = ["action_items", "attendees", "qa_pairs"];
      const hasArtifacts = artifactDataSources.includes(result.dataSource);
      const isArtifactComplete = artifactCompleteContracts.includes(contract);

      const needsLLMJudgment = isSemantic && !(isArtifactComplete && hasArtifacts);
      console.log(`[SingleMeeting] LLM judgment: contract=${contract}, isSemantic=${isSemantic}, isArtifactComplete=${isArtifactComplete}, hasArtifacts=${hasArtifacts}, needsLLMJudgment=${needsLLMJudgment}`);

      if (needsLLMJudgment) {
        const reason = result.dataSource === "not_found" ? "artifacts not found" : "judgment question requires filtering";
        console.log(`[SingleMeeting] Semantic processing: ${reason}`);
        try {
          const semanticResult = await semanticAnswerSingleMeeting(
            ctx.meetingId,
            ctx.companyName,
            question,
            ctx.meetingDate
          );
          console.log(`[SingleMeeting] Semantic success: confidence=${semanticResult.confidence}`);
          return {
            answer: semanticResult.answer,
            intent: "extractive",
            dataSource: "semantic",
            semanticAnswerUsed: true,
            semanticConfidence: semanticResult.confidence,
            promptVersions: semanticResult.promptVersions,
          };
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error(`[SingleMeeting] Semantic error: ${errorMsg}`);
          semanticError = errorMsg;
        }
      } else if (!isSemantic) {
        console.log(`[SingleMeeting] Non-semantic: returning artifacts directly`);
      }

      if (result.dataSource === "not_found") {
        return { ...result, pendingOffer: "summary", semanticError };
      }
      return { ...result, semanticError };
    }

    case AnswerContract.AGGREGATIVE_LIST: {
      const result = await handleAggregativeIntent(ctx, question);
      let aggSemanticError: string | undefined;

      if (isSemantic) {
        const reason = result.dataSource === "not_found" ? "artifacts not found" : "judgment question requires filtering";
        console.log(`[SingleMeeting] Semantic processing (aggregative): ${reason}`);
        try {
          const semanticResult = await semanticAnswerSingleMeeting(
            ctx.meetingId,
            ctx.companyName,
            question,
            ctx.meetingDate
          );
          return {
            answer: semanticResult.answer,
            intent: "aggregative",
            dataSource: "semantic",
            semanticAnswerUsed: true,
            semanticConfidence: semanticResult.confidence,
            promptVersions: semanticResult.promptVersions,
          };
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error(`[SingleMeeting] Semantic answer failed (aggregative): ${errorMsg}`);
          aggSemanticError = errorMsg;
        }
      }

      if (result.dataSource === "not_found") {
        return { ...result, pendingOffer: "summary", semanticError: aggSemanticError };
      }
      return { ...result, semanticError: aggSemanticError };
    }

    case AnswerContract.MEETING_SUMMARY:
      return handleSummaryIntent(ctx);

    case AnswerContract.DRAFT_EMAIL:
    case AnswerContract.DRAFT_RESPONSE:
      return handleDraftingIntent(ctx, question, contract);

    default:
      console.error(`[SingleMeeting] Unknown contract "${contract}" — refusing to execute.`);
      return {
        answer: UNCERTAINTY_RESPONSE,
        intent: "extractive",
        dataSource: "not_found",
        pendingOffer: "summary",
      };
  }
}
