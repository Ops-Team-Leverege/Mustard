/**
 * Single-Meeting Orchestrator
 * 
 * Purpose:
 * Handles Slack user questions scoped to a single meeting with strict behavioral guarantees.
 * Enforces intent-safe routing with read-only artifact access.
 * 
 * Core Invariants:
 * - One thread = one meeting
 * - Summaries are opt-in only (never a fallback)
 * - No inference or hallucination
 * - Uncertainty must be communicated honestly
 * - Only read-only meeting artifacts allowed
 * 
 * Data Access Layers:
 * - Meeting Artifacts (Allowed): attendees, customer_questions, next_steps/commitments, raw transcript
 * - Semantic Layer (Summary Only): meeting_summaries, GPT-5 (explicit opt-in)
 * - Extended Search (Blocked): qa_pairs, searchQuestions, searchCompanyFeedback, etc.
 * 
 * IMPORTANT: Intent Classification Authority
 * The Control Plane (server/controlPlane/intent.ts) is the SOLE authority for intent classification.
 * This orchestrator receives contracts from the Control Plane and executes them verbatim.
 * 
 * Internal routing (extractive/aggregative/summary) is derived from Control Plane contracts:
 * - EXTRACTIVE_FACT, ATTENDEES, CUSTOMER_QUESTIONS, NEXT_STEPS → extractive handler
 * - AGGREGATIVE_LIST → aggregative handler
 * - MEETING_SUMMARY → summary handler
 * 
 * Legacy internal classification is retained for backward compatibility with direct Slack calls
 * but should be migrated to Control Plane routing.
 */

import { storage } from "../storage";
import { OpenAI } from "openai";
import type { MeetingActionItem as DbActionItem } from "@shared/schema";
import { semanticAnswerSingleMeeting, type SemanticAnswerResult } from "../slack/semanticAnswerSingleMeeting";
import { AnswerContract } from "../controlPlane/answerContracts";
import { getComprehensiveProductKnowledge, formatProductKnowledgeForPrompt } from "../airtable/productData";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// Orchestrator action item type (maps from DB schema)
// Read-only from materialized ingestion data (meeting artifacts)
type OrchestratorActionItem = {
  action: string;
  owner: string;
  type: string;
  deadline: string | null;
  evidence: string;
  confidence: number;
  isPrimary: boolean;
};

/**
 * Internal handler type (derived from Control Plane contracts)
 * 
 * NOTE: This is NOT intent classification. The Control Plane has already classified intent
 * and selected a contract. This type represents which internal handler to use.
 * 
 * @deprecated Direct use is discouraged. Prefer receiving contracts from Control Plane.
 */
type InternalHandlerType = "extractive" | "aggregative" | "summary" | "drafting";

export type SingleMeetingContext = {
  meetingId: string;
  companyId: string;
  companyName: string;
  meetingDate?: Date | null; // Optional meeting date for display
};

