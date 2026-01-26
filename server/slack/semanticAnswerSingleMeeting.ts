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
    /\baction items?\b/,
    /\bwhat (?:are|were) the\b.*\b(?:steps|items|actions|tasks|issues|concerns|questions)\b/,
    /\blist\b/,
    /\bopen questions\b/,
    /\bopen items\b/,
    /\bfollow[- ]?ups?\b/,
    /\bwhat issues\b/,
    /\bwhat concerns\b/,
    /\bwhat questions\b/,
    /\bwhat problems\b/,
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

/**
 * Global "DO NOT" rules for all prompts.
 * These reduce variability and make outputs stable.
 */
const GLOBAL_DONOT_RULES = `
STRICT RULES (DO NOT VIOLATE):
- Do NOT explain your reasoning
- Do NOT quote long transcript passages unless specifically asked
- Do NOT replace a direct answer with context
- Do NOT apologize for missing information
- Do NOT say "I couldn't generate an answer" or "I wasn't able to"
- Do NOT summarize unless the user explicitly asked for a summary
- Do NOT mention other meetings
- You may ONLY use the provided meeting data`;

/**
 * Build shape-specific system prompt.
 * Prompts only decide HOW to say it, not WHAT the answer is.
 */
function buildSystemPrompt(shape: AnswerShape): string {
  const basePrompt = `You are answering a question about a single meeting.
Use Slack markdown formatting (*bold* for emphasis, _italics_ for quotes).`;

  let shapeInstructions: string;
  
  switch (shape) {
    case "single_value":
      shapeInstructions = `
ANSWER FORMAT: Single Value
The user asked a specific factual question (which/where/who/when).
The direct answer is already in the meeting data.

RESPOND WITH:
- The direct answer only
- One short sentence
- Do NOT summarize
- Do NOT quote context
- Do NOT explain unless the user asks why

Example good response: "It was Store 2."
Example bad response: "Based on the meeting discussion about store locations, it appears that..."`;
      break;
      
    case "yes_no":
      shapeInstructions = `
ANSWER FORMAT: Yes/No
The user asked a yes/no question.

RESPOND WITH:
- Answer yes or no FIRST
- Add the key fact (e.g., date, name)
- Then optionally offer more detail
- Do NOT include a summary unless explicitly requested

Example good response:
"Yes — there was a meeting with Walmart on October 29, 2025.
Would you like a brief summary?"

Example bad response:
"The meeting with Walmart covered several topics including..."`;
      break;
      
    case "list":
      shapeInstructions = `
ANSWER FORMAT: List
The user asked for a list of items (next steps, attendees, etc).

RESPOND WITH:
- A structured bullet list
- Do not paraphrase unnecessarily
- Do not add interpretation
- Only include items explicitly present in the data

Example good response:
"*Next Steps:*
• Send camera specs to Ron — Ryan
• Schedule follow-up call — Spencer"`;
      break;
      
    case "summary":
      shapeInstructions = `
ANSWER FORMAT: Summary
The user explicitly requested a summary.

RESPOND WITH:
- A concise summary of the meeting
- Do not introduce new facts
- Clearly label it as a summary
- Focus on key points, decisions, and outcomes`;
      break;
  }

  return `${basePrompt}
${shapeInstructions}
${GLOBAL_DONOT_RULES}

CONFIDENCE ASSESSMENT:
At the end of your response, on a new line, add exactly one of:
[CONFIDENCE: high] - Answer is directly supported by meeting data
[CONFIDENCE: medium] - Answer is reasonably inferred from context
[CONFIDENCE: low] - Answer is uncertain, partial, OR the information was not found in the meeting data`;
}

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
    sections.push(`\n## Relevant Transcript Excerpts`);
    ctx.transcriptChunks.slice(0, 5).forEach((chunk, i) => {
      const speaker = chunk.speakerName || "Unknown";
      const content = chunk.content.length > 500 
        ? chunk.content.substring(0, 500) + "..." 
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
    storage.getChunksForTranscript(meetingId, 10),
  ]);
  
  console.log(`[SemanticAnswer] Data fetch: ${Date.now() - startTime}ms`);
  
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
  
  const contextWindow = buildContextWindow(context);
  console.log(`[SemanticAnswer] Context window: ${contextWindow.length} chars`);
  
  // STEP 1: Detect answer shape BEFORE prompting
  const answerShape = detectAnswerShape(userQuestion);
  console.log(`[SemanticAnswer] Detected answer shape: ${answerShape}`);
  
  const evidenceSources: string[] = [];
  if (customerQuestions.length > 0) evidenceSources.push("customer_questions");
  if (actionItems.length > 0) evidenceSources.push("action_items");
  if (chunks.length > 0) evidenceSources.push("transcript_chunks");
  if (leverageTeam.length > 0 || customerNames.length > 0) evidenceSources.push("attendees");
  
  // STEP 2: Build shape-specific prompt
  const systemPrompt = buildSystemPrompt(answerShape);
  
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5",
      max_completion_tokens: 500,
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
