/**
 * Script to chunk all transcripts that haven't been chunked yet.
 * Run with: npx tsx scripts/chunk-all-transcripts.ts
 */

import { ingestTranscriptChunks } from "../server/ingestion/ingestTranscriptChunks";

async function main() {
  console.log("Starting transcript chunking...\n");

  // Process all transcripts that haven't been chunked yet
  // The listTranscriptsForChunking function already filters for unchunked transcripts
  const result = await ingestTranscriptChunks({
    limit: 1000, // Process up to 1000 transcripts
    dryRun: false,
  });

  console.log("\n=== Chunking Complete ===");
  console.log(`Transcripts processed: ${result.transcriptsProcessed}`);
  console.log(`Chunks created: ${result.chunksPrepared}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Chunking failed:", err);
  process.exit(1);
});
