/**
 * Semantic Answer Engine for Single-Meeting Queries
 * 
 * Purpose:
 * Generates answers for complex questions that require semantic understanding
 * of transcript content. Used when meeting artifacts (action items, customer questions)
 * don't directly answer the question.
 * 
 * Key Features:
 * - Answer shape detection (yes/no, single value, list, summary)
 * - Stop word filtering for search relevance
 * - Proper noun + keyword matching for transcript search
 * 
 * Uses: Gemini 2.5 Flash (1M context) for semantic interpretation with full transcript
 * 
 * Layer: Slack (semantic answering)
 */

import { GoogleGenAI } from "@google/genai";
import { storage } from "../storage";
import type { MeetingActionItem, TranscriptChunk, QAPairWithCategory } from "@shared/schema";
import { MODEL_ASSIGNMENTS } from "../config/models";
import { buildSemanticAnswerPrompt } from "../config/prompts/singleMeeting";
import { PROMPT_VERSIONS } from "../config/prompts/versions";
import type { PromptUsageRecord } from "../utils/promptVersionTracker";

let _geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!_geminiClient) {
    _geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  }
  return _geminiClient;
}

export type SemanticAnswerResult = {
  answer: string;
  confidence: "high" | "medium" | "low";
  evidenceSources: string[];
  answerShape?: AnswerShape;
  promptVersions?: PromptUsageRecord;
};

/**
 * Answer shape determines HOW the LLM should format its response.
 * This is computed in code BEFORE prompting - prompts only decide how to say it.
 */
export type AnswerShape =
  | "single_value"   // which / where / who / when → one short sentence
  | "yes_no"         // is there / did we / do we have → yes/no first, then offer detail
  | "list"           // next steps, attendees → structured list
  | "summary";       // only when explicitly requested

/**
 * Detect the answer shape based on question structure.
 * This determines HOW the LLM should format its response.
 * 
 * RULE: Shape detection happens in code, not in the prompt.
 * RULE: Summary is ONLY for explicit summary requests - never as default
 */
