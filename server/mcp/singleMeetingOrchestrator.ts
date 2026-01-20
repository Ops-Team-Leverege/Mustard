/**
 * Single-Meeting Orchestrator
 * 
 * Purpose:
 * Handles Slack user questions scoped to a single meeting with strict behavioral guarantees.
 * Enforces intent-safe routing and Tier-1-only data access.
 * 
 * Core Invariants:
 * - One thread = one meeting
 * - Summaries are opt-in only (never a fallback)
 * - No inference or hallucination
 * - Uncertainty must be communicated honestly
 * - Only Tier-1 capabilities allowed
 * 
 * Capability Trust Matrix:
 * - Tier 1 (Allowed): attendees, customer_questions, next_steps/commitments, raw transcript
 * - Tier 2 (Summary Only): meeting_summaries, GPT-5 (explicit opt-in)
 * - Tier 3 (Blocked): qa_pairs, searchQuestions, searchCompanyFeedback, etc.
 * 
 * Intent Classification:
 * 1. Extractive (Specific Fact) → Query Tier-1, return with evidence
 * 2. Aggregative (General but Directed) → Return curated list from Tier-1
 * 3. Summary (Explicit Only) → Generate summary only when explicitly requested
 */

import { storage } from "../storage";
import { OpenAI } from "openai";
import type { MeetingActionItem as DbActionItem } from "@shared/schema";
import { semanticAnswerSingleMeeting, type SemanticAnswerResult } from "../slack/semanticAnswerSingleMeeting";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// Orchestrator action item type (maps from DB schema)
// Tier-1: Read-only from materialized ingestion data
type OrchestratorActionItem = {
  action: string;
  owner: string;
  type: string;
  deadline: string | null;
  evidence: string;
  confidence: number;
  isPrimary: boolean;
};

export type SingleMeetingIntent = "extractive" | "aggregative" | "summary";

export type SingleMeetingContext = {
  meetingId: string;
  companyId: string;
  companyName: string;
  meetingDate?: Date | null; // Optional meeting date for display
};

export type SingleMeetingResult = {
  answer: string;
  intent: SingleMeetingIntent;
  dataSource: "attendees" | "customer_questions" | "action_items" | "transcript" | "summary" | "semantic" | "not_found";
  evidence?: string;
  pendingOffer?: "summary"; // Indicates bot offered summary, awaiting user response
  semanticAnswerUsed?: boolean;
  semanticConfidence?: "high" | "medium" | "low";
  isSemanticDebug?: boolean; // DEBUG: Track if question was classified as semantic
  semanticError?: string; // DEBUG: Capture error message if semantic layer fails
};

/**
 * Format meeting date for display in responses.
 */
