import { storage } from "./storage";
import { extractMeetingActionStates, type TranscriptChunk } from "./rag/composer";

interface TranscriptRow {
  leverage_team: string | null;
  customer_names: string | null;
  company_name: string | null;
}

interface TranscriptChunkRow {
  chunk_index: number;
  speaker_role: string;
  speaker_name: string | null;
  content: string;
}

async function testTranscript(transcriptId: string, name: string) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`Testing: ${name}`);
  console.log(`ID: ${transcriptId}`);
  console.log("=".repeat(80));

  // Fetch transcript metadata
  const transcriptRows = await storage.rawQuery(`
    SELECT leverage_team, customer_names, company_name
    FROM transcripts
    WHERE id = $1
  `, [transcriptId]) as TranscriptRow[];

  if (transcriptRows.length === 0) {
    console.log("Transcript not found!");
    return;
  }

  const transcript = transcriptRows[0];
  console.log(`\nCompany: ${transcript.company_name}`);
  console.log(`Leverage Team: ${transcript.leverage_team || "Not specified"}`);
  console.log(`Customer Names: ${transcript.customer_names || "Not specified"}`);

  // Fetch chunks
  const chunkRows = await storage.rawQuery(`
    SELECT chunk_index, speaker_role, speaker_name, content
    FROM transcript_chunks
    WHERE transcript_id = $1
    ORDER BY chunk_index
  `, [transcriptId]) as TranscriptChunkRow[];

  console.log(`\nChunk count: ${chunkRows.length}`);

  if (chunkRows.length === 0) {
    console.log("No chunks found!");
    return;
  }

  // Convert to composer format
  const composerChunks: TranscriptChunk[] = chunkRows.map((c: TranscriptChunkRow) => ({
    chunkIndex: c.chunk_index,
    speakerRole: c.speaker_role as "leverege" | "customer" | "unknown",
    speakerName: c.speaker_name,
    text: c.content,
  }));

  // Extract action items
  console.log("\nExtracting action items...");
  const startTime = Date.now();
  
  const { primary, secondary } = await extractMeetingActionStates(composerChunks, {
    leverageTeam: transcript.leverage_team ?? undefined,
    customerNames: transcript.customer_names ?? undefined,
  });

  const elapsed = Date.now() - startTime;
  console.log(`\nExtraction completed in ${elapsed}ms`);

  // Output results
  console.log(`\n--- PRIMARY ACTIONS (≥0.85 confidence) ---`);
  if (primary.length === 0) {
    console.log("(none)");
  } else {
    primary.forEach((a, i) => {
      console.log(`\n${i + 1}. [${a.type}] ${a.action}`);
      console.log(`   Owner: ${a.owner}`);
      console.log(`   Deadline: ${a.deadline}`);
      console.log(`   Confidence: ${a.confidence}`);
      console.log(`   Evidence: "${a.evidence}"`);
    });
  }

  console.log(`\n--- SECONDARY ACTIONS (0.70-0.85 confidence) ---`);
  if (secondary.length === 0) {
    console.log("(none)");
  } else {
    secondary.forEach((a, i) => {
      console.log(`\n${i + 1}. [${a.type}] ${a.action}`);
      console.log(`   Owner: ${a.owner}`);
      console.log(`   Deadline: ${a.deadline}`);
      console.log(`   Confidence: ${a.confidence}`);
      console.log(`   Evidence: "${a.evidence}"`);
    });
  }

  return { primary, secondary };
}

async function main() {
  const testTranscripts = [
    { id: "a75f80a3-20df-4fc8-8c6f-a37f65e5315c", name: "America's Auto Auction - AutoTrace Demo Call" },
    { id: "e4647cfd-b7da-493c-a407-11a7eb4091d6", name: "ACE - PitCrew Walkthrough" },
    { id: "965130f8-b303-4845-a5cb-ba68a38336b1", name: "Cox Automotive - PitCrew Demo" },
    { id: "6f1e9961-cae8-494a-a6b3-23df9803937f", name: "Ivy Lane (Valvoline) - Pitcrew feedback call" },
    { id: "bf3e6896-b488-4600-a402-45b25cdad14f", name: "Les Schwab - Introduction to IT Team" },
  ];

  console.log("Starting action extraction test for 5 transcripts...\n");

  for (const t of testTranscripts) {
    try {
      await testTranscript(t.id, t.name);
    } catch (err) {
      console.error(`Error testing ${t.name}:`, err);
    }
  }

  console.log("\n\nAll tests completed!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
