/**
 * Customer Questions Resolution Pass (Verifier-Only, Tier-1)
 * 
 * This module resolves whether customer questions were explicitly answered
 * during the meeting. It runs AFTER question extraction, as a separate pass.
 * 
 * Architectural Invariants:
 * - Runs offline (ingestion or post-ingestion job)
 * - Strictly verifier-only: no summarization, no inference, no synthesis
 * - Answers must be quoted from transcript, not paraphrased
 * - Absence is explicit (OPEN is a valid outcome)
 * - Slack Q&A remains read-only - this NEVER runs on Slack query path
 * 
 * Search Window:
 * - Start: immediately after question_turn_index
 * - End: first of: explicit answer, explicit deferral, topic shift, or 10 turns
 */

import OpenAI from "openai";
import { z } from "zod";
import type { TranscriptChunk, CustomerQuestion } from "@shared/schema";

const openai = new OpenAI();

const RESOLUTION_SYSTEM_PROMPT = `You are a strict transcript verifier.

Your task is NOT to summarize or infer.
Your task is ONLY to verify whether a specific customer question
received an explicit answer in the transcript.

Rules:
1. Use ONLY the provided transcript turns.
2. Quote answers verbatim or with minimal cleanup (remove filler words only).
3. If the speaker says they will follow up later, classify as DEFERRED.
4. If no explicit answer is given, classify as OPEN.
5. Do NOT infer answers.
6. Do NOT combine multiple turns into a new answer.
7. If uncertain, choose OPEN.
8. Return the turn index where the answer was found (resolution_turn_index).

Return ONLY valid JSON.`;

const ResolutionResultSchema = z.object({
  resolution_status: z.enum(["ANSWERED", "DEFERRED", "OPEN"]),
  answer_text: z.string().nullable(),
  answered_by_name: z.string().nullable(),
  evidence_quote: z.string().nullable(),
  resolution_turn_index: z.number().nullable(),
});

export type ResolutionResult = z.infer<typeof ResolutionResultSchema>;

interface TranscriptTurn {
  turnIndex: number;
  speakerName: string;
  content: string;
}

const SEARCH_WINDOW_SIZE = 10;

/**
 * Format transcript turns for the resolution prompt.
 */
function formatTurnsForResolution(turns: TranscriptTurn[]): string {
  return turns
    .map(t => `[Turn ${t.turnIndex}] ${t.speakerName}: ${t.content}`)
    .join("\n\n");
}

/**
 * Extract turns from chunks within the search window.
 */
function extractSearchWindow(
  chunks: TranscriptChunk[],
  questionTurnIndex: number
): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  
  for (const chunk of chunks) {
    if (chunk.chunkIndex > questionTurnIndex && 
        chunk.chunkIndex <= questionTurnIndex + SEARCH_WINDOW_SIZE) {
      turns.push({
        turnIndex: chunk.chunkIndex,
        speakerName: chunk.speakerName || "Unknown",
        content: chunk.content,
      });
    }
  }
  
  return turns;
}

/**
 * Resolve a single customer question against the transcript.
 * 
 * Uses gpt-4o at temperature 0 for deterministic verification.
 */
async function resolveQuestion(
  question: { questionText: string; questionTurnIndex: number },
  searchWindowTurns: TranscriptTurn[]
): Promise<ResolutionResult> {
  if (searchWindowTurns.length === 0) {
    return {
      resolution_status: "OPEN",
      answer_text: null,
      answered_by_name: null,
      evidence_quote: null,
      resolution_turn_index: null,
    };
  }
  
  const formattedTurns = formatTurnsForResolution(searchWindowTurns);
  
  const userPrompt = `Customer question: "${question.questionText}"

Transcript turns after the question (search window):
${formattedTurns}

Determine if this question was answered, deferred, or left open.
Return JSON with: resolution_status, answer_text, answered_by_name, evidence_quote, resolution_turn_index`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: RESOLUTION_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    });
    
    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.log("[Resolution] No content in response, marking as OPEN");
      return {
        resolution_status: "OPEN",
        answer_text: null,
        answered_by_name: null,
        evidence_quote: null,
        resolution_turn_index: null,
      };
    }
    
    const parsed = JSON.parse(content);
    const result = ResolutionResultSchema.parse(parsed);
    
    // Enforce invariant: OPEN status must have null answer fields
    if (result.resolution_status === "OPEN") {
      return {
        resolution_status: "OPEN",
        answer_text: null,
        answered_by_name: null,
        evidence_quote: null,
        resolution_turn_index: null,
      };
    }
    
    // Enforce invariant: ANSWERED must have evidence_quote
    if (result.resolution_status === "ANSWERED" && !result.evidence_quote) {
      console.log("[Resolution] ANSWERED without evidence, downgrading to OPEN");
      return {
        resolution_status: "OPEN",
        answer_text: null,
        answered_by_name: null,
        evidence_quote: null,
        resolution_turn_index: null,
      };
    }
    
    return result;
  } catch (error) {
    console.error("[Resolution] Error resolving question:", error);
    return {
      resolution_status: "OPEN",
      answer_text: null,
      answered_by_name: null,
      evidence_quote: null,
      resolution_turn_index: null,
    };
  }
}

export interface QuestionToResolve {
  id: string;
  questionText: string;
  questionTurnIndex: number;
}

export interface ResolvedQuestion {
  id: string;
  status: "ANSWERED" | "DEFERRED" | "OPEN";
  answerEvidence: string | null;
  answeredByName: string | null;
  resolutionTurnIndex: number | null;
}

/**
 * Resolve all customer questions for a transcript.
 * 
 * This is the main entry point for the Resolution Pass.
 * It should be called after question extraction completes.
 * 
 * @param questions - Customer questions to resolve (with id, questionText, questionTurnIndex)
 * @param chunks - Full transcript chunks for the meeting
 * @returns Array of resolved questions with status and evidence
 */
export async function resolveCustomerQuestionAnswers(
  questions: QuestionToResolve[],
  chunks: TranscriptChunk[]
): Promise<ResolvedQuestion[]> {
  if (questions.length === 0) {
    console.log("[Resolution] No questions to resolve");
    return [];
  }
  
  console.log(`[Resolution] Resolving ${questions.length} customer questions`);
  const startTime = Date.now();
  
  const results: ResolvedQuestion[] = [];
  
  for (const question of questions) {
    const searchWindow = extractSearchWindow(chunks, question.questionTurnIndex);
    console.log(`[Resolution] Question at turn ${question.questionTurnIndex}: ${searchWindow.length} turns in window`);
    
    const resolution = await resolveQuestion(
      { questionText: question.questionText, questionTurnIndex: question.questionTurnIndex },
      searchWindow
    );
    
    results.push({
      id: question.id,
      status: resolution.resolution_status,
      answerEvidence: resolution.evidence_quote || resolution.answer_text,
      answeredByName: resolution.answered_by_name,
      resolutionTurnIndex: resolution.resolution_turn_index,
    });
    
    console.log(`[Resolution] Question "${question.questionText.substring(0, 50)}..." → ${resolution.resolution_status}`);
  }
  
  const answered = results.filter(r => r.status === "ANSWERED").length;
  const deferred = results.filter(r => r.status === "DEFERRED").length;
  const open = results.filter(r => r.status === "OPEN").length;
  
  console.log(`[Resolution] Complete in ${Date.now() - startTime}ms: ${answered} answered, ${deferred} deferred, ${open} open`);
  
  return results;
}