export function detectAnswerShape(question: string): AnswerShape {
  const q = question.toLowerCase().trim();

  // YES/NO: Questions starting with auxiliary verbs asking for confirmation
  // "Was X discussed?" "Did they mention Y?" "Is there a meeting?"
  const yesNoPatterns = [
    /^(?:is|are|was|were|did|do|does|has|have|had|will|would|can|could) /,
    /\bwere .+ mentioned\b/,
    /\bwas .+ discussed\b/,
    /\bwas .+ covered\b/,
    /\bwas .+ raised\b/,
  ];
  if (yesNoPatterns.some(p => p.test(q))) {
    return "yes_no";
  }

  // SUMMARY: Only explicit summary requests - must check BEFORE other patterns
  const summaryPatterns = [
    /\bsummar(?:y|ize|ise)\b/,
    /\bgive me (?:a |an )?overview\b/,
    /\bmeeting overview\b/,
    /\bbrief me\b/,
    /\bcatch me up\b/,
    /\brecap\b/,
    /\bkey takeaways\b/,
    /\brundown\b/,
  ];
  if (summaryPatterns.some(p => p.test(q))) {
    return "summary";
  }

  // LIST: Questions asking for multiple items
  const listPatterns = [
    /\bnext steps\b/,
    /\battendees?\b/,
    /\bwho (?:all |was |were )?(?:there|attended|present)\b/,
    /\bactions?\s*items?\b/,  // Handles "action items", "actions items" (typo), "action item"
    /\bwhat (?:are|were) the\b.*\b(?:steps|items|actions|tasks|issues|concerns|questions)\b/,
    /\blist\b/,
    /\bopen questions\b/,
    /\bopen items\b/,
    /\bfollow[- ]?ups?\b/,
    /\bwhat issues\b/,
    /\bwhat concerns\b/,
    /\bwhat questions\b/,
    /\bwhat problems\b/,
    // Judgment/prioritization questions about lists
    /\bshould\s+(?:we|i|you)\s+(?:mention|bring|discuss|highlight|note|include|cover)\b/,
    /\bmake\s+sure\s+(?:to\s+)?(?:mention|bring|discuss|note|include|cover)\b/,
    /\bwhat\s+(?:to\s+)?(?:mention|discuss|bring|note)\b/,
  ];
  if (listPatterns.some(p => p.test(q))) {
    return "list";
  }

  // SINGLE VALUE: Specific factual questions seeking one answer
  // "What did X say about Y?" "What pricing did they quote?" "Who said X?"
  const singleValuePatterns = [
    /^which\b/,
    /^where\b/,
    /^who\b/,
    /^when\b/,
    /^what (?:is|was|'s) (?:the|their|his|her|our)\b/,
    /\bwhat (?:store|location|person|name|date|time|place|thing)\b/,
    /\bwhat did .+ (?:say|ask|mention|request|want|quote|share)\b/,
    /\bwhat .+ did .+ (?:say|ask|mention|request|want|quote|share)\b/,
    /\bwhat was (?:agreed|decided|discussed|mentioned)\b/,
    /\bwhat (?:pricing|budget|roi|timeline|deadline)\b/,
    /\bwhat (?:technical|specific)\b/,
    /\bwhat competitors\b/,
    /\bwhat features\b/,
    /\bwhat objections\b/,
  ];
  if (singleValuePatterns.some(p => p.test(q))) {
    return "single_value";
  }

  // Default to single_value - we want direct answers, not summaries
  // Summary should NEVER be the default fallback
  return "single_value";
}

interface MeetingContext {
  meetingId: string;
  companyName: string;
  meetingDate?: Date | null;
  leverageTeam: string[];
  customerNames: string[];
  qaPairs: QAPairWithCategory[];
  actionItems: MeetingActionItem[];
  transcriptChunks: TranscriptChunk[];
}

// buildSystemPrompt and GLOBAL_DONOT_RULES moved to config/prompts/singleMeeting.ts

function formatMeetingDate(date: Date | null | undefined): string {
  if (!date) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function buildContextWindow(ctx: MeetingContext): string {
  const sections: string[] = [];
  const dateSuffix = ctx.meetingDate ? ` (${formatMeetingDate(ctx.meetingDate)})` : "";

  sections.push(`# Meeting with ${ctx.companyName}${dateSuffix}`);

  if (ctx.leverageTeam.length > 0 || ctx.customerNames.length > 0) {
    sections.push(`\n## Attendees`);
    if (ctx.leverageTeam.length > 0) {
      sections.push(`Leverege Team: ${ctx.leverageTeam.join(", ")}`);
    }
    if (ctx.customerNames.length > 0) {
      sections.push(`Customer: ${ctx.customerNames.join(", ")}`);
    }
  }

  if (ctx.qaPairs.length > 0) {
    sections.push(`\n## Customer Q&A`);
    ctx.qaPairs.forEach((q, i) => {
      let entry = `${i + 1}. "${q.question}"`;
      if (q.asker) {
        entry += ` — ${q.asker}`;
      }
      sections.push(entry);
      if (q.answer) {
        sections.push(`   Answer: "${q.answer}"`);
      }
    });
  }

  if (ctx.actionItems.length > 0) {
    sections.push(`\n## Action Items / Next Steps`);
    ctx.actionItems.forEach((item, i) => {
      sections.push(`${i + 1}. ${item.actionText} — ${item.ownerName}`);
      if (item.deadline && item.deadline !== "Not specified") {
        sections.push(`   Deadline: ${item.deadline}`);
      }
      sections.push(`   Evidence: "${item.evidenceQuote}"`);
    });
  }

  if (ctx.transcriptChunks.length > 0) {
    const MAX_CONTEXT_CHARS = 800_000;
    const preambleLength = sections.join("\n").length;
    const budget = MAX_CONTEXT_CHARS - preambleLength;

    let totalChars = 0;
    let chunksToInclude = ctx.transcriptChunks.length;
    for (let i = 0; i < ctx.transcriptChunks.length; i++) {
      totalChars += ctx.transcriptChunks[i].content.length + 50;
      if (totalChars > budget) {
        chunksToInclude = i;
        console.log(`[SemanticAnswer] Context budget hit at chunk ${i}/${ctx.transcriptChunks.length} (${totalChars} chars > ${budget} budget)`);
        break;
      }
    }

    const included = ctx.transcriptChunks.slice(0, chunksToInclude);
    sections.push(`\n## Full Transcript (${included.length}/${ctx.transcriptChunks.length} segments)`);
    included.forEach((chunk, i) => {
      const speaker = chunk.speakerName || "Unknown";
      sections.push(`\n[${i + 1}] ${speaker}:\n"${chunk.content}"`);
    });
  }

  return sections.join("\n");
}

function parseConfidence(response: string): { answer: string; confidence: "high" | "medium" | "low" } {
  const confidenceMatch = response.match(/\[CONFIDENCE:\s*(high|medium|low)\]/i);
  let confidence: "high" | "medium" | "low" = "medium";
  let answer = response;

  if (confidenceMatch) {
    confidence = confidenceMatch[1].toLowerCase() as "high" | "medium" | "low";
    answer = response.replace(/\[CONFIDENCE:\s*(high|medium|low)\]/i, "").trim();
  }

  return { answer, confidence };
}

export async function semanticAnswerSingleMeeting(
  meetingId: string,
  companyName: string,
  userQuestion: string,
  meetingDate?: Date | null,
): Promise<SemanticAnswerResult> {
  console.log(`[SemanticAnswer] Starting for meeting ${meetingId}`);
  const startTime = Date.now();

  const [transcript, qaPairs, actionItems, chunks] = await Promise.all([
    storage.getTranscriptById(meetingId),
    storage.getQAPairsByTranscriptId(meetingId),
    storage.getMeetingActionItemsByTranscript(meetingId),
    storage.getChunksForTranscript(meetingId),
  ]);

  console.log(`[SemanticAnswer] Data fetch: ${Date.now() - startTime}ms`);

  // getTranscriptById returns null when the meeting ID doesn't exist in the database
  // (e.g., deleted transcript, stale thread context). The other three methods always
  // return arrays (possibly empty), so only transcript needs a null guard.
  if (!transcript) {
    throw new Error(`Transcript not found for meeting ${meetingId}`);
  }

  const leverageTeam = transcript?.leverageTeam
    ? transcript.leverageTeam.split(",").map(s => s.trim()).filter(Boolean)
    : [];
  const customerNames = transcript?.customerNames
    ? transcript.customerNames.split(",").map(s => s.trim()).filter(Boolean)
    : [];

  const context: MeetingContext = {
    meetingId,
    companyName,
    meetingDate,
    leverageTeam,
    customerNames,
    qaPairs,
    actionItems,
    transcriptChunks: chunks,
  };

  const contextWindow = buildContextWindow(context);
  console.log(`[SemanticAnswer] Context window: ${contextWindow.length} chars (${chunks.length} chunks fetched)`);

  // STEP 1: Detect answer shape BEFORE prompting
  const answerShape = detectAnswerShape(userQuestion);
  console.log(`[SemanticAnswer] Detected answer shape: ${answerShape}`);

  const evidenceSources: string[] = [];
  if (qaPairs.length > 0) evidenceSources.push("qa_pairs");
  if (actionItems.length > 0) evidenceSources.push("action_items");
  if (chunks.length > 0) evidenceSources.push("transcript_chunks");
  if (leverageTeam.length > 0 || customerNames.length > 0) evidenceSources.push("attendees");

  // STEP 2: Build shape-specific prompt
  const systemPrompt = buildSemanticAnswerPrompt(answerShape);

  try {
    const response = await getGeminiClient().models.generateContent({
      model: MODEL_ASSIGNMENTS.SEMANTIC_ANSWER_SYNTHESIS,
      config: {
        maxOutputTokens: 2000,
        temperature: 0.3,
        systemInstruction: systemPrompt,
      },
      contents: `MEETING DATA:\n${contextWindow}\n\n---\n\nUSER QUESTION: ${userQuestion}`,
    });

    const rawAnswer = response.text;
    console.log(`[SemanticAnswer] Gemini call: ${Date.now() - startTime}ms`);
    console.log(`[SemanticAnswer] Response length: ${rawAnswer?.length || 0}`);

    const trackedVersions: PromptUsageRecord = {
      SEMANTIC_ANSWER_PROMPT: PROMPT_VERSIONS.SEMANTIC_ANSWER_PROMPT,
    };

    if (!rawAnswer) {
      console.log(`[SemanticAnswer] Empty response from Gemini`);
      return {
        answer: "I don't see this explicitly mentioned in the meeting.",
        confidence: "low",
        evidenceSources,
        answerShape,
        promptVersions: trackedVersions,
      };
    }

    const { answer, confidence } = parseConfidence(rawAnswer);

    console.log(`[SemanticAnswer] Complete | shape=${answerShape} | confidence=${confidence} | sources=${evidenceSources.join(",")}`);

    return {
      answer,
      confidence,
      evidenceSources,
      answerShape,
      promptVersions: trackedVersions,
    };
  } catch (error) {
    console.error(`[SemanticAnswer] Gemini error:`, error);
    throw error;
  }
}
