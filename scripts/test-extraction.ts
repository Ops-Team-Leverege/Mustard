import { getLastMeetingChunks } from "../server/rag/retriever";
import { extractMeetingActionStates, type TranscriptChunk } from "../server/rag/composer";

async function testExtraction() {
  console.log("Testing action extraction for Cox Automotive...\n");

  // Hard-coded Cox Automotive ID from database
  const companyId = "2e2bd9b3-2ff5-4059-88ad-d5591b468053";
  const companyName = "Cox Automotive";

  console.log(`Using company: ${companyName} (ID: ${companyId})`);

  // Get last meeting chunks - use high limit to get all chunks
  const result = await getLastMeetingChunks(companyId, 1000);
  
  if (!result || result.chunks.length === 0) {
    console.log("No transcript chunks found");
    return;
  }

  console.log(`Found ${result.chunks.length} chunks from transcript ID: ${result.transcriptId}`);
  console.log(`Created: ${result.transcriptCreatedAt}`);
  console.log(`Attendees:`, result.attendees);

  // Show some sample chunks with next steps keywords
  console.log("\n--- Sample chunks containing 'next step' or 'I'll' ---");
  const relevantChunks = result.chunks.filter(c => 
    c.content.toLowerCase().includes("next step") || 
    c.content.toLowerCase().includes("i'll") ||
    c.content.toLowerCase().includes("we'll") ||
    c.content.toLowerCase().includes("i will") ||
    c.content.toLowerCase().includes("we will")
  );
  
  console.log(`Found ${relevantChunks.length} chunks with action keywords`);
  relevantChunks.slice(0, 5).forEach((c, i) => {
    console.log(`\n[${c.chunk_index}] ${c.speaker_name || c.speaker_role}: ${c.content.substring(0, 200)}...`);
  });

  // Map to composer format
  const composerChunks: TranscriptChunk[] = result.chunks.map((c) => ({
    chunkIndex: c.chunk_index,
    speakerRole: c.speaker_role,
    speakerName: c.speaker_name,
    text: c.content,
  }));

  console.log("\n--- Running extraction ---");
  const { primary, secondary } = await extractMeetingActionStates(composerChunks, {
    leverageTeam: result.attendees.leverageTeam ?? undefined,
    customerNames: result.attendees.customerNames ?? undefined,
  });

  console.log("\n=== EXTRACTION RESULTS ===");
  console.log(`Primary actions (≥0.85): ${primary.length}`);
  primary.forEach((a, i) => {
    console.log(`\n[P${i+1}] ${a.action}`);
    console.log(`    Owner: ${a.owner}`);
    console.log(`    Type: ${a.type}`);
    console.log(`    Confidence: ${a.confidence}`);
    console.log(`    Evidence: "${a.evidence}"`);
  });

  console.log(`\nSecondary actions (0.70-0.85): ${secondary.length}`);
  secondary.forEach((a, i) => {
    console.log(`\n[S${i+1}] ${a.action}`);
    console.log(`    Owner: ${a.owner}`);
    console.log(`    Type: ${a.type}`);
    console.log(`    Confidence: ${a.confidence}`);
    console.log(`    Evidence: "${a.evidence}"`);
  });

  process.exit(0);
}

testExtraction().catch(e => {
  console.error("Error:", e);
  process.exit(1);
});
