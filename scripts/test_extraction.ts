import { extractCustomerQuestions } from "../server/extraction/extractCustomerQuestions";
import { storage } from "../server/storage";

async function testExtraction() {
  const transcriptId = "0b6c7f42-3203-44c6-97ea-28851fc436c3";
  console.log(`Testing extraction for transcript: ${transcriptId}`);
  
  // Get chunks
  const chunks = await storage.getChunksForTranscript(transcriptId, 1000);
  console.log(`Found ${chunks.length} chunks`);
  
  if (chunks.length === 0) {
    console.log("No chunks found, exiting");
    process.exit(1);
  }
  
  // Run extraction
  const questions = await extractCustomerQuestions(chunks);
  console.log(`\nExtracted ${questions.length} questions:\n`);
  
  for (const q of questions) {
    console.log(`---`);
    console.log(`Q: ${q.question_text}`);
    console.log(`Turn Index: ${q.question_turn_index}`);
    console.log(`Requires Context: ${q.requires_context}`);
    console.log(`Context Before: ${q.context_before ? q.context_before.substring(0, 150) + "..." : "NULL"}`);
  }
  
  process.exit(0);
}

testExtraction().catch(console.error);