function formatMeetingDate(date: Date | null | undefined): string {
  if (!date) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Get meeting date suffix for responses (e.g., " (Jan 20, 2026)")
 */
function getMeetingDateSuffix(ctx: SingleMeetingContext): string {
  if (ctx.meetingDate) {
    return ` (${formatMeetingDate(ctx.meetingDate)})`;
  }
  return "";
}

const UNCERTAINTY_RESPONSE = `I don't see this explicitly mentioned in the meeting.
If you say "yes", I'll share a brief meeting summary.`;

/**
 * Classify user question intent.
 * 
 * Intent Types:
 * - extractive: Specific fact questions (who, what specific thing, did they mention X)
 * - aggregative: General but directed questions (what issues, what concerns, what questions)
 * - summary: EXPLICIT summary requests only (summarize, overview, recap)
 * 
 * CRITICAL: Summary intent must be EXPLICIT. Questions like "What did we discuss about pricing?"
 * are EXTRACTIVE (seeking specific facts), NOT summary requests.
 */
export function classifyIntent(question: string): SingleMeetingIntent {
  const q = question.toLowerCase().trim();
  
  // SUMMARY: Only explicit summary requests
  // These patterns indicate the user wants a general narrative, not specific facts
  const summaryPatterns = [
    /\bsummar(?:y|ize|ise)\b/,           // "summarize", "summary"
    /\bgive me (?:a |an )?overview\b/,   // "give me an overview"
    /\bmeeting overview\b/,              // "meeting overview"
    /\bbrief me\b/,                      // "brief me"
    /\bcatch me up\b/,                   // "catch me up"
    /\bkey takeaways\b/,                 // "key takeaways"
    /\bmeeting recap\b/,                 // "meeting recap"
    /\bgive me (?:a |the )?rundown\b/,   // "give me a rundown"
    /\bhighlights of the meeting\b/,     // "highlights of the meeting"
  ];
  
  // Check for explicit summary request
  if (summaryPatterns.some(p => p.test(q))) {
    return "summary";
  }
  
  // "What happened" is only summary if it's standalone (no topic qualifier)
  // "What happened in the meeting?" = summary
  // "What happened with the pricing discussion?" = extractive
  if (/\bwhat happened\b/.test(q) && !/\bwhat happened (?:with|about|regarding|to|when)\b/.test(q)) {
    return "summary";
  }
  
  // AGGREGATIVE: Questions seeking a list of items (not a single fact)
  const aggregativePatterns = [
    /\bwhat issues\b/,
    /\bwhat concerns\b/,
    /\bwhat questions\b/,
    /\bwhat problems\b/,
    /\bwhat came up\b/,
    /\bwhat topics\b/,
    /\bwhat did .* raise\b/,
    /\bwhat did .* ask\b/,
    /\bopen questions\b/,
    /\bopen items\b/,
    /\ball (?:the )?questions\b/,
    /\blist (?:the |all )?questions\b/,
    /\blist (?:the |all )?concerns\b/,
    /\blist (?:the |all )?issues\b/,
    /\bconcerns (?:that )?(?:were )?raised\b/,
    /\bissues (?:that )?(?:were )?raised\b/,
    /\bquestions (?:that )?(?:were )?asked\b/,
    /\bany (?:open )?questions\b/,
    /\bany concerns\b/,
    /\bany issues\b/,
  ];
  
  if (aggregativePatterns.some(p => p.test(q))) {
    return "aggregative";
  }
  
  // Default to extractive (specific fact questions)
  return "extractive";
}

/**
 * Detect if user is asking about meeting attendees.
 * 
 * Deterministic matcher using word combinations:
 * - attend variants: attend|attended|attendee|attendees|attendance
 * - question words: who|how|anyone|was|were
 * - optional context: present|on the call|there|in the meeting
 */
function isAttendeeQuestion(question: string): boolean {
  const q = question.toLowerCase();
  
  // Direct patterns for explicit attendee keywords
  const directPatterns = [
    /\battendees?\b/,
    /\battendance\b/,
    /\bparticipants?\b/,
  ];
  if (directPatterns.some(p => p.test(q))) {
    return true;
  }
  
  // Combination matcher: (who|how|anyone|was|were) + attend variants
  const questionWords = /\b(who|how|anyone|was|were)\b/;
  const attendVariants = /\b(attend|attended|attending)\b/;
  if (questionWords.test(q) && attendVariants.test(q)) {
    return true;
  }
  
  // Presence patterns: (who|how|anyone) + (present|on the call|there|in the meeting|joined)
  const presencePatterns = [
    /\b(who|how|anyone)\b.*\b(present|there|joined)\b/,
    /\b(who|how|anyone)\b.*\bon the call\b/,
    /\b(who|how|anyone)\b.*\bin the meeting\b/,
    /\b(who|how|anyone)\b.*\bwas on\b/,
    /\bpeople\s+(?:in|on)\s+the\s+(?:meeting|call)\b/,
  ];
  
  return presencePatterns.some(p => p.test(q));
}

/**
 * Detect if user is accepting or declining a pending summary offer.
 * 
 * ACCEPTANCE: "yes", "sure", "ok", "please", "go ahead"
 * DECLINE: "no", "never mind", "nope", "nah"
 * 
 * Returns: "accept" | "decline" | null
 */
function detectOfferResponse(question: string): "accept" | "decline" | null {
  const q = question.toLowerCase().trim().replace(/[.!?,]+$/, "");
  
  // Acceptance patterns - kept simple and explicit
  const acceptPatterns = [
    /^(yes|sure|ok|okay|please|go ahead)$/,
    /^yes\s*please$/,
    /^sure\s*thing$/,
  ];
  if (acceptPatterns.some(p => p.test(q))) {
    return "accept";
  }
  
  // Decline patterns
  const declinePatterns = [
    /^(no|nope|nah|never\s*mind|no\s*thanks|cancel)$/,
  ];
  if (declinePatterns.some(p => p.test(q))) {
    return "decline";
  }
  
  return null;
}

/**
 * Detect if user is asking about action items/next steps/commitments.
 */
function isActionItemQuestion(question: string): boolean {
  const q = question.toLowerCase();
  const patterns = [
    /\bnext\s*steps?\b/,
    /\baction\s*items?\b/,
    /\bto-?dos?\b/,
    /\bfollow[\s-]*ups?\b/,
    /\bcommitments?\b/,
    /\bwhat did we agree/,
    /\bwho is doing what/,
    /\bwho'?s responsible/,
    /\bwhat needs to happen/,
    /\bwhat'?s next\b/,
  ];
  return patterns.some(p => p.test(q));
}

// Common stop words to exclude from keyword matching
const STOP_WORDS = new Set([
  "what", "when", "where", "which", "that", "this", "from", "with", "about",
  "were", "have", "been", "does", "will", "would", "could", "should", "there",
  "their", "they", "your", "just", "some", "into", "more", "also", "than",
  "only", "other", "then", "after", "before", "being", "very", "like", "over",
  // Days of week
  "friday", "monday", "tuesday", "wednesday", "thursday", "saturday", "sunday",
  // Common question words
  "issue", "issues", "problem", "problems", "experienced", "happening",
]);

/**
 * Extract meaningful keywords from a query.
 * Filters out stop words and short words.
 * Prioritizes proper nouns (capitalized words in original query).
 */
function extractKeywords(query: string): { keywords: string[]; properNouns: string[] } {
  const words = query.split(/\s+/);
  
  // Find proper nouns (capitalized words that aren't at sentence start)
  const properNouns = words
    .filter((w, i) => i > 0 && /^[A-Z][a-z]+$/.test(w))
    .map(w => w.toLowerCase());
  
  // Extract general keywords
  const keywords = query.toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w));
  
  return { keywords, properNouns };
}

