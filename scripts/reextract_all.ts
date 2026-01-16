import { extractCustomerQuestions } from "../server/extraction/extractCustomerQuestions";
import { storage } from "../server/storage";
import type { Product } from "../shared/schema";

const PRODUCTS: Product[] = ["PitCrew", "AutoTrace", "WorkWatch", "ExpressLane"];

async function reextractAll() {
  console.log("=== Re-extracting Customer Questions for All Transcripts ===\n");
  
  // Get all transcripts across all products
  const allTranscripts: any[] = [];
  for (const product of PRODUCTS) {
    const transcripts = await storage.getTranscripts(product);
    allTranscripts.push(...transcripts.map(t => ({ ...t, product })));
  }
  const transcripts = allTranscripts;
  console.log(`Found ${transcripts.length} total transcripts\n`);
  
  let processed = 0;
  let skipped = 0;
  let totalQuestions = 0;
  let totalWithContext = 0;
  
  for (const transcript of transcripts) {
    const transcriptId = transcript.id;
    const name = transcript.name || transcript.companyName || "Unknown";
    
    // Get chunks for this transcript
    const chunks = await storage.getChunksForTranscript(transcriptId, 1000);
    
    if (chunks.length === 0) {
      console.log(`[SKIP] ${name} - No chunks`);
      skipped++;
      continue;
    }
    
    // Delete existing customer questions
    await storage.deleteCustomerQuestionsByTranscript(transcriptId);
    
    try {
      // Run extraction
      const questions = await extractCustomerQuestions(chunks);
      
      if (questions.length === 0) {
        console.log(`[OK] ${name} - 0 questions found`);
        processed++;
        continue;
      }
      
      // Save to database with context anchoring fields
      await storage.createCustomerQuestions(
        questions.map((q) => ({
          product: transcript.product || "PitCrew",
          transcriptId,
          companyId: transcript.companyId,
          questionText: q.question_text,
          askedByName: q.asked_by_name,
          questionTurnIndex: q.question_turn_index,
          status: q.status,
          answerEvidence: q.answer_evidence,
          answeredByName: q.answered_by_name,
          requiresContext: q.requires_context,
          contextBefore: q.context_before,
        })),
      );
      
      const withContext = questions.filter(q => q.requires_context).length;
      totalQuestions += questions.length;
      totalWithContext += withContext;
      
      console.log(`[OK] ${name} - ${questions.length} questions (${withContext} with context)`);
      processed++;
      
    } catch (error: any) {
      console.error(`[ERROR] ${name} - ${error.message}`);
    }
  }
  
  console.log(`\n=== Summary ===`);
  console.log(`Processed: ${processed}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Total Questions: ${totalQuestions}`);
  console.log(`With Context: ${totalWithContext}`);
  
  process.exit(0);
}

reextractAll().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
