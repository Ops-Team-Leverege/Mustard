/**
 * DEPRECATED: Customer Questions Extraction
 * 
 * This module is no longer called during transcript ingestion.
 * All Q&A retrieval now uses qa_pairs (from transcript analyzer) instead.
 * Kept for historical reference and potential re-extraction of legacy data.
 *
 * This extractor was INDEPENDENT from the existing Q&A pair extraction.
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
import { MODEL_ASSIGNMENTS, getModelDescription } from "../config/models";
import { CUSTOMER_QUESTIONS_EXTRACTION_PROMPT } from "../config/prompts";

const openai = new OpenAI();

export const CustomerQuestionResultSchema = z.object({
  question_text: z.string(),
  asked_by_name: z.string().optional().default("Unknown"),
  question_turn_index: z.number().optional().default(-1),
  status: z.enum(["ANSWERED", "OPEN", "DEFERRED"]).optional().default("OPEN"),
  answer_evidence: z.string().nullable().optional().default(null),
  answered_by_name: z.string().nullable().optional().default(null),
  // Context Anchoring fields - added post-extraction deterministically
  requires_context: z.boolean().optional().default(false),
  context_before: z.string().nullable().optional().default(null),
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
 * Context-requiring words (deterministic, STRUCTURAL detection).
 * 
 * These are pronouns and demonstratives that grammatically require a referent.
 * Detection is done in CODE, not by the LLM, to ensure consistency.
 * 
 * IMPORTANT: Keep this list STRUCTURAL, not semantic.
 * - GOOD: "this", "that", "it" (grammatical pronouns/demonstratives)
 * - BAD: "mentioned", "what you said" (semantic/interpretive)
 */
const CONTEXT_TRIGGERS = [
  /\bthis\b/i,       // demonstrative pronoun
  /\bthat\b/i,       // demonstrative pronoun
  /\bthose\b/i,      // demonstrative pronoun
  /\bthese\b/i,      // demonstrative pronoun
  /\bit\b/i,         // pronoun (referential)
  /\bthe same\b/i,   // comparative reference
];

/**
 * Deterministically detect if a question requires context.
 * This is done in code, NOT by the LLM, to ensure consistency.
 */
export function requiresContext(questionText: string): boolean {
  return CONTEXT_TRIGGERS.some(pattern => pattern.test(questionText));
}

/**
 * Build context_before from preceding chunks.
 * 
 * Constraints (Safe Context Architecture):
 * - Returns verbatim speaker + text for up to 2 PRECEDING turns only
 * - NEVER includes turns AFTER the question
 * - Only includes turns from the same meeting segment (post-meeting start)
 *   (Green Room filtering happens at extraction time, so chunks are already clean)
 * - Does NOT include the question turn itself
 */
function buildContextBefore(
  chunks: TranscriptChunk[],
  questionChunkIndex: number
): string | null {
  const precedingChunks: TranscriptChunk[] = [];
  
  // Get up to 2 preceding turns (N-1 and N-2)
  for (let i = questionChunkIndex - 1; i >= Math.max(0, questionChunkIndex - 2); i--) {
    if (chunks[i]) {
      precedingChunks.unshift(chunks[i]);
    }
  }
  
  if (precedingChunks.length === 0) {
    return null;
  }
  
  // Format as verbatim transcript turns (speaker + text only)
  const lines = precedingChunks.map(chunk => {
    const speaker = chunk.speakerName || "Unknown";
    return `[${speaker}]: ${chunk.content}`;
  });
  
  return lines.join("\n");
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

const BATCH_SIZE = 150;

async function extractFromBatch(
  chunks: TranscriptChunk[],
  batchNum: number,
  totalBatches: number
): Promise<CustomerQuestionResult[]> {
  const formattedTranscript = formatChunksForExtraction(chunks);
  
  const response = await openai.chat.completions.create({
    model: MODEL_ASSIGNMENTS.CUSTOMER_QUESTION_EXTRACTION,
    temperature: 0,
    max_tokens: 4096,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: CUSTOMER_QUESTIONS_EXTRACTION_PROMPT },
      {
        role: "user",
        content: `Extract customer questions from this transcript segment (batch ${batchNum}/${totalBatches}):\n\n${formattedTranscript}\n\nReturn JSON with a "questions" array. Return {"questions": []} if no customer questions are found.`,
      },
    ],
  });
  
  const content = response.choices[0]?.message?.content;
  if (!content) {
    return [];
  }
  
  const parsed = JSON.parse(content);
  const validated = ExtractionOutputSchema.parse(parsed);
  return validated.questions;
}

