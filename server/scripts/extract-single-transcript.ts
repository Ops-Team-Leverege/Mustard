import { storage } from "../storage";
import { extractCustomerQuestions } from "../extraction/extractCustomerQuestions";

const transcriptId = process.argv[2];

if (!transcriptId) {
  console.error("Usage: npx tsx server/scripts/extract-single-transcript.ts <transcript-id>");
  process.exit(1);
}

async function run() {
  console.log(`[Extract] Processing transcript ${transcriptId}`);
  
  const chunks = await storage.getChunksForTranscript(transcriptId, 1000);
  console.log(`[Extract] Found ${chunks.length} chunks`);
  
  if (chunks.length === 0) {
    console.log("[Extract] No chunks found, cannot extract");
    return;
  }
  
  console.log("[Extract] Extracting customer questions...");
  const questions = await extractCustomerQuestions(chunks);
  console.log(`[Extract] Extracted ${questions.length} questions`);
  
  if (questions.length === 0) {
    console.log("[Extract] No customer questions found in this transcript");
    return;
  }
  
  const transcript = await storage.getTranscript("PitCrew", transcriptId);
  if (!transcript) {
    console.log("[Extract] Transcript not found in database");
    return;
  }
  
  await storage.deleteCustomerQuestionsByTranscript(transcriptId);
  console.log("[Extract] Cleared existing questions");
  
  const insertData = questions.map(q => ({
    product: "PitCrew" as const,
    transcriptId,
    companyId: transcript.companyId,
    questionText: q.question_text,
    askedByName: q.asked_by_name || null,
    questionTurnIndex: q.question_turn_index,
    status: q.status,
    answeredByName: q.answered_by_name || null,
    answerEvidence: q.answer_evidence || null,
    requiresContext: q.requires_context || false,
    contextBefore: q.context_before || null,
  }));
  
  await storage.createCustomerQuestions(insertData);
  
  console.log(`[Extract] Successfully inserted ${questions.length} customer questions`);
  
  for (const q of questions) {
    console.log(`  - [${q.status}] "${q.question_text.substring(0, 80)}..."`);
  }
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[Extract] Error:", e);
    process.exit(1);
  });
