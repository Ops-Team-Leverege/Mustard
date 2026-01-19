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
import { 
  extractMeetingActionStates, 
  type TranscriptChunk as ComposerChunk,
  type MeetingActionItem 
} from "../rag/composer";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// Cache for extracted action items per meeting (avoids re-extraction on every question)
// Key: meetingId, Value: { items, extractedAt }
const actionItemsCache = new Map<string, { 
  items: MeetingActionItem[], 
  extractedAt: number 
}>();
const ACTION_ITEMS_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export type SingleMeetingIntent = "extractive" | "aggregative" | "summary";

export type SingleMeetingContext = {
  meetingId: string;
  companyId: string;
  companyName: string;
};

export type SingleMeetingResult = {
  answer: string;
  intent: SingleMeetingIntent;
  dataSource: "attendees" | "customer_questions" | "action_items" | "transcript" | "summary" | "not_found";
  evidence?: string;
};

const UNCERTAINTY_RESPONSE = `I don't see this explicitly mentioned in the meeting.
If you'd like, I can share what was discussed instead.`;

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
 */
function isAttendeeQuestion(question: string): boolean {
  const q = question.toLowerCase();
  const patterns = [
    /\bwho attended\b/,
    /\bwho was (?:there|present|in the meeting|on the call)\b/,
    /\battendees\b/,
    /\bparticipants\b/,
    /\bwho joined\b/,
    /\bwho was on\b/,
    /\bpeople (?:in|on) the (?:meeting|call)\b/,
  ];
  return patterns.some(p => p.test(q));
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

/**
 * Lookup customer questions for a specific meeting.
 * Returns questions from the high-trust customer_questions table only.
 * 
 * This is strictly meeting-scoped and does NOT use searchQuestions or cross-meeting logic.
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
  
  const q = userQuestion.toLowerCase();
  return questions.filter(cq => {
    const text = cq.questionText.toLowerCase();
    const words = q.split(/\s+/).filter(w => w.length > 3);
    return words.some(w => text.includes(w));
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
 * Dynamically extracts action items using the RAG composer for high-quality results.
 * Results are cached to avoid re-extraction on every question.
 */
async function getMeetingActionItems(
  meetingId: string
): Promise<MeetingActionItem[]> {
  // Check cache first
  const cached = actionItemsCache.get(meetingId);
  if (cached && Date.now() - cached.extractedAt < ACTION_ITEMS_CACHE_TTL_MS) {
    console.log(`[SingleMeetingOrchestrator] Using cached action items for meeting ${meetingId}`);
    return cached.items;
  }
  
  console.log(`[SingleMeetingOrchestrator] Extracting action items for meeting ${meetingId}...`);
  
  // Get transcript chunks for extraction
  const chunks = await storage.getChunksForTranscript(meetingId, 5000);
  
  if (chunks.length === 0) {
    // Cache empty result to avoid re-querying
    actionItemsCache.set(meetingId, { items: [], extractedAt: Date.now() });
    return [];
  }
  
  // Get attendee info for speaker normalization
  const { leverageTeam, customerNames } = await getMeetingAttendees(meetingId);
  
  // Map to composer format
  const composerChunks: ComposerChunk[] = chunks.map(c => ({
    chunkIndex: c.chunkIndex,
    speakerRole: (c.speakerRole || "unknown") as "leverege" | "customer" | "unknown",
    speakerName: c.speakerName || undefined,
    text: c.content,
  }));
  
  // Extract action items using the same pipeline as the main capability
  const { primary, secondary } = await extractMeetingActionStates(composerChunks, {
    leverageTeam: leverageTeam.length > 0 ? leverageTeam.join(", ") : undefined,
    customerNames: customerNames.length > 0 ? customerNames.join(", ") : undefined,
  });
  
  const allItems = [...primary, ...secondary];
  
  // Cache the results
  actionItemsCache.set(meetingId, { items: allItems, extractedAt: Date.now() });
  console.log(`[SingleMeetingOrchestrator] Cached ${allItems.length} action items for meeting ${meetingId}`);
  
  return allItems;
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
): Promise<MeetingActionItem[]> {
  const actionItems = await getMeetingActionItems(meetingId);
  
  if (actionItems.length === 0) {
    return [];
  }
  
  const q = query.toLowerCase();
  // Extract meaningful keywords (length > 3, not common stop words)
  const stopWords = new Set(["what", "when", "where", "which", "that", "this", "from", "with", "about", "were", "have", "been", "does", "friday", "monday", "tuesday", "wednesday", "thursday", "saturday", "sunday"]);
  const keywords = q.split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));
  
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
  
  const q = query.toLowerCase();
  const keywords = q.split(/\s+/).filter(w => w.length > 3);
  
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
 */
