/**
 * Backfill Customer Questions for Existing Transcripts
 * 
 * This script processes existing transcripts and extracts customer questions.
 * It uses chunks when available, or falls back to raw transcript text.
 * 
 * Usage:
 *   npx tsx server/scripts/backfill-customer-questions.ts [--dry-run]
 * 
 * Options:
 *   --dry-run    List transcripts that would be processed without extracting
 */

import { storage } from "../storage";
import { extractCustomerQuestions } from "../extraction/extractCustomerQuestions";
import { extractCustomerQuestionsFromText } from "../extraction/extractCustomerQuestionsFromText";
import type { Product } from "@shared/schema";

const BATCH_SIZE = 5;
const DELAY_BETWEEN_BATCHES_MS = 2000;
const MIN_TRANSCRIPT_LENGTH = 500;

interface TranscriptToProcess {
  id: string;
  product: Product;
  companyName: string | null;
  chunkCount: number;
  transcriptLength: number;
  existingQuestionCount: number;
}

async function getTranscriptsToProcess(): Promise<TranscriptToProcess[]> {
  const results = await storage.rawQuery(`
    SELECT 
      t.id,
      t.product,
      t.company_name as "companyName",
      COUNT(DISTINCT tc.id)::int as "chunkCount",
      COALESCE(LENGTH(t.transcript), 0)::int as "transcriptLength",
      COUNT(DISTINCT cq.id)::int as "existingQuestionCount"
    FROM transcripts t
    LEFT JOIN transcript_chunks tc ON t.id = tc.transcript_id
    LEFT JOIN customer_questions cq ON t.id = cq.transcript_id
    WHERE t.processing_status = 'completed'
    GROUP BY t.id, t.product, t.company_name, t.transcript
    HAVING COUNT(DISTINCT tc.id) >= 1 OR COALESCE(LENGTH(t.transcript), 0) >= ${MIN_TRANSCRIPT_LENGTH}
    ORDER BY t.product, t.created_at DESC
  `);

  return results as TranscriptToProcess[];
}

async function getTranscriptText(transcriptId: string): Promise<string | null> {
  const results = await storage.rawQuery(`
    SELECT transcript FROM transcripts WHERE id = '${transcriptId}'
  `);
  return results[0]?.transcript || null;
}

async function processTranscript(transcript: TranscriptToProcess): Promise<{ success: boolean; questionsFound: number; method: string; error?: string }> {
  try {
    await storage.deleteCustomerQuestionsByTranscript(transcript.id);

    let questions;
    let method: string;

    if (transcript.chunkCount >= 10) {
      const chunks = await storage.getChunksForTranscript(transcript.id, 1000);
      questions = await extractCustomerQuestions(chunks);
      method = "chunks";
    } else {
      const transcriptText = await getTranscriptText(transcript.id);
      if (!transcriptText || transcriptText.length < MIN_TRANSCRIPT_LENGTH) {
        return { success: false, questionsFound: 0, method: "none", error: "Transcript too short" };
      }
      questions = await extractCustomerQuestionsFromText(transcriptText);
      method = "raw text";
    }

    if (questions.length > 0) {
      await storage.createCustomerQuestions(
        questions.map((q) => ({
          transcriptId: transcript.id,
          product: transcript.product,
          questionText: q.question_text,
          askedByName: q.asked_by_name,
          questionTurnIndex: q.question_turn_index,
          status: q.status,
          answerEvidence: q.answer_evidence,
          answeredByName: q.answered_by_name,
        }))
      );
    }

    return { success: true, questionsFound: questions.length, method };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, questionsFound: 0, method: "error", error: errorMessage };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const isDryRun = process.argv.includes("--dry-run");
  
  console.log("=".repeat(60));
  console.log("Customer Questions Backfill Script");
  console.log("=".repeat(60));
  console.log(`Mode: ${isDryRun ? "DRY RUN (no changes will be made)" : "LIVE"}`);
  console.log(`Minimum transcript length: ${MIN_TRANSCRIPT_LENGTH} chars`);
  console.log();

  const allTranscripts = await getTranscriptsToProcess();
  const toProcess = allTranscripts.filter(t => t.existingQuestionCount === 0);
  const alreadyProcessed = allTranscripts.filter(t => t.existingQuestionCount > 0);

  console.log(`Total eligible transcripts: ${allTranscripts.length}`);
  console.log(`Already have customer questions: ${alreadyProcessed.length}`);
  console.log(`Need processing: ${toProcess.length}`);
  console.log();

  if (isDryRun) {
    console.log("Transcripts that would be processed:");
    console.log("-".repeat(60));
    for (const t of toProcess) {
      const method = t.chunkCount >= 10 ? `${t.chunkCount} chunks` : `raw text (${t.transcriptLength} chars)`;
      console.log(`  [${t.product}] ${t.companyName || "(no company)"} - ${method}`);
    }
    console.log();
    console.log("Run without --dry-run to process these transcripts.");
    return;
  }

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let totalQuestions = 0;

  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const batch = toProcess.slice(i, i + BATCH_SIZE);
    console.log(`\nProcessing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(toProcess.length / BATCH_SIZE)}...`);

    for (const transcript of batch) {
      const label = `[${transcript.product}] ${transcript.companyName || "(no company)"}`;
      process.stdout.write(`  ${label}... `);
      
      const result = await processTranscript(transcript);
      processed++;

      if (result.success) {
        succeeded++;
        totalQuestions += result.questionsFound;
        console.log(`OK (${result.questionsFound} questions via ${result.method})`);
      } else {
        failed++;
        console.log(`FAILED: ${result.error}`);
      }
    }

    if (i + BATCH_SIZE < toProcess.length) {
      console.log(`  Waiting ${DELAY_BETWEEN_BATCHES_MS / 1000}s before next batch...`);
      await sleep(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  console.log();
  console.log("=".repeat(60));
  console.log("Backfill Complete");
  console.log("=".repeat(60));
  console.log(`Processed: ${processed}`);
  console.log(`Succeeded: ${succeeded}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total questions extracted: ${totalQuestions}`);
}

main().catch(console.error);