/**
 * Lookup customer questions for a specific meeting.
 * Returns questions from the high-trust customer_questions table only.
 * 
 * This is strictly meeting-scoped and does NOT use searchQuestions or cross-meeting logic.
 * 
 * SEARCH STRATEGY:
 * 1. Prioritize matches containing proper nouns from the query
 * 2. Fall back to general keyword matches (excluding stop words)
 * 3. Return empty if no meaningful matches found
 */
async function lookupCustomerQuestions(
  meetingId: string,
  userQuestion?: string
): Promise<Array<{
  questionText: string;
  askedByName: string | null;
  status: string;
  answerEvidence: string | null;
  answeredByName: string | null;
  contextBefore: string | null;
}>> {
  const questions = await storage.getCustomerQuestionsByTranscript(meetingId);
  
  if (!userQuestion) {
    return questions;
  }
  
  const { keywords, properNouns } = extractKeywords(userQuestion);
  
  // If we have proper nouns, prioritize questions mentioning them
  if (properNouns.length > 0) {
    const properNounMatches = questions.filter(cq => {
      const text = cq.questionText.toLowerCase();
      return properNouns.some(noun => text.includes(noun));
    });
    
    if (properNounMatches.length > 0) {
      return properNounMatches;
    }
  }
  
  // Fall back to general keyword matching
  if (keywords.length === 0) {
    return [];
  }
  
  return questions.filter(cq => {
    const text = cq.questionText.toLowerCase();
    return keywords.some(kw => text.includes(kw));
  });
}

/**
 * Get meeting attendees from transcript metadata.
 */
async function getMeetingAttendees(
  meetingId: string
): Promise<{ leverageTeam: string[]; customerNames: string[] }> {
  const transcript = await storage.getTranscriptById(meetingId);
  if (!transcript) {
    return { leverageTeam: [], customerNames: [] };
  }
  
  const leverageTeam = transcript.leverageTeam
    ? transcript.leverageTeam.split(",").map(s => s.trim()).filter(Boolean)
    : [];
  const customerNames = transcript.customerNames
    ? transcript.customerNames.split(",").map(s => s.trim()).filter(Boolean)
    : [];
  
  return { leverageTeam, customerNames };
}

/**
 * Get action items/commitments for a meeting.
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 * INVARIANT: meeting_action_items are Tier-1 artifacts materialized at ingestion.
 * Slack paths must NEVER trigger action item extraction (extractMeetingActionStates).
 * This function is READ-ONLY - it queries the database, no LLM calls.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
async function getMeetingActionItems(
  meetingId: string
): Promise<OrchestratorActionItem[]> {
  console.log(`[SingleMeetingOrchestrator] Reading action items for meeting ${meetingId} from database (READ-ONLY, no LLM)`);
  
  const dbItems = await storage.getMeetingActionItemsByTranscript(meetingId);
  
  // Map from DB schema to orchestrator format
  return dbItems.map(item => ({
    action: item.actionText,
    owner: item.ownerName,
    type: item.actionType,
    deadline: item.deadline,
    evidence: item.evidenceQuote,
    confidence: item.confidence,
    isPrimary: item.isPrimary,
  }));
}

/**
 * Search action items for explicitly named issues or events relevant to the question.
 * 
 * RULE: Action items are checked whenever the question asks about an issue, problem,
 * blocker, error, or incident — regardless of whether the user says "next steps".
 * 
 * This ensures that documented follow-ups and commitments are surfaced when users
 * ask fact-seeking questions about specific events or issues discussed in the meeting.
 */
async function searchActionItemsForRelevantIssues(
  meetingId: string,
  query: string
): Promise<OrchestratorActionItem[]> {
  const actionItems = await getMeetingActionItems(meetingId);
  
  if (actionItems.length === 0) {
    return [];
  }
  
  const { keywords, properNouns } = extractKeywords(query);
  
  // Prioritize action items mentioning proper nouns
  if (properNouns.length > 0) {
    const properNounMatches = actionItems.filter(item => {
      const searchText = `${item.action} ${item.evidence} ${item.owner}`.toLowerCase();
      return properNouns.some(noun => searchText.includes(noun));
    });
    
    if (properNounMatches.length > 0) {
      return properNounMatches;
    }
  }
  
  // Fall back to general keyword matching
  if (keywords.length === 0) {
    return [];
  }
  
  // Match action items that contain at least one keyword in action text or evidence
  const matches = actionItems.filter(item => {
    const searchText = `${item.action} ${item.evidence} ${item.owner}`.toLowerCase();
    return keywords.some(kw => searchText.includes(kw));
  });
  
  return matches;
}