/**
 * Extract customer questions from speaker-attributed transcript chunks.
 * 
 * This function:
 * - Uses gpt-4o at temperature 0 for deterministic extraction
 * - Batches large transcripts (>150 chunks) to avoid truncated responses
 * - Applies Context Anchoring post-extraction (deterministic, not LLM-driven)
 * - Returns an empty array if no valid questions are found
 * - Fails independently and is retryable
 * 
 * @param chunks - Speaker-attributed transcript chunks in chronological order
 * @returns Array of extracted customer questions with evidence and context anchoring
 */
export async function extractCustomerQuestions(
  chunks: TranscriptChunk[]
): Promise<CustomerQuestionResult[]> {
  if (chunks.length === 0) {
    console.log("[CustomerQuestions] No chunks provided, returning empty array");
    return [];
  }
  
  // Build a map of chunk index to array position for context lookup
  const chunkIndexMap = new Map<number, number>();
  chunks.forEach((chunk, arrayIndex) => {
    chunkIndexMap.set(chunk.chunkIndex, arrayIndex);
  });
  
  let allQuestions: CustomerQuestionResult[] = [];
  
  if (chunks.length <= BATCH_SIZE) {
    console.log(`[CustomerQuestions] Extracting from ${chunks.length} chunks using ${getModelDescription(MODEL_ASSIGNMENTS.CUSTOMER_QUESTION_EXTRACTION)} temp=0`);
    allQuestions = await extractFromBatch(chunks, 1, 1);
  } else {
    const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);
    console.log(`[CustomerQuestions] Large transcript: ${chunks.length} chunks, processing in ${totalBatches} batches`);
    
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batchChunks = chunks.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      
      console.log(`[CustomerQuestions] Processing batch ${batchNum}/${totalBatches} (${batchChunks.length} chunks)`);
      
      try {
        const batchQuestions = await extractFromBatch(batchChunks, batchNum, totalBatches);
        allQuestions.push(...batchQuestions);
        console.log(`[CustomerQuestions] Batch ${batchNum} extracted ${batchQuestions.length} questions`);
      } catch (error) {
        console.error(`[CustomerQuestions] Batch ${batchNum} failed:`, error);
      }
    }
  }
  
  // Apply Context Anchoring and Speaker Resolution post-extraction (deterministic)
  const questionsWithContext = allQuestions.map(q => {
    const needsContext = requiresContext(q.question_text);
    
    let contextBefore: string | null = null;
    let resolvedAsker = q.asked_by_name;
    let resolvedAnswerer = q.answered_by_name;
    
    if (q.question_turn_index >= 0) {
      const arrayPos = chunkIndexMap.get(q.question_turn_index);
      if (arrayPos !== undefined) {
        const questionChunk = chunks[arrayPos];
        
        // Resolve asker from chunk if LLM returned "Unknown"
        if (!resolvedAsker || resolvedAsker === "Unknown") {
          if (questionChunk?.speakerName) {
            resolvedAsker = questionChunk.speakerName;
          }
        }
        
        // Resolve answerer for ANSWERED questions by looking at next turns
        if (q.status === "ANSWERED" && (!resolvedAnswerer || resolvedAnswerer === "Unknown")) {
          // Look at next 1-3 turns for a different speaker (the answerer)
          for (let i = 1; i <= 3 && arrayPos + i < chunks.length; i++) {
            const nextChunk = chunks[arrayPos + i];
            if (nextChunk?.speakerName && nextChunk.speakerName !== resolvedAsker) {
              // Found a different speaker - likely the answerer
              resolvedAnswerer = nextChunk.speakerName;
              break;
            }
          }
        }
        
        if (needsContext) {
          contextBefore = buildContextBefore(chunks, arrayPos);
        }
      }
    }
    
    return {
      ...q,
      asked_by_name: resolvedAsker,
      answered_by_name: resolvedAnswerer,
      requires_context: needsContext,
      context_before: contextBefore,
    };
  });
  
  const contextCount = questionsWithContext.filter(q => q.requires_context).length;
  console.log(`[CustomerQuestions] Extracted ${allQuestions.length} questions total (${contextCount} require context)`);
  
  return questionsWithContext;
}
