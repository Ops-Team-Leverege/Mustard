/**
 * Backfill Meeting Action Items for Existing Transcripts
 * 
 * This script processes existing transcripts and extracts action items.
 * It uses the same extraction logic as the ingestion pipeline.
 * 
 * Usage:
 *   npx tsx server/scripts/backfill-action-items.ts [--dry-run]
 * 
 * Options:
 *   --dry-run    List transcripts that would be processed without extracting
 */

import { storage } from "../storage";
import { extractMeetingActionStates, type TranscriptChunk as ComposerChunk } from "../rag/composer";
import type { Product } from "@shared/schema";

const BATCH_SIZE = 3;
const DELAY_BETWEEN_BATCHES_MS = 3000;

interface TranscriptToProcess {
  id: string;
  product: Product;
  companyId: string | null;
  companyName: string | null;
  chunkCount: number;
  existingActionItemCount: number;
  leverageTeam: string | null;
  customerNames: string | null;
}

async function getTranscriptsToProcess(): Promise<TranscriptToProcess[]> {
  const results = await storage.rawQuery(`
    SELECT 
      t.id,
      t.product,
      t.company_id as "companyId",
      t.company_name as "companyName",
      t.leverage_team as "leverageTeam",
      t.customer_names as "customerNames",
      COUNT(DISTINCT tc.id)::int as "chunkCount",
      COUNT(DISTINCT mai.id)::int as "existingActionItemCount"
    FROM transcripts t
    LEFT JOIN transcript_chunks tc ON t.id = tc.transcript_id
    LEFT JOIN meeting_action_items mai ON t.id = mai.transcript_id
    WHERE t.processing_status = 'completed'
    GROUP BY t.id, t.product, t.company_id, t.company_name, t.leverage_team, t.customer_names
    HAVING COUNT(DISTINCT tc.id) >= 1
    ORDER BY t.product, t.created_at DESC
  `);

  return results as TranscriptToProcess[];
}

async function processTranscript(transcript: TranscriptToProcess): Promise<{ success: boolean; itemsFound: number; error?: string }> {
  try {
    if (!transcript.companyId) {
      return { success: false, itemsFound: 0, error: "No company ID" };
    }

    const chunks = await storage.getChunksForTranscript(transcript.id, 5000);
    
    if (chunks.length === 0) {
      return { success: false, itemsFound: 0, error: "No chunks found" };
    }

    await storage.deleteMeetingActionItemsByTranscript(transcript.id);

    const composerChunks: ComposerChunk[] = chunks.map(c => ({
      chunkIndex: c.chunkIndex,
      speakerRole: (c.speakerRole || "unknown") as "leverege" | "customer" | "unknown",
      speakerName: c.speakerName || undefined,
      text: c.content,
    }));

    const { primary, secondary } = await extractMeetingActionStates(composerChunks, {
      leverageTeam: transcript.leverageTeam || undefined,
      customerNames: transcript.customerNames || undefined,
    });

    const allItems = [...primary, ...secondary];

    if (allItems.length > 0) {
      await storage.createMeetingActionItems(
        allItems.map((item, index) => ({
          product: transcript.product,
          transcriptId: transcript.id,
          companyId: transcript.companyId!,
          actionText: item.action,
          ownerName: item.owner,
          actionType: item.type,
          deadline: item.deadline === "Not specified" ? null : item.deadline,
          evidenceQuote: item.evidence,
          confidence: item.confidence,
          isPrimary: index < primary.length,
        })),
      );
    } else {
      await storage.createMeetingActionItems([{
        product: transcript.product,
        transcriptId: transcript.id,
        companyId: transcript.companyId!,
        actionText: "[No action items found in this meeting]",
        ownerName: "System",
        actionType: "commitment",
        deadline: null,
        evidenceQuote: "Processed by backfill script - no extractable action items",
        confidence: 0,
        isPrimary: false,
      }]);
    }

    return { success: true, itemsFound: allItems.length };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, itemsFound: 0, error: errorMessage };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const isDryRun = process.argv.includes("--dry-run");
  
  console.log("=".repeat(60));
  console.log("Meeting Action Items Backfill Script");
  console.log("=".repeat(60));
  console.log(`Mode: ${isDryRun ? "DRY RUN (no changes will be made)" : "LIVE"}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Delay between batches: ${DELAY_BETWEEN_BATCHES_MS / 1000}s`);
  console.log();

  const allTranscripts = await getTranscriptsToProcess();
  const toProcess = allTranscripts.filter(t => t.existingActionItemCount === 0);
  const alreadyProcessed = allTranscripts.filter(t => t.existingActionItemCount > 0);

  console.log(`Total eligible transcripts: ${allTranscripts.length}`);
  console.log(`Already have action items: ${alreadyProcessed.length}`);
  console.log(`Need processing: ${toProcess.length}`);
  console.log();

  if (isDryRun) {
    console.log("Transcripts that would be processed:");
    console.log("-".repeat(60));
    for (const t of toProcess) {
      console.log(`  [${t.product}] ${t.companyName || "(no company)"} - ${t.chunkCount} chunks`);
    }
    console.log();
    console.log("Run without --dry-run to process these transcripts.");
    return;
  }

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let totalItems = 0;

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
        totalItems += result.itemsFound;
        console.log(`OK (${result.itemsFound} action items)`);
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
  console.log(`Total action items extracted: ${totalItems}`);
}

main().catch(console.error);