/**
 * Search transcript chunks for verbatim evidence.
 * Returns raw transcript snippets only - no summarization.
 * 
 * SEARCH STRATEGY:
 * 1. Prioritize matches containing proper nouns (e.g., "Brian")
 * 2. Fall back to general keyword matches
 * 3. Require at least one meaningful keyword match
 */
async function searchTranscriptSnippets(
  meetingId: string,
  query: string,
  limit: number = 3
): Promise<Array<{
  speakerName: string;
  content: string;
  chunkIndex: number;
}>> {
  const chunks = await storage.getChunksForTranscript(meetingId, 1000);
  
  const { keywords, properNouns } = extractKeywords(query);
  
  // If we have proper nouns, prioritize chunks containing them
  if (properNouns.length > 0) {
    const properNounMatches = chunks.filter(chunk => {
      const content = chunk.content.toLowerCase();
      return properNouns.some(noun => content.includes(noun));
    });
    
    if (properNounMatches.length > 0) {
      return properNounMatches.slice(0, limit).map(chunk => ({
        speakerName: chunk.speakerName || "Unknown",
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
      }));
    }
  }
  
  // Fall back to general keyword matching (must match at least one keyword)
  if (keywords.length === 0) {
    return [];
  }
  
  const matches = chunks
    .filter(chunk => {
      const content = chunk.content.toLowerCase();
      return keywords.some(kw => content.includes(kw));
    })
    .slice(0, limit)
    .map(chunk => ({
      speakerName: chunk.speakerName || "Unknown",
      content: chunk.content,
      chunkIndex: chunk.chunkIndex,
    }));
  
  return matches;
}

/**
 * Handle extractive intent (specific fact questions).
 * 
 * EXTRACTIVE SEARCH ORDER (LOCKED):
 * 1. Attendees — who was present (if attendee question)
 * 2. Customer questions — what customers asked (high-trust, verbatim)
 * 3. Action items / commitments — explicit issues, follow-ups, and named events
 * 4. Transcript snippets — last resort, verbatim evidence
 * 
 * If not found → Return uncertainty response
 * 
 * NOTE: Action items are checked whenever the question asks about issues, problems,
 * blockers, errors, or incidents — regardless of whether user says "next steps".
 * 
 * PERFORMANCE: Uses parallel fetching to minimize Neon round-trips.
 * Only fetches what's needed based on question type detection.
 */
