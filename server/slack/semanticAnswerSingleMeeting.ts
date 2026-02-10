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
 * Uses: GPT-5 (temperature 1) for semantic interpretation
 * 
 * Layer: Slack (semantic answering)
 */

import OpenAI from "openai";
import { storage } from "../storage";
import type { CustomerQuestion, MeetingActionItem, TranscriptChunk } from "@shared/schema";
import { MODEL_ASSIGNMENTS } from "../config/models";
import { SEMANTIC_ANSWER } from "../config/constants";
import { buildSemanticAnswerPrompt } from "../config/prompts/singleMeeting";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 60000,
  maxRetries: 1,
});

export type SemanticAnswerResult = {
  answer: string;
  confidence: "high" | "medium" | "low";
  evidenceSources: string[];
  answerShape?: AnswerShape;
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
  customerQuestions: CustomerQuestion[];
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

const SEMANTIC_STOP_WORDS = new Set([
  "what", "when", "where", "which", "who", "whom", "whose", "that", "this",
  "these", "those", "with", "from", "about", "into", "through", "during",
  "before", "after", "above", "below", "between", "does", "have", "been",
  "being", "having", "would", "could", "should", "might", "will", "shall",
  "must", "need", "want", "like", "just", "also", "very", "much", "more",
  "most", "some", "such", "than", "then", "them", "they", "their", "there",
  "here", "only", "even", "well", "back", "were", "said", "each", "make",
  "over", "because", "help", "mentioned", "mention", "particular", "could",
  "pain", "point", "pitcrew",
]);

function extractSemanticKeywords(query: string): { keywords: string[]; speakerNames: string[] } {
  const words = query.split(/\s+/);

  const speakerNames = words
    .filter((w, i) => i > 0 && /^[A-Z][a-z]+$/.test(w))
    .map(w => w.toLowerCase());

  const keywords = query.toLowerCase()
    .split(/\s+/)
    .map(w => w.replace(/[^a-z]/g, ''))
    .filter(w => w.length > 2 && !SEMANTIC_STOP_WORDS.has(w) && !speakerNames.includes(w));

  return { keywords, speakerNames };
}

function selectRelevantChunks(
  chunks: TranscriptChunk[],
  question: string,
  maxChunks: number = SEMANTIC_ANSWER.MAX_RELEVANT_CHUNKS
): TranscriptChunk[] {
  if (chunks.length <= maxChunks) return chunks;

  const { keywords, speakerNames } = extractSemanticKeywords(question);
  console.log(`[SemanticAnswer] Relevance filter: speakers=[${speakerNames.join(",")}], keywords=[${keywords.join(",")}]`);

  const scored = chunks.map(chunk => {
    let score = 0;
    const content = chunk.content.toLowerCase();
    const speaker = (chunk.speakerName || "").toLowerCase();

    if (speakerNames.length > 0 && speakerNames.some(name => speaker.includes(name))) {
      const isSubstantive = chunk.content.length > 30
        && !/^(mhm|yeah|okay|cool|right|yes|no|uh|um|oh|hmm)[.!?,\s]*$/i.test(chunk.content.trim());
      score += isSubstantive ? 10 : 1;
    }

    const keywordHits = keywords.filter(kw => content.includes(kw)).length;
    score += keywordHits * 3;

    if (chunk.content.length > 100) score += 1;
    if (chunk.content.length > SEMANTIC_ANSWER.MIN_SUBSTANTIVE_LENGTH) score += 1;

    return { chunk, score };
  });

  scored.sort((a, b) => b.score - a.score || a.chunk.chunkIndex - b.chunk.chunkIndex);

  const relevant = scored.filter(s => s.score > 0);
  const selected = relevant
    .slice(0, maxChunks)
    .map(s => s.chunk);

  if (selected.length < maxChunks) {
    const selectedIds = new Set(selected.map(c => c.id));
    const remaining = chunks
      .filter(c => !selectedIds.has(c.id) && c.content.length > 50)
      .slice(0, maxChunks - selected.length);
    selected.push(...remaining);
  }

  selected.sort((a, b) => a.chunkIndex - b.chunkIndex);

  const dropped = relevant.length - Math.min(relevant.length, maxChunks);
  console.log(`[SemanticAnswer] Selected ${selected.length}/${chunks.length} chunks (${relevant.length} scored relevant, ${dropped} relevant dropped due to limit)`);
  if (dropped > 0) {
    const droppedScores = relevant.slice(maxChunks).map(s => s.score);
    console.log(`[SemanticAnswer] Dropped chunk scores: min=${Math.min(...droppedScores)}, max=${Math.max(...droppedScores)}`);
  }
  return selected;
}

function buildContextWindow(ctx: MeetingContext, question?: string): string {
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

  if (ctx.customerQuestions.length > 0) {
    sections.push(`\n## Customer Questions (Verbatim)`);
    ctx.customerQuestions.forEach((q, i) => {
      let entry = `${i + 1}. "${q.questionText}"`;
      if (q.askedByName) {
        entry += ` — ${q.askedByName}`;
      }
      sections.push(entry);
      if (q.status === "ANSWERED" && q.answerEvidence) {
        sections.push(`   Answer: "${q.answerEvidence}"`);
        if (q.answeredByName) {
          sections.push(`   — ${q.answeredByName}`);
        }
      } else if (q.status === "OPEN") {
        sections.push(`   (Left open in meeting)`);
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
    const relevant = question
      ? selectRelevantChunks(ctx.transcriptChunks, question)
      : ctx.transcriptChunks.slice(0, SEMANTIC_ANSWER.MAX_RELEVANT_CHUNKS);

    sections.push(`\n## Relevant Transcript Excerpts`);
    relevant.forEach((chunk, i) => {
      const speaker = chunk.speakerName || "Unknown";
      const content = chunk.content.length > SEMANTIC_ANSWER.MAX_CHUNK_DISPLAY_LENGTH
        ? chunk.content.substring(0, SEMANTIC_ANSWER.MAX_CHUNK_DISPLAY_LENGTH) + "..."
        : chunk.content;
      sections.push(`\n[${i + 1}] ${speaker}:\n"${content}"`);
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

  const [transcript, customerQuestions, actionItems, chunks] = await Promise.all([
    storage.getTranscriptById(meetingId),
    storage.getCustomerQuestionsByTranscript(meetingId),
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
    customerQuestions,
    actionItems,
    transcriptChunks: chunks,
  };

  const contextWindow = buildContextWindow(context, userQuestion);
  console.log(`[SemanticAnswer] Context window: ${contextWindow.length} chars (${chunks.length} chunks fetched)`);

  // STEP 1: Detect answer shape BEFORE prompting
  const answerShape = detectAnswerShape(userQuestion);
  console.log(`[SemanticAnswer] Detected answer shape: ${answerShape}`);

  const evidenceSources: string[] = [];
  if (customerQuestions.length > 0) evidenceSources.push("customer_questions");
  if (actionItems.length > 0) evidenceSources.push("action_items");
  if (chunks.length > 0) evidenceSources.push("transcript_chunks");
  if (leverageTeam.length > 0 || customerNames.length > 0) evidenceSources.push("attendees");

  // STEP 2: Build shape-specific prompt
  const systemPrompt = buildSemanticAnswerPrompt(answerShape);

  try {
    const response = await openai.chat.completions.create({
      model: MODEL_ASSIGNMENTS.SEMANTIC_ANSWER_SYNTHESIS,
      max_completion_tokens: 2000, // Increased from 500 to handle list-based answers with citations
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: `MEETING DATA:\n${contextWindow}\n\n---\n\nUSER QUESTION: ${userQuestion}`,
        },
      ],
    });

    console.log(`[SemanticAnswer] LLM call: ${Date.now() - startTime}ms`);
    console.log(`[SemanticAnswer] Response choices: ${response.choices?.length || 0}`);
    console.log(`[SemanticAnswer] Response finish_reason: ${response.choices?.[0]?.finish_reason}`);
    console.log(`[SemanticAnswer] Response message role: ${response.choices?.[0]?.message?.role}`);
    console.log(`[SemanticAnswer] Response content length: ${response.choices?.[0]?.message?.content?.length || 0}`);
    console.log(`[SemanticAnswer] Response refusal: ${response.choices?.[0]?.message?.refusal || 'none'}`);

    // Check for refusal (GPT-5 safety feature)
    const refusal = response.choices?.[0]?.message?.refusal;
    if (refusal) {
      console.log(`[SemanticAnswer] Model refused: ${refusal}`);
      return {
        answer: "I wasn't able to find a clear answer to that question in the meeting data.",
        confidence: "low",
        evidenceSources,
      };
    }

    const rawAnswer = response.choices[0]?.message?.content;
    if (!rawAnswer) {
      console.log(`[SemanticAnswer] Empty content - full response: ${JSON.stringify(response.choices?.[0])}`);
      return {
        answer: "I don't see this explicitly mentioned in the meeting.",
        confidence: "low",
        evidenceSources,
        answerShape,
      };
    }

    const { answer, confidence } = parseConfidence(rawAnswer);

    console.log(`[SemanticAnswer] Complete | shape=${answerShape} | confidence=${confidence} | sources=${evidenceSources.join(",")}`);

    return {
      answer,
      confidence,
      evidenceSources,
      answerShape,
    };
  } catch (error) {
    console.error(`[SemanticAnswer] LLM error:`, error);
    throw error;
  }
}
