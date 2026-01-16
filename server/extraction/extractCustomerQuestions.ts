/**
 * Customer Questions Extraction (High-Trust, Evidence-Based Layer)
 *
 * This extractor is INDEPENDENT from the existing Q&A pair extraction.
 * 
 * Key differences from qa_pairs:
 * | Table              | Nature       | Evidence Required | Inference Allowed | Use Case              |
 * |--------------------|--------------|-------------------|-------------------|-----------------------|
 * | qa_pairs           | Interpreted  | No                | Yes               | Browsing, analytics   |
 * | customer_questions | Extractive   | Yes               | No                | Meeting intelligence  |
 *
 * This extractor:
 * - Extracts ONLY questions asked by customers
 * - Preserves verbatim transcript evidence (no paraphrasing)
 * - Uses explicit status (ANSWERED, OPEN, DEFERRED)
 * - Uses gpt-4o at temperature 0 for deterministic output
 *
 * Model constraints:
 * - GPT-5 must NOT be used (temperature cannot be set to 0)
 * - This model choice does NOT affect Transcript Analyzer, existing Q&A, or RAG Composer
 */

import OpenAI from "openai";
import { z } from "zod";
import type { TranscriptChunk } from "@shared/schema";

const openai = new OpenAI();

const SYSTEM_PROMPT = `You are a strict extraction engine operating on meeting transcripts.

Your task is to extract REAL, INFORMATION-SEEKING QUESTIONS
that were asked BY CUSTOMERS during the meeting.

You must operate conservatively. When in doubt, extract nothing.

RULES:
1. Extract ONLY customer-asked questions. Ignore internal team questions.
2. Questions must be genuine information-seeking questions.
3. The question_text must closely match what was actually said.
4. Do NOT summarize, rewrite, or infer.
5. Mark ANSWERED only if you can quote the exact answer sentence.
6. If follow-up is promised, mark DEFERRED.
7. If unanswered, mark OPEN.
8. Use only the provided transcript text.
9. Returning no questions is valid.

Return ONLY valid JSON using the provided schema.`;

export const CustomerQuestionResultSchema = z.object({
  question_text: z.string(),
  asked_by_name: z.string(),
  question_turn_index: z.number(),
  status: z.enum(["ANSWERED", "OPEN", "DEFERRED"]),
  answer_evidence: z.string().nullable(),
  answered_by_name: z.string().nullable(),
});

export type CustomerQuestionResult = z.infer<typeof CustomerQuestionResultSchema>;

export const ExtractionOutputSchema = z.object({
  questions: z.array(CustomerQuestionResultSchema),
});

interface TranscriptTurn {
  turnIndex: number;
  speakerName: string;
  speakerRole: "customer" | "leverege" | "unknown";
  content: string;
}

/**
 * Format transcript chunks into a structured prompt for the LLM.
 * Preserves speaker identity and role information.
 */
function formatChunksForExtraction(chunks: TranscriptChunk[]): string {
  const turns: string[] = [];
  
  for (const chunk of chunks) {
    const role = chunk.speakerRole || "unknown";
    const speaker = chunk.speakerName || "Unknown";
    turns.push(`[Turn ${chunk.chunkIndex}] [${role.toUpperCase()}] ${speaker}: ${chunk.content}`);
  }
  
  return turns.join("\n\n");
}

/**
 * Extract customer questions from speaker-attributed transcript chunks.
 * 
 * This function:
 * - Uses gpt-4o at temperature 0 for deterministic extraction
 * - Returns an empty array if no valid questions are found
 * - Fails independently and is retryable
 * 
 * @param chunks - Speaker-attributed transcript chunks in chronological order
 * @returns Array of extracted customer questions with evidence
 */
export async function extractCustomerQuestions(
  chunks: TranscriptChunk[]
): Promise<CustomerQuestionResult[]> {
  if (chunks.length === 0) {
    console.log("[CustomerQuestions] No chunks provided, returning empty array");
    return [];
  }
  
  const formattedTranscript = formatChunksForExtraction(chunks);
  
  console.log(`[CustomerQuestions] Extracting from ${chunks.length} chunks using gpt-4o temp=0`);
  
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Extract customer questions from this transcript:\n\n${formattedTranscript}\n\nReturn JSON with a "questions" array. Return {"questions": []} if no customer questions are found.`,
        },
      ],
    });
    
    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.log("[CustomerQuestions] No content in response, returning empty array");
      return [];
    }
    
    const parsed = JSON.parse(content);
    const validated = ExtractionOutputSchema.parse(parsed);
    
    console.log(`[CustomerQuestions] Extracted ${validated.questions.length} customer questions`);
    
    return validated.questions;
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      if (error.status === 429 || error.code === "insufficient_quota") {
        console.error("[CustomerQuestions] [OpenAI Quota Error] Rate limited or quota exceeded");
        throw new Error("OpenAI API quota exceeded. Please check your API key and billing status.");
      }
    }
    
    console.error("[CustomerQuestions] Extraction failed:", error);
    throw error;
  }
}