export type SingleMeetingResult = {
  answer: string;
  intent: InternalHandlerType;
  dataSource: "attendees" | "customer_questions" | "action_items" | "transcript" | "summary" | "semantic" | "not_found" | "clarification" | "binary_answer";
  evidence?: string;
  pendingOffer?: "summary"; // Indicates bot offered summary, awaiting user response
  semanticAnswerUsed?: boolean;
  semanticConfidence?: "high" | "medium" | "low";
  isSemanticDebug?: boolean; // DEBUG: Track if question was classified as semantic
  semanticError?: string; // DEBUG: Capture error message if semantic layer fails
  isClarificationRequest?: boolean; // True when bot is asking user to clarify ambiguous question
  isBinaryQuestion?: boolean; // True when bot detected a yes/no question
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
/**
 * Detect if a question is ambiguous and could map to multiple valid intents.
 * 
 * AMBIGUITY CRITERIA:
 * - Question contains preparation language ("preparing for", "getting ready for")
 *   AND could be answered with either next steps OR a summary
 * - Question asks "what should I know/cover/prepare" without specifying scope
 * 
 * Returns: clarification prompt if ambiguous, null if not
 */
export function detectAmbiguity(question: string): { isAmbiguous: boolean; clarificationPrompt?: string } {
  const q = question.toLowerCase().trim();
  
  // Preparation/briefing questions are inherently ambiguous
  // "What should I cover?" could mean:
  //   1. "What were the action items?" (artifact extractive)
  //   2. "Give me a summary to prepare" (semantic summary)
  const preparationPatterns = [
    /\b(?:preparing|prepare|getting ready|prepping|prep)\s+(?:me\s+)?(?:for|to)\b/,
    /\b(?:prepare|prep)\s+me\s+for\b/,
    /\bwhat should I\s+(?:[\w\s]+\s+)?(?:cover|know|remember|bring up|focus on)\b/,
    /\bwhat (?:do I need|should I need) to know\b/,
    /\bbefore (?:the|our|this|my|a)\s+(?:\w+\s+)?(?:meeting|call)\b/,
    /\bwhat should I know\s+(?:before|for)\b/,
    /\bbrief me (?:for|on|before)\b/,
    /\bhelp me (?:get ready|prepare)\s+for\b/,
    /\bget me ready for\b/,
  ];
  
  const isPreparationQuestion = preparationPatterns.some(p => p.test(q));
  
  if (isPreparationQuestion) {
    return {
      isAmbiguous: true,
      clarificationPrompt: `I can help in a couple of ways — which would you like?

• The next steps from the last meeting
• A brief summary to help you prepare

Just tell me which one.`,
    };
  }
  
  return { isAmbiguous: false };
}

/**
 * Detect if a question is a binary (yes/no) or existence question.
 * 
 * BINARY QUESTION PATTERNS:
 * - "Is there a meeting with X?"
 * - "Was X discussed?"
 * - "Did they mention X?"
 * - "Do we have a meeting with X?"
 * 
 * These questions require a direct yes/no answer first,
 * then optionally offer more detail.
 */
export function isBinaryQuestion(question: string): boolean {
  const q = question.toLowerCase().trim();
  
  const binaryPatterns = [
    /^(?:is|are|was|were|did|do|does|has|have|had) (?:there|we|they|it|he|she)\b/,
    /^(?:is|are|was|were) .+\b(?:discussed|mentioned|covered|addressed|raised|brought up)\b/,
    /\bdo we have (?:a|any)\b/,
    /\bis there (?:a|any)\b/,
    /\bwas there (?:a|any)\b/,
    /\bdid (?:we|they|anyone) (?:discuss|mention|cover|talk about|bring up)\b/,
    /\bhas (?:anyone|there been|this been)\b/,
  ];
  
  return binaryPatterns.some(p => p.test(q));
}

/**
 * Extract the subject of a binary question for targeted lookup.
 * E.g., "Is there a meeting with Walmart?" → "walmart"
 */
function extractBinarySubject(question: string): string | null {
  const q = question.toLowerCase();
  
  // "Is there a meeting with X?"
  const meetingWithMatch = q.match(/meeting (?:with|about|for|regarding) ([\w\s]+?)(?:\?|$)/);
  if (meetingWithMatch) {
    return meetingWithMatch[1].trim();
  }
  
  // "Was X discussed?"
  const wasDiscussedMatch = q.match(/was ([\w\s]+?) (?:discussed|mentioned|covered|addressed)/);
  if (wasDiscussedMatch) {
    return wasDiscussedMatch[1].trim();
  }
  
  // "Did they mention/discuss X?"
  const didMentionMatch = q.match(/did (?:we|they|anyone) (?:discuss|mention|cover|talk about|bring up) ([\w\s]+?)(?:\?|$)/);
  if (didMentionMatch) {
    return didMentionMatch[1].trim();
  }
  
  return null;
}

/**
 * @deprecated This function is deprecated. Intent classification should be done by the Control Plane.
 * Use the optional `contract` parameter in `handleSingleMeetingQuestion` instead.
 * 
 * This function is retained for backward compatibility with direct Slack calls that haven't
 * migrated to Control Plane routing yet.
 */
function classifyQuestionType(question: string): InternalHandlerType {
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
  // Temporal reference words - used for meeting resolution, NOT topic matching
  "last", "latest", "recent", "previous", "yesterday", "today", "earlier",
  "call", "calls", "meeting", "meetings", "sync", "syncs", "demo", "demos",
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
  
  // Create a set of proper nouns for fast lookup
  const properNounSet = new Set(properNouns);
  
  // Extract general keywords, EXCLUDING proper nouns
  // This ensures "Canadian Tire" matches as proper_noun, not keyword
  // Strip punctuation before checking stop words (e.g., "call?" -> "call")
  const keywords = query.toLowerCase()
    .split(/\s+/)
    .map(w => w.replace(/[^a-z]/g, ''))  // Strip non-letter chars
    .filter(w => w.length > 3 && !STOP_WORDS.has(w) && !properNounSet.has(w));
  
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
  
  // PRIORITY 1: Questions matching BOTH proper nouns AND keywords (most relevant)
  if (properNouns.length > 0 && keywords.length > 0) {
    const bothMatches = questions.filter(cq => {
      const text = cq.questionText.toLowerCase();
      const hasProperNoun = properNouns.some(noun => text.includes(noun));
      const hasKeyword = keywords.some(kw => text.includes(kw));
      return hasProperNoun && hasKeyword;
    });
    
    if (bothMatches.length > 0) {
      return bothMatches;
    }
  }
  
  // PRIORITY 2: Questions matching keywords only (topic-relevant)
  if (keywords.length > 0) {
    const keywordMatches = questions.filter(cq => {
      const text = cq.questionText.toLowerCase();
      return keywords.some(kw => text.includes(kw));
    });
    
    if (keywordMatches.length > 0) {
      return keywordMatches;
    }
  }
  
  // PRIORITY 3: Questions matching proper nouns only (valid for name-based queries)
  if (properNouns.length > 0) {
    const properNounMatches = questions.filter(cq => {
      const text = cq.questionText.toLowerCase();
      return properNouns.some(noun => text.includes(noun));
    });
    
    if (properNounMatches.length > 0) {
      return properNounMatches;
    }
  }
  
  return [];
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
 * INVARIANT: meeting_action_items are read-only artifacts materialized at ingestion.
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
  matchType?: "both" | "keyword" | "proper_noun";
}>> {
  const chunks = await storage.getChunksForTranscript(meetingId, 1000);
  
  const { keywords, properNouns } = extractKeywords(query);
  
  // PRIORITY 1: Chunks matching BOTH proper nouns AND keywords (most relevant)
  if (properNouns.length > 0 && keywords.length > 0) {
    const bothMatches = chunks.filter(chunk => {
      const content = chunk.content.toLowerCase();
      const hasProperNoun = properNouns.some(noun => content.includes(noun));
      const hasKeyword = keywords.some(kw => content.includes(kw));
      return hasProperNoun && hasKeyword;
    });
    
    if (bothMatches.length > 0) {
      console.log(`[SearchTranscript] Found ${bothMatches.length} chunks matching both proper nouns AND keywords`);
      return bothMatches.slice(0, limit).map(chunk => ({
        speakerName: chunk.speakerName || "Unknown",
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        matchType: "both" as const,
      }));
    }
  }
  
  // PRIORITY 2: Chunks matching keywords only (topic-relevant even without proper noun)
  if (keywords.length > 0) {
    const keywordMatches = chunks.filter(chunk => {
      const content = chunk.content.toLowerCase();
      return keywords.some(kw => content.includes(kw));
    });
    
    if (keywordMatches.length > 0) {
      console.log(`[SearchTranscript] Found ${keywordMatches.length} chunks matching keywords only`);
      return keywordMatches.slice(0, limit).map(chunk => ({
        speakerName: chunk.speakerName || "Unknown",
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        matchType: "keyword" as const,
      }));
    }
  }
  
  // PRIORITY 3: Chunks matching proper nouns only (company context without topic match)
  // Valid for queries like "Did they mention Canadian Tire?" where company IS the subject
  if (properNouns.length > 0) {
    const properNounMatches = chunks.filter(chunk => {
      const content = chunk.content.toLowerCase();
      return properNouns.some(noun => content.includes(noun));
    });
    
    if (properNounMatches.length > 0) {
      console.log(`[SearchTranscript] Found ${properNounMatches.length} chunks matching proper nouns only`);
      return properNounMatches.slice(0, limit).map(chunk => ({
        speakerName: chunk.speakerName || "Unknown",
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        matchType: "proper_noun" as const,
      }));
    }
  }
  
  return [];
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
  question: string,
  contract?: AnswerContract
): Promise<SingleMeetingResult> {
  const startTime = Date.now();
  
  // Detect question type FIRST to minimize unnecessary DB calls
  const isAttendee = isAttendeeQuestion(question);
  const isAction = isActionItemQuestion(question);
  
  // FAST PATH: Customer questions - when contract explicitly requests OR question pattern matches
  const isCustomerQuestionsRequest = contract === AnswerContract.CUSTOMER_QUESTIONS || 
    /customer questions?|questions?\s+from\s+(the|this)\s+(meeting|call)|what\s+did\s+(they|the customer)\s+ask/i.test(question);
  
  // Detect if user wants KB-assisted answers (answer the questions, verify answers, check correctness)
  const wantsKBAnswers = /answer\s+(the|those|these|customer)?\s*questions?|help\s+(me\s+)?(answer|respond)|check\s+(for\s+)?correct|verify|assess|validate/i.test(question);
  
  if (isCustomerQuestionsRequest) {
    console.log(`[SingleMeetingOrchestrator] Fast path: customer questions (contract=${contract}, wantsKBAnswers=${wantsKBAnswers})`);
    const customerQuestions = await lookupCustomerQuestions(ctx.meetingId);
    console.log(`[SingleMeetingOrchestrator] Customer questions fetch: ${Date.now() - startTime}ms`);
    
    if (customerQuestions.length === 0) {
      const dateSuffix = getMeetingDateSuffix(ctx);
      return {
        answer: `No customer questions were identified in this meeting${dateSuffix}.`,
        intent: "extractive",
        dataSource: "customer_questions",
      };
    }
    
    const openQuestions = customerQuestions.filter(q => q.status === "OPEN");
    const answeredQuestions = customerQuestions.filter(q => q.status === "ANSWERED");
    
    // If user wants KB-assisted answers, provide assessments and answers
    if (wantsKBAnswers) {
      console.log(`[SingleMeetingOrchestrator] User requested KB-assisted answers for customer questions`);
      return await generateKBAssistedCustomerQuestionAnswers(ctx, openQuestions, answeredQuestions);
    }
    
    // Standard customer questions listing
    const lines: string[] = [];
    const dateSuffix = getMeetingDateSuffix(ctx);
    lines.push(`*Customer Questions — ${ctx.companyName}${dateSuffix}*`);
    
    if (openQuestions.length > 0) {
      lines.push("\n*Open Questions:*");
      openQuestions.forEach(q => {
        lines.push(`• "${q.questionText}"${q.askedByName ? ` — ${q.askedByName}` : ""}`);
      });
    }
    
    if (answeredQuestions.length > 0) {
      lines.push("\n*Answered in Meeting:*");
      answeredQuestions.slice(0, 10).forEach(q => {
        lines.push(`• "${q.questionText}"${q.askedByName ? ` — ${q.askedByName}` : ""}`);
      });
      if (answeredQuestions.length > 10) {
        lines.push(`_...and ${answeredQuestions.length - 10} more_`);
      }
    }
    
    // Offer to help with specific questions if there are any
    if (openQuestions.length > 0 || answeredQuestions.length > 0) {
      lines.push("\n_Ask me about any specific question for more details!_");
    }
    
    return {
      answer: lines.join("\n"),
      intent: "extractive",
      dataSource: "customer_questions",
    };
  }
  
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
  // 
  // RELEVANCE RULE: Only return quotes that DIRECTLY answer the question.
  // A score of 1 (single keyword match) is often insufficient for relevance.
  // Require at least 2 keyword matches OR a proper noun match for confidence.
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
  
  // RELEVANCE THRESHOLD: Require minimum score to avoid noisy, irrelevant quotes.
  // - If question has proper nouns: require proper noun match (handled above) = 1
  // - If question has few keywords (1-2): require just 1 match (single salient term like "pricing")
  // - If question has many keywords (3+): require 2+ matches (more context to validate)
  const keywordThreshold = keywords.length <= 2 ? 1 : 2;
  const minRelevanceScore = hasProperNouns ? 1 : keywordThreshold;
  
  // Score action items FIRST (preferred for term lookups)
  const scoredActionItems = actionItems.map(ai => ({
    item: ai,
    score: scoreMatch(`${ai.action} ${ai.evidence} ${ai.owner}`),
  })).filter(x => x.score >= minRelevanceScore).sort((a, b) => b.score - a.score);
  
  // Score customer questions
  const scoredCustomerQuestions = customerQuestions.map(cq => ({
    item: cq,
    score: scoreMatch(cq.questionText + " " + (cq.answerEvidence || "")),
  })).filter(x => x.score >= minRelevanceScore).sort((a, b) => b.score - a.score);
  
  // Pick the best match - action items win ties since they contain cleaner term definitions
  const bestAI = scoredActionItems[0];
  const bestCQ = scoredCustomerQuestions[0];
  
  // Action items preferred for term lookups (contain cleaner nouns)
  if (bestAI && (!bestCQ || bestAI.score >= bestCQ.score)) {
    // Read-only artifact framing: "In this meeting, X references..." + quote
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
  console.log(`[SingleMeetingOrchestrator] Fallback: transcript search`);
  const snippets = await searchTranscriptSnippets(ctx.meetingId, question);
  console.log(`[SingleMeetingOrchestrator] Transcript fetch: ${Date.now() - startTime}ms`);
  
  // Only return snippets that are topic-relevant (both or keyword matches)
  // Proper-noun-only matches are NOT relevant to the question topic
  const relevantSnippets = snippets.filter(s => s.matchType === "both" || s.matchType === "keyword");
  
  if (relevantSnippets.length > 0) {
    const dateSuffix = getMeetingDateSuffix(ctx);
    const lines: string[] = [];
    lines.push(`In this meeting${dateSuffix}, the transcript mentions:`);
    relevantSnippets.slice(0, 2).forEach(s => {
      lines.push(`\n_"${s.content.substring(0, 200)}${s.content.length > 200 ? '...' : ''}"_`);
      lines.push(`— ${s.speakerName}`);
    });
    
    return {
      answer: lines.join("\n"),
      intent: "extractive",
      dataSource: "transcript",
      evidence: relevantSnippets[0].content,
    };
  } else if (snippets.length > 0 && snippets[0].matchType === "proper_noun") {
    // GUARDRAIL: Entity-matched but NOT topic-matched → return "not found"
    // This prevents false-confidence answers where we have company excerpts
    // but nothing actually relevant to the question topic
    console.log(`[SingleMeetingOrchestrator] GUARDRAIL: proper_noun-only matches (${snippets.length} chunks) - refusing to answer with unrelated content`);
  }
  
  return {
    answer: UNCERTAINTY_RESPONSE,
    intent: "extractive",
    dataSource: "not_found",
  };
}

/**
 * Handle aggregative intent (general but directed questions).
 * Returns curated lists from meeting artifacts, no narrative summary.
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
      lines.push("\n*Answered in Meeting:*");
      answeredQuestions.slice(0, 5).forEach(q => {
        lines.push(`• "${q.questionText}"${q.askedByName ? ` — ${q.askedByName}` : ""}`);
      });
      if (answeredQuestions.length > 5) {
        lines.push(`_...and ${answeredQuestions.length - 5} more_`);
      }
    }
    
    // Offer to help with specific questions if there are any
    if (openQuestions.length > 0 || answeredQuestions.length > 0) {
      lines.push("\n_Ask me about any specific question for more details!_");
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
 * Handle drafting intent (emails, responses about meeting content).
 * Fetches relevant meeting data and uses LLM to generate a draft.
 */
async function handleDraftingIntent(
  ctx: SingleMeetingContext,
  question: string,
  contract?: AnswerContract
): Promise<SingleMeetingResult> {
  console.log(`[SingleMeetingOrchestrator] Drafting handler: contract=${contract}`);
  
  const dateSuffix = getMeetingDateSuffix(ctx);
  
  // Fetch ALL context in parallel - it's all DB queries, let the LLM decide what's relevant
  console.log(`[SingleMeetingOrchestrator] Drafting: fetching all context for meeting ${ctx.meetingId}`);
  
  const [customerQuestions, actionItems, chunks, productKnowledge] = await Promise.all([
    lookupCustomerQuestions(ctx.meetingId),
    getMeetingActionItems(ctx.meetingId),
    storage.getChunksForTranscript(ctx.meetingId, 50),
    getComprehensiveProductKnowledge(),
  ]);
  
  // Build context for the LLM
  const contextParts: string[] = [];
  
  // Include meeting discussion if mentioned or gathering all
  if (chunks.length > 0) {
    const transcriptPreview = chunks
      .slice(0, 20)
      .map(c => `[${c.speakerName || "Unknown"}]: ${c.content.substring(0, 200)}`)
      .join("\n");
    contextParts.push("MEETING DISCUSSION PREVIEW:");
    contextParts.push(transcriptPreview);
    contextParts.push("");
  }
  
  // Include customer questions if available
  if (customerQuestions.length > 0) {
    contextParts.push("CUSTOMER QUESTIONS FROM THE MEETING:");
    customerQuestions.forEach(cq => {
      const status = cq.status === "OPEN" ? " [OPEN]" : " [ANSWERED]";
      contextParts.push(`- "${cq.questionText}"${cq.askedByName ? ` (asked by ${cq.askedByName})` : ""}${status}`);
      if (cq.status === "ANSWERED" && cq.answerEvidence) {
        contextParts.push(`  Answer: ${cq.answerEvidence}`);
      }
    });
    contextParts.push("");
  }
  
  // Include action items if available
  if (actionItems.length > 0) {
    contextParts.push("ACTION ITEMS / NEXT STEPS FROM THE MEETING:");
    actionItems.forEach(item => {
      contextParts.push(`- ${item.action} (owner: ${item.owner})`);
    });
    contextParts.push("");
  }
  
  // Include product knowledge
  if (productKnowledge) {
    const formattedProduct = formatProductKnowledgeForPrompt(productKnowledge);
    if (formattedProduct) {
      contextParts.push("PITCREW PRODUCT INFORMATION (from Airtable):");
      contextParts.push(formattedProduct);
      contextParts.push("");
    }
  }
  
  if (contextParts.length === 0) {
    return {
      answer: `I couldn't find enough meeting content${dateSuffix} to draft this email. Try asking for a specific type of email (e.g., "draft an email about the next steps" or "draft an email about our features").`,
      intent: "drafting",
      dataSource: "not_found",
    };
  }
  
  const meetingContext = contextParts.join("\n");
  
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0.7,
    messages: [
      {
        role: "system",
        content: `You are drafting a professional follow-up email for Leverege sales team.

MEETING CONTEXT:
- Company: ${ctx.companyName}
- Date: ${ctx.meetingDate || "recent meeting"}

${meetingContext}

DRAFTING RULES:
1. Write a professional, warm follow-up email
2. Address the specific questions or concerns raised in the meeting
3. Reference action items if relevant
4. If product information is provided, use it to answer customer questions accurately
5. For pricing questions: mention "per-store flat monthly fee" model but defer specific dollar amounts to a follow-up call
6. Keep it concise but thorough
7. End with a clear next step or call to action
8. Use the customer's name if known from the context
9. Sign as "[Your name]" - let the sender fill in

Format the email with:
- Subject line (prefix with "Subject:")
- Greeting
- Body (2-3 short paragraphs)
- Closing with next step
- Signature placeholder`,
      },
      {
        role: "user",
        content: question,
      },
    ],
  });
  
  const draft = response.choices[0]?.message?.content || "Unable to generate draft.";
  
  return {
    answer: `Here's a draft follow-up email for ${ctx.companyName}${dateSuffix}:\n\n${draft}`,
    intent: "drafting",
    dataSource: "customer_questions",
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
        content: `You are summarizing a business meeting transcript for Slack.

Provide a concise summary with these sections:
*Purpose*
• One sentence describing the main goal

*Key Topics*
• Bullet list of main topics discussed

*Decisions & Outcomes*
• What was decided or agreed upon

*Open Questions*
• Any unresolved issues or concerns

IMPORTANT: Use Slack formatting - wrap section headers in asterisks for bold (*Purpose*, *Key Topics*, etc). Use • for bullets. Keep it concise.`,
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
 * Handle binary (yes/no) questions with "answer first, expand second" rule.
 * 
 * RULE: Always answer the literal yes/no question first, then offer more detail.
 * 
 * Example:
 *   Q: "Is there a meeting with Walmart?"
 *   A: "Yes — there was a meeting with Walmart on October 29, 2025.
 *      Would you like a brief summary of what was discussed?"
 */
async function handleBinaryQuestion(
  ctx: SingleMeetingContext,
  question: string
): Promise<SingleMeetingResult | null> {
  const q = question.toLowerCase();
  
  // Check for "is there a meeting with X" pattern
  const isMeetingExistenceQuestion = /\b(?:is there|was there|do we have) (?:a |any )?meeting\b/.test(q);
  
  if (isMeetingExistenceQuestion) {
    // This is asking about meeting existence, but we're already IN a meeting thread
    // So the answer is always "Yes" - there is a meeting with this company
    const dateSuffix = getMeetingDateSuffix(ctx);
    const answer = `Yes — there was a meeting with ${ctx.companyName}${dateSuffix}.

Would you like a brief summary of what was discussed?`;
    
    return {
      answer,
      intent: "extractive",
      dataSource: "binary_answer",
      pendingOffer: "summary",
      isBinaryQuestion: true,
    };
  }
  
  // Check for "was X discussed" / "did they mention X" patterns
  const subject = extractBinarySubject(question);
  if (subject) {
    console.log(`[SingleMeetingOrchestrator] Binary question subject: "${subject}"`);
    
    // Search for the subject in meeting artifacts AND transcript (parallel fetch)
    const [customerQuestions, actionItems, transcriptSnippets] = await Promise.all([
      lookupCustomerQuestions(ctx.meetingId, subject),
      searchActionItemsForRelevantIssues(ctx.meetingId, subject),
      searchTranscriptSnippets(ctx.meetingId, subject, 2),
    ]);
    
    const foundInArtifacts = customerQuestions.length > 0 || actionItems.length > 0;
    const foundInTranscript = transcriptSnippets.length > 0;
    const found = foundInArtifacts || foundInTranscript;
    const dateSuffix = getMeetingDateSuffix(ctx);
    
    if (found) {
      // Found the subject - answer YES with evidence
      let answer = `Yes — "${subject}" was mentioned in this meeting${dateSuffix}.`;
      
      // Add brief evidence from the best source
      if (customerQuestions.length > 0) {
        const cq = customerQuestions[0];
        answer += `\n\n_"${cq.questionText.substring(0, 150)}${cq.questionText.length > 150 ? '...' : ''}"_`;
      } else if (actionItems.length > 0) {
        const ai = actionItems[0];
        answer += `\n\n_"${ai.evidence.substring(0, 150)}${ai.evidence.length > 150 ? '...' : ''}"_`;
      } else if (transcriptSnippets.length > 0) {
        const snippet = transcriptSnippets[0];
        answer += `\n\n_"${snippet.content.substring(0, 150)}${snippet.content.length > 150 ? '...' : ''}"_`;
        answer += `\n— ${snippet.speakerName}`;
      }
      
      answer += `\n\nWould you like more details?`;
      
      return {
        answer,
        intent: "extractive",
        dataSource: "binary_answer",
        pendingOffer: "summary",
        isBinaryQuestion: true,
      };
    } else {
      // Not found in artifacts OR transcript - answer NO honestly
      return {
        answer: `I don't see "${subject}" explicitly mentioned in this meeting${dateSuffix}.

Would you like a brief meeting summary instead?`,
        intent: "extractive",
        dataSource: "binary_answer",
        pendingOffer: "summary",
        isBinaryQuestion: true,
      };
    }
  }
  
  // Can't determine the subject - fall through to normal processing
  return null;
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
 * Generate KB-assisted answers for customer questions.
 * 
 * For answered questions: Shows Q + A (from meeting) + Assessment from product KB
 * For open questions: Provides suggested answer from product KB
 */
async function generateKBAssistedCustomerQuestionAnswers(
  ctx: SingleMeetingContext,
  openQuestions: Array<{ questionText: string; askedByName?: string | null; answerEvidence?: string | null }>,
  answeredQuestions: Array<{ questionText: string; askedByName?: string | null; answerEvidence?: string | null; answeredByName?: string | null }>
): Promise<SingleMeetingResult> {
  console.log(`[SingleMeetingOrchestrator] Generating KB-assisted answers: ${openQuestions.length} open, ${answeredQuestions.length} answered`);
  
  // Fetch product knowledge for assessment
  let productKnowledge = "";
  try {
    const pkResult = await getComprehensiveProductKnowledge();
    productKnowledge = formatProductKnowledgeForPrompt(pkResult);
    console.log(`[SingleMeetingOrchestrator] Product knowledge loaded for assessment (${productKnowledge.length} chars)`);
  } catch (err) {
    console.error(`[SingleMeetingOrchestrator] Failed to load product knowledge:`, err);
    productKnowledge = "Product knowledge unavailable - provide best-effort answers.";
  }
  
  // Format questions for LLM
  const questionsForAssessment: string[] = [];
  
  if (answeredQuestions.length > 0) {
    questionsForAssessment.push("## Questions Answered in Meeting (assess for correctness):");
    answeredQuestions.forEach((q, i) => {
      const answer = q.answerEvidence || "[Answer not recorded]";
      const answerer = q.answeredByName ? ` (answered by ${q.answeredByName})` : "";
      questionsForAssessment.push(`${i + 1}. Q: "${q.questionText}"${q.askedByName ? ` — ${q.askedByName}` : ""}`);
      questionsForAssessment.push(`   A (from meeting)${answerer}: ${answer}`);
    });
  }
  
  if (openQuestions.length > 0) {
    questionsForAssessment.push("\n## Open Questions (provide answers from product knowledge):");
    openQuestions.forEach((q, i) => {
      questionsForAssessment.push(`${i + 1}. Q: "${q.questionText}"${q.askedByName ? ` — ${q.askedByName}` : ""}`);
    });
  }
  
  const systemPrompt = `You are helping a sales team review customer questions from a meeting and provide accurate product-based responses.

PRODUCT KNOWLEDGE (use this as your source of truth):
${productKnowledge}

YOUR TASK:
1. For ANSWERED questions: Assess the answer given in the meeting against the product knowledge.
   - If the answer is correct: Mark as ✅ Correct
   - If the answer is partially correct or needs clarification: Mark as ⚠️ Needs Clarification and explain
   - If the answer is incorrect: Mark as ❌ Incorrect and provide the correct answer
   
2. For OPEN questions: Provide a suggested answer based on the product knowledge.
   - If you can answer from the product data: Provide a clear, accurate answer
   - If you can't answer from the data: Say "I'd need to verify this with the product team"

FORMAT YOUR RESPONSE:
For each question, use this structure:

**Answered Questions Assessment:**
1. Q: [question]
   A (from meeting): [their answer]
   📋 Assessment: [✅/⚠️/❌] [your assessment and any corrections]

**Suggested Answers for Open Questions:**
1. Q: [question]
   💡 Suggested Answer: [your answer based on product knowledge]

Be concise but thorough. Prioritize accuracy over completeness.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: questionsForAssessment.join("\n") },
      ],
      temperature: 0.3,
      max_tokens: 3000,
    });
    
    const answer = response.choices[0]?.message?.content || "Unable to generate KB-assisted answers.";
    const dateSuffix = getMeetingDateSuffix(ctx);
    
    const header = `*Customer Questions Review — ${ctx.companyName}${dateSuffix}*\n\n`;
    
    return {
      answer: header + answer,
      intent: "extractive",
      dataSource: "customer_questions",
    };
  } catch (err) {
    console.error(`[SingleMeetingOrchestrator] LLM error in KB-assisted answers:`, err);
    return {
      answer: "I encountered an error while generating KB-assisted answers. Please try again.",
      intent: "extractive",
      dataSource: "not_found",
    };
  }
}

/**
 * Derive internal handler type from Control Plane contract.
 * 
 * When a contract is provided by the Control Plane, we skip the deprecated
 * internal classification and directly route to the appropriate handler.
 */
function deriveHandlerFromContract(contract: AnswerContract): InternalHandlerType {
  switch (contract) {
    case AnswerContract.EXTRACTIVE_FACT:
    case AnswerContract.ATTENDEES:
    case AnswerContract.CUSTOMER_QUESTIONS:
    case AnswerContract.NEXT_STEPS:
      return "extractive";
    case AnswerContract.AGGREGATIVE_LIST:
      return "aggregative";
    case AnswerContract.MEETING_SUMMARY:
      return "summary";
    case AnswerContract.DRAFT_EMAIL:
    case AnswerContract.DRAFT_RESPONSE:
      return "drafting";
    default:
      return "extractive";
  }
}

/**
 * Main orchestrator entry point.
 * 
 * Routes to appropriate handler based on Control Plane contract or internal classification.
 * 
 * Processing Flow:
 * 1. Check for offer responses (if pending)
 * 2. Derive handler type from contract OR use deprecated classification
 * 3. Try artifact deterministic lookup
 * 4. If artifacts fail AND question is semantic → use LLM semantic answer (Step 6)
 * 5. If still no answer → return uncertainty with offer
 * 
 * @param ctx - Single meeting context (meetingId, companyName, meetingDate)
 * @param question - User's question text
 * @param hasPendingOffer - Whether the previous interaction offered a summary (from interaction_logs)
 * @param contract - Optional Control Plane contract. When provided, skips deprecated internal classification.
 */
export async function handleSingleMeetingQuestion(
  ctx: SingleMeetingContext,
  question: string,
  hasPendingOffer: boolean = false,
  contract?: AnswerContract
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
  
  // STEP 0a: AMBIGUITY CHECK - Before classifying, check if question is ambiguous
  const ambiguity = detectAmbiguity(question);
  if (ambiguity.isAmbiguous) {
    console.log(`[SingleMeetingOrchestrator] AMBIGUITY DETECTED - returning clarification prompt`);
    return {
      answer: ambiguity.clarificationPrompt!,
      intent: "extractive", // Default intent for tracking
      dataSource: "clarification",
      isClarificationRequest: true,
    };
  }
  
  // STEP 0b: BINARY QUESTION CHECK - Detect yes/no questions
  const isBinary = isBinaryQuestion(question);
  if (isBinary) {
    console.log(`[SingleMeetingOrchestrator] BINARY QUESTION DETECTED - will answer yes/no first`);
    const binaryResult = await handleBinaryQuestion(ctx, question);
    if (binaryResult) {
      return binaryResult;
    }
    // If handleBinaryQuestion returns null, fall through to normal processing
  }
  
  // Derive handler type from Control Plane contract if provided, otherwise use deprecated internal classification
  let handlerType: InternalHandlerType;
  if (contract) {
    handlerType = deriveHandlerFromContract(contract);
    console.log(`[SingleMeetingOrchestrator] Using Control Plane contract: ${contract} → handler: ${handlerType}`);
  } else {
    // @deprecated Legacy internal classification for backward compatibility with direct Slack calls
    // This path should only execute when invoked without Control Plane context
    handlerType = classifyQuestionType(question);
    console.log(`[SingleMeetingOrchestrator] Using deprecated internal classification (no contract provided)`);
  }
  
  const isSemantic = isSemanticQuestion(question);
  console.log(`[SingleMeetingOrchestrator] VERSION=2026-01-27-v2 | handlerType: ${handlerType} | isSemantic: ${isSemantic} | isBinary: ${isBinary} | hasContract: ${!!contract}`);
  console.log(`[SingleMeetingOrchestrator] DEBUG: Question for semantic check: "${question}"`);
  
  switch (handlerType) {
    case "extractive": {
      const result = await handleExtractiveIntent(ctx, question, contract);
      
      // STEP 6: If artifacts fail AND question is semantic → use LLM semantic answer
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
      
      // STEP 6: If artifacts fail AND question is semantic → use LLM semantic answer
      if (result.dataSource === "not_found" && isSemantic) {
        console.log(`[SingleMeetingOrchestrator] Step 6: Semantic answer layer (aggregative, artifacts failed)`);
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
    
    case "drafting": {
      const draftResult = await handleDraftingIntent(ctx, question, contract);
      return { ...draftResult, isSemanticDebug: isSemantic };
    }
    
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