async function handleExtractiveIntent(
  ctx: SingleMeetingContext,
  question: string
): Promise<SingleMeetingResult> {
  if (isAttendeeQuestion(question)) {
    const { leverageTeam, customerNames } = await getMeetingAttendees(ctx.meetingId);
    
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
  
  if (isActionItemQuestion(question)) {
    const actionItems = await getMeetingActionItems(ctx.meetingId);
    
    if (actionItems.length === 0) {
      return {
        answer: "No explicit action items were identified in this meeting.",
        intent: "extractive",
        dataSource: "action_items",
      };
    }
    
    const lines: string[] = [];
    lines.push(`*Next Steps (${ctx.companyName})*`);
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
  
  const customerQuestions = await lookupCustomerQuestions(ctx.meetingId, question);
  
  if (customerQuestions.length > 0) {
    const match = customerQuestions[0];
    const lines: string[] = [];
    lines.push(`*From the meeting with ${ctx.companyName}:*`);
    lines.push(`\n"${match.questionText}"`);
    if (match.askedByName) {
      lines.push(`— ${match.askedByName}`);
    }
    if (match.status === "ANSWERED" && match.answerEvidence) {
      lines.push(`\n*Answer:* ${match.answerEvidence}`);
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
  
  // RULE: Action items are checked whenever the question asks about issues, problems,
  // blockers, errors, or incidents — regardless of whether user says "next steps"
  const matchingActionItems = await searchActionItemsForRelevantIssues(ctx.meetingId, question);
  
  if (matchingActionItems.length > 0) {
    // Frame the answer honestly: action items document follow-ups, not diagnoses
    // We should not imply the issue was fully diagnosed if it wasn't discussed in detail
    const lines: string[] = [];
    lines.push(`The meeting notes include a follow-up related to this:`);
    matchingActionItems.forEach((item) => {
      let formattedItem = `• ${item.action} — ${item.owner}`;
      if (item.deadline && item.deadline !== "Not specified") {
        formattedItem += ` _(${item.deadline})_`;
      }
      lines.push(`\n${formattedItem}`);
      lines.push(`  _"${item.evidence}"_`);
    });
    lines.push(`\n_Note: The specific details may not have been discussed in this meeting._`);
    
    return {
      answer: lines.join("\n"),
      intent: "extractive",
      dataSource: "action_items",
      evidence: matchingActionItems[0].evidence,
    };
  }
  
  const snippets = await searchTranscriptSnippets(ctx.meetingId, question);
  
  if (snippets.length > 0) {
    const lines: string[] = [];
    lines.push(`*From the meeting with ${ctx.companyName}:*`);
    snippets.forEach(s => {
      lines.push(`\n"${s.content.substring(0, 200)}${s.content.length > 200 ? '...' : ''}"`);
      lines.push(`— ${s.speakerName}`);
    });
    
    return {
      answer: lines.join("\n"),
      intent: "extractive",
      dataSource: "transcript",
      evidence: snippets[0].content,
    };
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
 */
async function handleAggregativeIntent(
  ctx: SingleMeetingContext,
  question: string
): Promise<SingleMeetingResult> {
  const q = question.toLowerCase();
  
  if (/\bquestions?\b/.test(q) || /\bask/.test(q)) {
    const customerQuestions = await lookupCustomerQuestions(ctx.meetingId);
    
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
  
  if (/\bissues?\b/.test(q) || /\bconcerns?\b/.test(q) || /\bproblems?\b/.test(q)) {
    const customerQuestions = await lookupCustomerQuestions(ctx.meetingId);
    
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
  
  const actionItems = await getMeetingActionItems(ctx.meetingId);
  
  if (actionItems.length > 0) {
    const lines: string[] = [];
    lines.push(`*Items from the meeting with ${ctx.companyName}:*`);
    actionItems.forEach(item => lines.push(`• ${item}`));
    
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
 * Main orchestrator entry point.
 * 
 * Classifies intent and routes to appropriate handler.
 * Enforces Tier-1-only access for extractive/aggregative intents.
 * Summary is only used for explicit summary requests.
 */
export async function handleSingleMeetingQuestion(
  ctx: SingleMeetingContext,
  question: string
): Promise<SingleMeetingResult> {
  console.log(`[SingleMeetingOrchestrator] Processing question for meeting ${ctx.meetingId}`);
  console.log(`[SingleMeetingOrchestrator] Question: "${question.substring(0, 100)}..."`);
  
  const intent = classifyIntent(question);
  console.log(`[SingleMeetingOrchestrator] Classified intent: ${intent}`);
  
  switch (intent) {
    case "extractive":
      return handleExtractiveIntent(ctx, question);
    
    case "aggregative":
      return handleAggregativeIntent(ctx, question);
    
    case "summary":
      return handleSummaryIntent(ctx);
    
    default:
      return {
        answer: UNCERTAINTY_RESPONSE,
        intent: "extractive",
        dataSource: "not_found",
      };
  }
}