async function handleExtractiveIntent(
  ctx: SingleMeetingContext,
  question: string
): Promise<SingleMeetingResult> {
  const startTime = Date.now();
  
  // Detect question type FIRST to minimize unnecessary DB calls
  const isAttendee = isAttendeeQuestion(question);
  const isAction = isActionItemQuestion(question);
  
  // FAST PATH: Attendee questions only need transcript metadata
  if (isAttendee) {
    console.log(`[SingleMeetingOrchestrator] Fast path: attendee question`);
    const { leverageTeam, customerNames } = await getMeetingAttendees(ctx.meetingId);
    console.log(`[SingleMeetingOrchestrator] Attendee fetch: ${Date.now() - startTime}ms`);
    
    if (leverageTeam.length === 0 && customerNames.length === 0) {
      return {
        answer: UNCERTAINTY_RESPONSE,
        intent: "extractive",
        dataSource: "not_found",
      };
    }
    
    const lines: string[] = [];
    lines.push(`*Meeting Attendees (${ctx.companyName})*`);
    if (leverageTeam.length > 0) {
      lines.push(`\n*Leverege Team:* ${leverageTeam.join(", ")}`);
    }
    if (customerNames.length > 0) {
      lines.push(`*Customer:* ${customerNames.join(", ")}`);
    }
    
    return {
      answer: lines.join("\n"),
      intent: "extractive",
      dataSource: "attendees",
    };
  }
  
  // FAST PATH: Action item questions only need action items
  if (isAction) {
    console.log(`[SingleMeetingOrchestrator] Fast path: action item question`);
    const actionItems = await getMeetingActionItems(ctx.meetingId);
    console.log(`[SingleMeetingOrchestrator] Action items fetch: ${Date.now() - startTime}ms`);
    
    if (actionItems.length === 0) {
      const dateSuffix = getMeetingDateSuffix(ctx);
      return {
        answer: `No explicit action items were identified in this meeting${dateSuffix}.`,
        intent: "extractive",
        dataSource: "action_items",
      };
    }
    
    const lines: string[] = [];
    const dateSuffix = getMeetingDateSuffix(ctx);
    lines.push(`*Next Steps — ${ctx.companyName}${dateSuffix}*`);
    actionItems.forEach(item => {
      let formattedItem = `• ${item.action} — ${item.owner}`;
      if (item.deadline && item.deadline !== "Not specified") {
        formattedItem += ` _(${item.deadline})_`;
      }
      lines.push(formattedItem);
      lines.push(`  _"${item.evidence}"_`);
    });
    
    return {
      answer: lines.join("\n"),
      intent: "extractive",
      dataSource: "action_items",
    };
  }
  
  // GENERAL PATH: Fetch customer questions and action items in PARALLEL
  // Treat as "term lookup" - prefer action items and customer questions (cleanest nouns)
  console.log(`[SingleMeetingOrchestrator] General path: parallel fetch`);
  const [customerQuestions, actionItems] = await Promise.all([
    lookupCustomerQuestions(ctx.meetingId, question),
    getMeetingActionItems(ctx.meetingId),
  ]);
  console.log(`[SingleMeetingOrchestrator] Parallel fetch complete: ${Date.now() - startTime}ms`);
  
  // Extract keywords for scoring
  const { keywords, properNouns } = extractKeywords(question);
  const allKeywords = Array.from(new Set([...properNouns, ...keywords]));
  const hasProperNouns = properNouns.length > 0;
  
  console.log(`[SingleMeetingOrchestrator] Keywords: ${keywords.join(", ")} | Proper nouns: ${properNouns.join(", ")}`);
  
  // Score function with STRONG MATCH requirement:
  // If query contains proper nouns, candidate MUST match at least one proper noun
  // Returns -1 if strong match requirement not met (filtered out)
  const scoreMatch = (text: string): number => {
    const lowerText = text.toLowerCase();
    
    // Strong match: If query has proper nouns, require at least one to match
    if (hasProperNouns) {
      const matchesProperNoun = properNouns.some(pn => lowerText.includes(pn));
      if (!matchesProperNoun) {
        return -1; // Reject - doesn't match any proper noun
      }
    }
    
    // Score by total keyword matches
    return allKeywords.filter(kw => lowerText.includes(kw)).length;
  };
  
  // Score action items FIRST (preferred for term lookups)
  const scoredActionItems = actionItems.map(ai => ({
    item: ai,
    score: scoreMatch(`${ai.action} ${ai.evidence} ${ai.owner}`),
  })).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  
  // Score customer questions
  const scoredCustomerQuestions = customerQuestions.map(cq => ({
    item: cq,
    score: scoreMatch(cq.questionText + " " + (cq.answerEvidence || "")),
  })).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  
  // Pick the best match - action items win ties since they contain cleaner term definitions
  const bestAI = scoredActionItems[0];
  const bestCQ = scoredCustomerQuestions[0];
  
  // Action items preferred for term lookups (contain cleaner nouns)
  if (bestAI && (!bestCQ || bestAI.score >= bestCQ.score)) {
    // Tier-1 compliant framing: "In this meeting, X references..." + quote
    const item = bestAI.item;
    const dateSuffix = getMeetingDateSuffix(ctx);
    const lines: string[] = [];
    lines.push(`In this meeting${dateSuffix}, the next steps reference the following:`);
    lines.push(`\n_"${item.evidence}"_`);
    let formattedItem = `\n• ${item.action} — ${item.owner}`;
    if (item.deadline && item.deadline !== "Not specified") {
      formattedItem += ` _(${item.deadline})_`;
    }
    lines.push(formattedItem);
    
    return {
      answer: lines.join("\n"),
      intent: "extractive",
      dataSource: "action_items",
      evidence: item.evidence,
    };
  }
  
  if (bestCQ) {
    const match = bestCQ.item;
    const dateSuffix = getMeetingDateSuffix(ctx);
    const lines: string[] = [];
    lines.push(`In this meeting${dateSuffix}, a customer question referenced this:`);
    lines.push(`\n_"${match.questionText}"_`);
    if (match.askedByName) {
      lines.push(`— ${match.askedByName}`);
    }
    if (match.status === "ANSWERED" && match.answerEvidence) {
      lines.push(`\n*Answer provided:* ${match.answerEvidence}`);
      if (match.answeredByName) {
        lines.push(`— ${match.answeredByName}`);
      }
    } else if (match.status === "OPEN") {
      lines.push(`\n_This question was left open in the meeting._`);
    }
    
    return {
      answer: lines.join("\n"),
      intent: "extractive",
      dataSource: "customer_questions",
      evidence: match.questionText,
    };
  }
  
  // FALLBACK: Transcript snippets (only fetch if needed - priority 4)
  // Only fall back to transcript if we have proper nouns to match
  if (hasProperNouns) {
    console.log(`[SingleMeetingOrchestrator] Fallback: transcript search (proper noun required)`);
    const snippets = await searchTranscriptSnippets(ctx.meetingId, question);
    console.log(`[SingleMeetingOrchestrator] Transcript fetch: ${Date.now() - startTime}ms`);
    
    // Filter snippets to only those matching at least one proper noun
    const matchingSnippets = snippets.filter(s => {
      const lowerContent = s.content.toLowerCase();
      return properNouns.some(pn => lowerContent.includes(pn));
    });
    
    if (matchingSnippets.length > 0) {
      const dateSuffix = getMeetingDateSuffix(ctx);
      const lines: string[] = [];
      lines.push(`In this meeting${dateSuffix}, the transcript mentions:`);
      matchingSnippets.slice(0, 2).forEach(s => {
        lines.push(`\n_"${s.content.substring(0, 200)}${s.content.length > 200 ? '...' : ''}"_`);
        lines.push(`— ${s.speakerName}`);
      });
      
      return {
        answer: lines.join("\n"),
        intent: "extractive",
        dataSource: "transcript",
        evidence: matchingSnippets[0].content,
      };
    }
  } else {
    // No proper nouns - skip transcript search entirely
    console.log(`[SingleMeetingOrchestrator] Skipping transcript fallback (no proper nouns to match)`);
  }
  
  return {
    answer: UNCERTAINTY_RESPONSE,
    intent: "extractive",
    dataSource: "not_found",
  };
}

