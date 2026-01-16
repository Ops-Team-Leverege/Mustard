/**
 * Extract customer questions directly from raw transcript text.
 * 
 * This is a fallback for transcripts that don't have chunks available.
 * Uses the same gpt-4o model at temperature 0 for consistency.
 */

import OpenAI from "openai";
import { CustomerQuestionResultSchema, ExtractionOutputSchema, type CustomerQuestionResult } from "./extractCustomerQuestions";

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
10. For asked_by_name, use the speaker name if available, otherwise "Customer".
11. For question_turn_index, estimate the position in the conversation (1, 2, 3, etc).

Return ONLY valid JSON using the provided schema.`;

export async function extractCustomerQuestionsFromText(
  transcriptText: string
): Promise<CustomerQuestionResult[]> {
  if (!transcriptText || transcriptText.length < 100) {
    console.log("[CustomerQuestions] Transcript too short, returning empty array");
    return [];
  }

  const truncatedText = transcriptText.length > 100000 
    ? transcriptText.slice(0, 100000) + "\n\n[TRANSCRIPT TRUNCATED]"
    : transcriptText;

  console.log(`[CustomerQuestions] Extracting from raw text (${transcriptText.length} chars) using gpt-4o temp=0`);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Extract customer questions from this transcript:\n\n${truncatedText}\n\nReturn JSON with a "questions" array. Return {"questions": []} if no customer questions are found.`,
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

    console.log(`[CustomerQuestions] Extracted ${validated.questions.length} customer questions from raw text`);

    return validated.questions;
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      if (error.status === 429 || error.code === "insufficient_quota") {
        console.error("[CustomerQuestions] [OpenAI Quota Error] Rate limited or quota exceeded");
        throw new Error("OpenAI API quota exceeded. Please check your API key and billing status.");
      }
    }

    console.error("[CustomerQuestions] Extraction from text failed:", error);
    throw error;
  }
}