/**
 * Handle aggregative intent (general but directed questions).
 * Returns curated lists from Tier-1 data, no narrative summary.
 * 
 * PERFORMANCE: Detects question type first, fetches only what's needed.
 */
async function handleAggregativeIntent(
  ctx: SingleMeetingContext,
  question: string
): Promise<SingleMeetingResult> {
  const startTime = Date.now();
  const q = question.toLowerCase();
  
  // Detect what type of aggregation is requested
  const wantsQuestions = /\bquestions?\b/.test(q) || /\bask/.test(q);
  const wantsConcerns = /\bissues?\b/.test(q) || /\bconcerns?\b/.test(q) || /\bproblems?\b/.test(q);
  
  // FAST PATH: Questions about customer questions - only fetch customer_questions
  if (wantsQuestions) {
    console.log(`[SingleMeetingOrchestrator] Aggregative: customer questions`);
    const customerQuestions = await lookupCustomerQuestions(ctx.meetingId);
    console.log(`[SingleMeetingOrchestrator] Customer questions fetch: ${Date.now() - startTime}ms`);
    
    if (customerQuestions.length === 0) {
      return {
        answer: UNCERTAINTY_RESPONSE,
        intent: "aggregative",
        dataSource: "not_found",
      };
    }
    
    const lines: string[] = [];
    lines.push(`*Customer Questions from the meeting with ${ctx.companyName}:*`);
    
    const openQuestions = customerQuestions.filter(q => q.status === "OPEN");
    const answeredQuestions = customerQuestions.filter(q => q.status === "ANSWERED");
    
    if (openQuestions.length > 0) {
      lines.push("\n*Open Questions:*");
      openQuestions.forEach(q => {
        lines.push(`• "${q.questionText}"${q.askedByName ? ` — ${q.askedByName}` : ""}`);
      });
    }
    
    if (answeredQuestions.length > 0) {
      lines.push("\n*Answered Questions:*");
      answeredQuestions.slice(0, 5).forEach(q => {
        lines.push(`• "${q.questionText}"${q.askedByName ? ` — ${q.askedByName}` : ""}`);
      });
      if (answeredQuestions.length > 5) {
        lines.push(`_...and ${answeredQuestions.length - 5} more_`);
      }
    }
    
    return {
      answer: lines.join("\n"),
      intent: "aggregative",
      dataSource: "customer_questions",
    };
  }
  
  // FAST PATH: Questions about issues/concerns - fetch customer_questions and filter
  if (wantsConcerns) {
    console.log(`[SingleMeetingOrchestrator] Aggregative: concerns/issues`);
    const customerQuestions = await lookupCustomerQuestions(ctx.meetingId);
    console.log(`[SingleMeetingOrchestrator] Customer questions fetch: ${Date.now() - startTime}ms`);
    
    const concernQuestions = customerQuestions.filter(cq => {
      const text = cq.questionText.toLowerCase();
      return /concern|issue|problem|worry|risk|challenge|difficult|block/.test(text);
    });
    
    if (concernQuestions.length === 0) {
      return {
        answer: UNCERTAINTY_RESPONSE,
        intent: "aggregative",
        dataSource: "not_found",
      };
    }
    
    const lines: string[] = [];
    lines.push(`*Concerns raised in the meeting with ${ctx.companyName}:*`);
    concernQuestions.forEach(q => {
      lines.push(`• "${q.questionText}"${q.askedByName ? ` — ${q.askedByName}` : ""}`);
    });
    
    return {
      answer: lines.join("\n"),
      intent: "aggregative",
      dataSource: "customer_questions",
    };
  }
  
  // FALLBACK: General aggregative - only fetch action items
  console.log(`[SingleMeetingOrchestrator] Aggregative: general (action items)`);
  const actionItems = await getMeetingActionItems(ctx.meetingId);
  console.log(`[SingleMeetingOrchestrator] Action items fetch: ${Date.now() - startTime}ms`);
  
  if (actionItems.length > 0) {
    const lines: string[] = [];
    lines.push(`*Items from the meeting with ${ctx.companyName}:*`);
    actionItems.forEach(item => {
      lines.push(`• ${item.action} — ${item.owner}`);
    });
    
    return {
      answer: lines.join("\n"),
      intent: "aggregative",
      dataSource: "action_items",
    };
  }
  
  return {
    answer: UNCERTAINTY_RESPONSE,
    intent: "aggregative",
    dataSource: "not_found",
  };
}

/**
 * Handle summary intent (explicit opt-in only).
 * Uses GPT-5 for narrative summary generation.
 */
async function handleSummaryIntent(
  ctx: SingleMeetingContext
): Promise<SingleMeetingResult> {
  const chunks = await storage.getChunksForTranscript(ctx.meetingId, 100);
  
  if (chunks.length === 0) {
    return {
      answer: "I couldn't find any transcript content for this meeting.",
      intent: "summary",
      dataSource: "not_found",
    };
  }
  
  const transcript = chunks
    .map(c => `[${c.speakerName || "Unknown"}]: ${c.content}`)
    .join("\n\n");
  
  const response = await openai.chat.completions.create({
    model: "gpt-5",
    messages: [
      {
        role: "system",
        content: `You are summarizing a business meeting transcript.
Provide a concise summary including:
- Main purpose of the meeting
- Key topics discussed
- Important decisions or outcomes
- Any open questions or concerns raised

Keep the summary factual and grounded in what was actually discussed.
Format with Slack markdown (*bold* for headers, bullet points for lists).`,
      },
      {
        role: "user",
        content: `Summarize this meeting transcript:\n\n${transcript.substring(0, 15000)}`,
      },
    ],
  });
  
  const summary = response.choices[0]?.message?.content || "Unable to generate summary.";
  
  return {
    answer: `*Meeting Summary (${ctx.companyName})*\n\n${summary}`,
    intent: "summary",
    dataSource: "summary",
  };
}

/**
 * Detect if a question is a semantic question that benefits from LLM interpretation.
 * These are questions that:
 * - Ask about abstract concepts ("any hardware device", "appliance", "piece of hardware")
 * - Ask about implications or interpretations
 * - Use vague language that requires context understanding
 * - Reference things discussed ("they were talking about", "mentioned")
 */
function isSemanticQuestion(question: string): boolean {
  const q = question.toLowerCase();
  const semanticPatterns = [
    // "any X device/hardware/etc"
    /\bany\s+\w+\s+(device|product|hardware|software|system|tool|appliance)\b/,
    // "what was the piece/type/kind of X" - specific vague referents
    /\bwhat\s+(?:is|was)\s+(?:the|a)\s+(?:piece|type|kind|sort)\s+of\b/,
    // "did they talk/discuss/mention about"
    /\bdid\s+(?:they|we|anyone)\s+(?:talk|discuss|mention|say)\s+(?:about|anything)\b/,
    // "what did/was X's issue/problem"
    /\bwhat\s+(?:did|was)\s+\w+(?:'s|s)?\s+(?:issue|problem|concern|question)\b/,
    // "what kind/type/sort of"
    /\bwhat\s+(?:kind|type|sort)\s+of\b/,
    // "anything about/related/regarding"
    /\banything\s+(?:about|related|regarding)\b/,
    // "they were talking about" / "they mentioned" / "they discussed"
    /\b(?:they|we|you)\s+(?:were\s+)?(?:talking|discussed|mentioned|said)\s+(?:about)?\b/,
    // Hardware/device/appliance terms with discussion context
    /\b(?:hardware|device|appliance|equipment)\b.*\b(?:talking|mentioned|discussed|using)\b/,
    /\b(?:talking|mentioned|discussed|using)\b.*\b(?:hardware|device|appliance|equipment)\b/,
    // "what X were they talking about" / "what X did they mention"
    /\bwhat\s+\w+\s+(?:were\s+)?(?:they|we|you)\s+(?:talking|discussing|mentioning)\b/,
    // "the thing/stuff they mentioned/discussed"
    /\b(?:the\s+)?(?:thing|stuff|item)\s+(?:they|we|you)\s+(?:mentioned|discussed|talked)\b/,
  ];
  return semanticPatterns.some(p => p.test(q));
}

/**
 * Main orchestrator entry point.
 * 
 * Classifies intent and routes to appropriate handler.
 * 
 * Processing Flow:
 * 1. Check for offer responses (if pending)
 * 2. Classify intent (extractive/aggregative/summary)
 * 3. Try Tier-1 deterministic lookup
 * 4. If Tier-1 fails AND question is semantic → use LLM semantic answer (Step 6)
 * 5. If still no answer → return uncertainty with offer
 * 
 * @param ctx - Single meeting context (meetingId, companyName, meetingDate)
 * @param question - User's question text
 * @param hasPendingOffer - Whether the previous interaction offered a summary (from interaction_logs)
 */
export async function handleSingleMeetingQuestion(
  ctx: SingleMeetingContext,
  question: string,
  hasPendingOffer: boolean = false
): Promise<SingleMeetingResult> {
  console.log(`[SingleMeetingOrchestrator] Processing question for meeting ${ctx.meetingId}`);
  console.log(`[SingleMeetingOrchestrator] Question: "${question.substring(0, 100)}..." | pendingOffer: ${hasPendingOffer}`);
  
  // Check for offer responses first (only if there's a pending offer)
  if (hasPendingOffer) {
    const offerResponse = detectOfferResponse(question);
    if (offerResponse === "accept") {
      console.log(`[SingleMeetingOrchestrator] User accepted pending offer - triggering summary`);
      return handleSummaryIntent(ctx);
    }
    if (offerResponse === "decline") {
      console.log(`[SingleMeetingOrchestrator] User declined pending offer`);
      return {
        answer: "No problem! Let me know if you have other questions about this meeting.",
        intent: "extractive",
        dataSource: "not_found",
      };
    }
  }
  
  const intent = classifyIntent(question);
  const isSemantic = isSemanticQuestion(question);
  console.log(`[SingleMeetingOrchestrator] VERSION=2026-01-20-v3 | intent: ${intent} | isSemantic: ${isSemantic}`);
  console.log(`[SingleMeetingOrchestrator] DEBUG: Question for semantic check: "${question}"`);
  
  switch (intent) {
    case "extractive": {
      const result = await handleExtractiveIntent(ctx, question);
      
      // STEP 6: If Tier-1 fails AND question is semantic → use LLM semantic answer
      console.log(`[SingleMeetingOrchestrator] STEP6-CHECK: dataSource=${result.dataSource}, isSemantic=${isSemantic}, shouldTrigger=${result.dataSource === "not_found" && isSemantic}`);
      let semanticError: string | undefined;
      if (result.dataSource === "not_found" && isSemantic) {
        console.log(`[SingleMeetingOrchestrator] STEP6-TRIGGER: Entering semantic answer layer`);
        try {
          console.log(`[SingleMeetingOrchestrator] STEP6-CALL: About to call semanticAnswerSingleMeeting...`);
          const semanticResult = await semanticAnswerSingleMeeting(
            ctx.meetingId,
            ctx.companyName,
            question,
            ctx.meetingDate
          );
          console.log(`[SingleMeetingOrchestrator] STEP6-SUCCESS: Got semantic result with confidence=${semanticResult.confidence}`);
          return {
            answer: semanticResult.answer,
            intent: "extractive",
            dataSource: "semantic",
            semanticAnswerUsed: true,
            semanticConfidence: semanticResult.confidence,
            isSemanticDebug: true,
          };
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error(`[SingleMeetingOrchestrator] STEP6-ERROR: Semantic answer failed: ${errorMsg}`);
          console.error(`[SingleMeetingOrchestrator] STEP6-ERROR-STACK:`, err);
          semanticError = errorMsg;
          // Fall through to uncertainty response
        }
      } else {
        console.log(`[SingleMeetingOrchestrator] STEP6-SKIP: Not triggering because dataSource=${result.dataSource} or isSemantic=${isSemantic}`);
      }
      
      // If still not found, offer summary
      if (result.dataSource === "not_found") {
        return { ...result, pendingOffer: "summary", isSemanticDebug: isSemantic, semanticError };
      }
      return { ...result, isSemanticDebug: isSemantic, semanticError };
    }
    
    case "aggregative": {
      const result = await handleAggregativeIntent(ctx, question);
      let aggSemanticError: string | undefined;
      
      // STEP 6: If Tier-1 fails AND question is semantic → use LLM semantic answer
      if (result.dataSource === "not_found" && isSemantic) {
        console.log(`[SingleMeetingOrchestrator] Step 6: Semantic answer layer (aggregative, Tier-1 failed)`);
        try {
          const semanticResult = await semanticAnswerSingleMeeting(
            ctx.meetingId,
            ctx.companyName,
            question,
            ctx.meetingDate
          );
          return {
            answer: semanticResult.answer,
            intent: "aggregative",
            dataSource: "semantic",
            semanticAnswerUsed: true,
            semanticConfidence: semanticResult.confidence,
            isSemanticDebug: true,
          };
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error(`[SingleMeetingOrchestrator] Semantic answer failed (aggregative): ${errorMsg}`);
          aggSemanticError = errorMsg;
          // Fall through to uncertainty response
        }
      }
      
      // If still not found, offer summary
      if (result.dataSource === "not_found") {
        return { ...result, pendingOffer: "summary", isSemanticDebug: isSemantic, semanticError: aggSemanticError };
      }
      return { ...result, isSemanticDebug: isSemantic, semanticError: aggSemanticError };
    }
    
    case "summary":
      const summaryResult = await handleSummaryIntent(ctx);
      return { ...summaryResult, isSemanticDebug: isSemantic };
    
    default:
      return {
        answer: UNCERTAINTY_RESPONSE,
        intent: "extractive",
        dataSource: "not_found",
        pendingOffer: "summary",
        isSemanticDebug: isSemantic,
      };
  }
}
