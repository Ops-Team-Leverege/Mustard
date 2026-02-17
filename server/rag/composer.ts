/**
 * RAG composition layer.
 *
* Purpose:
 * This module uses an LLM to transform retrieved, factual data
 * into human-readable summaries with a neutral-but-direct stance.
 *
 * What this file IS:
 * - An interpretation layer over retrieved content
 * - Allowed to prioritize, surface risks, and recommend next steps
 * - Produces structured outputs suitable for storage and display
 *
 * What this file is NOT:
 * - NOT responsible for retrieval or querying
 * - NOT allowed to fetch additional data
 * - NOT allowed to route or select MCP capabilities
 *
 * Architectural rule:
 * - Input = retrieved data only
 * - Output = structured summaries only
 *
 * Canonical output from this file may be stored and reused later.
 *
 * Layer: RAG – Composition (LLM-only)
 */

import { OpenAI } from "openai";
import { MODEL_ASSIGNMENTS, LLM_MODELS } from "../config/models";
import {
  RAG_MEETING_SUMMARY_SYSTEM_PROMPT,
  RAG_QUOTE_SELECTION_SYSTEM_PROMPT,
  RAG_EXTRACTIVE_ANSWER_SYSTEM_PROMPT,
  RAG_ACTION_ITEMS_SYSTEM_PROMPT,
  buildMeetingSummaryUserPrompt,
  buildQuoteSelectionUserPrompt,
  buildExtractiveAnswerUserPrompt,
  buildActionItemsUserPrompt,
} from "../config/prompts";
import { PROMPT_VERSIONS } from "../config/prompts/versions";
import type { PromptUsageRecord } from "../utils/promptVersionTracker";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

/**
 * Input shape coming from the retriever.
 * We stay aligned with how ingestion + retriever already work.
 */
export type TranscriptChunk = {
  chunkIndex: number;
  speakerRole: "leverege" | "customer" | "unknown";
  speakerName?: string | null;
  text: string;
};

/**
 * Canonical, storable artifact.
 */
export type MeetingSummary = {
  title: string;
  purpose: string; // Why the meeting happened (one sentence)
  focusAreas: string[]; // 2-5 recurring themes that dominated discussion
  keyTakeaways: string[];
  risksOrOpenQuestions: string[];
  recommendedNextSteps: string[];
};

export type SelectedQuote = {
  chunkIndex: number;
  speakerRole: "customer" | "leverege" | "unknown";
  quote: string;
  reason: string; // why this quote matters
};

export type QuoteSelectionResult = {
  quotes: SelectedQuote[];
  quoteNotice?: string; // Friendly disclosure when quotes are suppressed
};

/**
 * Result from extractive Q&A.
 */
export type ExtractiveAnswer = {
  answer: string;
  evidence?: string; // Supporting quote or reference from transcript
  wasFound: boolean; // True if answer was found in transcript
};

/**
 * Action type classification for next steps.
 * Broader than pure "commitments" - includes requests, blockers, plans.
 */
export type ActionType = "commitment" | "request" | "blocker" | "plan" | "scheduling";

/**
 * Action-state next step extracted from meeting.
 * Upgraded from commitment-only to capture all actionable items.
 * Quality target: Google Meet's "Suggested next steps" or better.
 */
export type MeetingActionItem = {
  action: string; // Verb + object (clean, professional)
  owner: string; // Person name(s), NOT company names. "Unassigned" only if unavoidable.
  type: ActionType;
  deadline: string; // "Not specified" if not stated
  evidence: string; // Short quote, filler words removed
  confidence: number; // 0-1 (≥0.85 explicit, 0.7-0.84 implied)
};

/**
 * Two-tier result from action-state extraction.
 * Primary (≥0.85) are high-confidence explicit actions.
 * Secondary (0.7-0.85) are implied but real actions worth tracking.
 * Below 0.7: Omit entirely (precision > recall).
 */
export type ActionExtractionResult = {
  primary: MeetingActionItem[];
  secondary: MeetingActionItem[];
};

/**
 * Confidence gate for quote selection.
 * 
 * Epistemic safety: We only generate quotes when speaker attribution is reliable.
 * A chunk is considered "attributed" if speakerName is non-null OR speakerRole !== "unknown".
 * If < 70% of chunks are attributed, confidence is low and quotes are suppressed.
 */
function computeSpeakerAttributionConfidence(chunks: TranscriptChunk[]): {
  isHigh: boolean;
  ratio: number;
} {
  if (chunks.length === 0) {
    return { isHigh: false, ratio: 0 };
  }

  const attributedCount = chunks.filter(
    (c) => c.speakerName != null || c.speakerRole !== "unknown"
  ).length;

  const ratio = attributedCount / chunks.length;
  return { isHigh: ratio >= 0.7, ratio };
}

/**
 * INVARIANT: Speaker identity must be preserved in transcript formatting.
 * 
 * This is a hard contract: if speakerName exists in chunks, it MUST appear 
 * in the formatted output. Dropping speaker names causes mis-attribution bugs.
 * 
 * @throws Error if speakerNames exist but would be dropped
 */
function assertSpeakerNamesPreserved(chunks: TranscriptChunk[], formatted: string): void {
  for (const chunk of chunks) {
    if (chunk.speakerName && chunk.speakerName !== "Unknown") {
      if (!formatted.includes(chunk.speakerName)) {
        throw new Error(
          `INVARIANT VIOLATION: Speaker name "${chunk.speakerName}" exists in chunk ${chunk.chunkIndex} ` +
          `but was not preserved in formatted transcript. ` +
          `See replit.md "Speaker Identity Preservation" for context.`
        );
      }
    }
  }
}

function formatTranscript(chunks: TranscriptChunk[]): string {
  const formatted = chunks
    .map(c => {
      // Include speaker name if available for proper attribution
      const speaker = c.speakerName && c.speakerName !== "Unknown"
        ? c.speakerName
        : (c.speakerRole === "customer" ? "Customer" : c.speakerRole === "leverege" ? "Leverege" : "Unknown");
      return `[${c.chunkIndex}] ${speaker}: ${c.text}`;
    })
    .join("\n");

  // Regression check: ensure speaker names are preserved
  assertSpeakerNamesPreserved(chunks, formatted);

  return formatted;
}

/**
 * Compose a neutral-but-direct meeting summary.
 * Output is structured and suitable for storage.
 */
export async function composeMeetingSummary(
  chunks: TranscriptChunk[],
): Promise<MeetingSummary & { promptVersions?: PromptUsageRecord }> {
  const transcript = formatTranscript(chunks);

  const response = await openai.chat.completions.create({
    model: MODEL_ASSIGNMENTS.RAG_COMPOSITION,
    temperature: 0, // Deterministic extraction
    top_p: 0.1, // Restrict vocabulary for consistency
    messages: [
      {
        role: "system",
        content: RAG_MEETING_SUMMARY_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: buildMeetingSummaryUserPrompt(transcript),
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned empty meeting summary");
  }

  // Strip markdown code fences if present
  const jsonStr = content.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  const result = JSON.parse(jsonStr) as MeetingSummary;
  return {
    ...result,
    promptVersions: { RAG_MEETING_SUMMARY_SYSTEM_PROMPT: PROMPT_VERSIONS.RAG_MEETING_SUMMARY_SYSTEM_PROMPT },
  };
}

/**
 * Select representative quotes useful for:
 * - follow-up emails
 * - sales context
 * - internal alignment
 * 
 * Includes confidence gate: quotes are only generated when speaker attribution is reliable.
 */
export async function selectRepresentativeQuotes(
  chunks: TranscriptChunk[],
  contentType: "transcript" | "notes",
  maxQuotes = 5,
): Promise<QuoteSelectionResult & { promptVersions?: PromptUsageRecord }> {
  // Gate 1: Notes don't have reliable speaker attribution
  if (contentType !== "transcript") {
    return {
      quotes: [],
      quoteNotice: "I didn't include direct quotes because this was meeting notes rather than a transcript, which makes speaker attribution unreliable.",
    };
  }

  // Gate 2: Check speaker attribution confidence
  const confidence = computeSpeakerAttributionConfidence(chunks);
  if (!confidence.isHigh) {
    return {
      quotes: [],
      quoteNotice: "I didn't include direct quotes from this meeting because the transcript doesn't consistently label speakers, which makes quotes hard to interpret out of context.",
    };
  }

  // Gate 3: Filter to customer-only chunks for quote selection
  const customerChunks = chunks.filter((c) => c.speakerRole === "customer");
  if (customerChunks.length === 0) {
    return {
      quotes: [],
      quoteNotice: "I didn't include direct quotes because no customer statements were clearly attributed in this transcript.",
    };
  }

  // Confidence is high and we have customer chunks - proceed with LLM quote selection
  const transcript = formatTranscript(customerChunks);

  const response = await openai.chat.completions.create({
    model: MODEL_ASSIGNMENTS.RAG_COMPOSITION,
    temperature: 0, // Deterministic extraction
    top_p: 0.1, // Restrict vocabulary for consistency
    messages: [
      {
        role: "system",
        content: RAG_QUOTE_SELECTION_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: buildQuoteSelectionUserPrompt(transcript, maxQuotes),
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned empty quote selection");
  }

  // Strip markdown code fences if present
  const jsonStr = content.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  return {
    quotes: JSON.parse(jsonStr) as SelectedQuote[],
    promptVersions: { RAG_QUOTE_SELECTION_SYSTEM_PROMPT: PROMPT_VERSIONS.RAG_QUOTE_SELECTION_SYSTEM_PROMPT },
  };
}

/**
 * Extractive Q&A from a single meeting transcript.
 * 
 * This is NOT RAG - we answer from already-retrieved content.
 * Designed to match Google Meet's post-meeting Q&A quality.
 * 
 * Behavior:
 * - Answers only if supported by the transcript
 * - Returns "not mentioned" if answer is not clearly present
 * - Provides supporting evidence when found
 */
export async function answerMeetingQuestion(
  chunks: TranscriptChunk[],
  question: string,
): Promise<ExtractiveAnswer & { promptVersions?: PromptUsageRecord }> {
  const transcript = formatTranscript(chunks);

  const response = await openai.chat.completions.create({
    model: MODEL_ASSIGNMENTS.RAG_COMPOSITION,
    temperature: 0, // Deterministic extraction
    top_p: 0.1, // Restrict vocabulary for consistency
    messages: [
      {
        role: "system",
        content: RAG_EXTRACTIVE_ANSWER_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: buildExtractiveAnswerUserPrompt(question, transcript),
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned empty extractive answer");
  }

  // Strip markdown code fences if present
  const jsonStr = content.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  const parsed = JSON.parse(jsonStr) as { answer: string; evidence?: string | null; wasFound: boolean };

  return {
    answer: parsed.answer,
    evidence: parsed.evidence ?? undefined,
    wasFound: parsed.wasFound,
    promptVersions: { RAG_EXTRACTIVE_ANSWER_SYSTEM_PROMPT: PROMPT_VERSIONS.RAG_EXTRACTIVE_ANSWER_SYSTEM_PROMPT },
  };
}

/**
 * Build canonical attendee list from transcript metadata.
 * Used for deterministic name normalization after LLM extraction.
 */
function buildCanonicalAttendeeList(attendees?: { leverageTeam?: string; customerNames?: string }): string[] {
  if (!attendees) return [];
  const names: string[] = [];
  if (attendees.leverageTeam) {
    names.push(...attendees.leverageTeam.split(",").map((n) => n.trim()).filter(Boolean));
  }
  if (attendees.customerNames) {
    names.push(...attendees.customerNames.split(",").map((n) => n.trim()).filter(Boolean));
  }
  return names;
}

/**
 * Deterministic name normalization: Map LLM output to canonical attendee names.
 * 
 * Rules:
 * - Exact match (case-insensitive) → use canonical spelling
 * - First name match to unique person → use canonical spelling
 * - "Unassigned" stays as-is
 * - Company/team names stay as-is (not normalized to person names)
 * - Empty/blank segments are filtered out
 */
function normalizeOwnerName(rawOwner: string, canonicalNames: string[]): string {
  if (!rawOwner || rawOwner.trim() === "" || rawOwner === "Unassigned") {
    return rawOwner || "Unassigned";
  }

  const trimmed = rawOwner.trim();
  const lower = trimmed.toLowerCase();

  // Multi-owner format: "Person A and Person B" or "Person A, Person B"
  // Check this FIRST to recursively normalize each part
  if (trimmed.includes(" and ") || (trimmed.includes(",") && !trimmed.startsWith(","))) {
    const parts = trimmed.split(/,\s*|\s+and\s+/i)
      .map(p => p.trim())
      .filter(p => p.length > 0); // Filter empty segments

    if (parts.length > 1) {
      const normalized = parts.map(p => normalizeOwnerName(p, canonicalNames));
      const filtered = normalized.filter(n => n && n !== "Unassigned" && n.length > 0);
      return filtered.length > 0 ? filtered.join(", ") : "Unassigned";
    }
  }

  // Exact match (case-insensitive)
  const exactMatch = canonicalNames.find(n => n.toLowerCase() === lower);
  if (exactMatch) return exactMatch;

  // First name match (only if unique)
  const firstNameMatches = canonicalNames.filter(n => {
    const firstName = n.split(" ")[0].toLowerCase();
    return firstName === lower || lower === firstName;
  });
  if (firstNameMatches.length === 1) return firstNameMatches[0];

  // No match - return as-is (cleaned)
  return trimmed;
}

/**
 * Extract action-state next steps from a meeting transcript.
 * 
 * This is the upgraded version of commitment extraction.
 * Quality target: Google Meet's "Suggested next steps" or better.
 * 
 * Action types extracted:
 * - commitment: Explicit "I will" / "We will" statements
 * - request: "Can you..." / "Please..." that imply follow-up
 * - blocker: "We can't proceed until..." dependencies
 * - plan: "The plan is to..." / "Next we'll..." decisions
 * - scheduling: Meeting or follow-up coordination
 * 
 * Principles:
 * - Actions are extracted, not inferred
 * - Must have clear ownership (prefer people over organizations)
 * - Must have transcript grounding (evidence)
 * - Two-tier confidence: primary (≥0.85) and secondary (0.7-0.85)
 * - Precision > recall (false positives worse than omissions)
 */
export async function extractMeetingActionStates(
  chunks: TranscriptChunk[],
  attendees?: { leverageTeam?: string; customerNames?: string },
): Promise<ActionExtractionResult & { promptVersions?: PromptUsageRecord }> {
  const transcript = formatTranscript(chunks);
  const canonicalNames = buildCanonicalAttendeeList(attendees);

  // Format attendee list for prompt
  const attendeeListStr = canonicalNames.length > 0
    ? `\nCANONICAL ATTENDEES (normalize owner names to these exact spellings):\n${canonicalNames.join(", ")}`
    : "";

  const response = await openai.chat.completions.create({
    model: MODEL_ASSIGNMENTS.ACTION_ITEM_EXTRACTION,
    temperature: 0, // Deterministic extraction - same input = same output
    top_p: 0.1, // Restrict vocabulary for consistency
    messages: [
      {
        role: "system",
        content: RAG_ACTION_ITEMS_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: buildActionItemsUserPrompt(transcript, attendeeListStr),
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned empty action extraction");
  }

  // Debug logging
  console.log(`[extractMeetingActionStates] LLM response length: ${content.length} chars`);
  console.log(`[extractMeetingActionStates] Raw response preview: ${content.substring(0, 500)}`);

  // Strip markdown code fences if present
  const jsonStr = content.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();

  let parsed: MeetingActionItem[];
  try {
    parsed = JSON.parse(jsonStr) as MeetingActionItem[];
    console.log(`[extractMeetingActionStates] Parsed ${parsed.length} action items`);
  } catch (e) {
    console.error(`[extractMeetingActionStates] JSON parse error: ${e}`);
    console.error(`[extractMeetingActionStates] JSON string: ${jsonStr.substring(0, 300)}`);
    throw e;
  }

  // Post-process: Deterministic name normalization + deadline normalization
  const normalized = parsed.map(item => ({
    ...item,
    owner: normalizeOwnerName(item.owner, canonicalNames),
    // Normalize null/undefined/empty deadline to "Not specified"
    deadline: item.deadline && item.deadline.trim() !== "" ? item.deadline.trim() : "Not specified",
  }));

  // ─────────────────────────────────────────────────────────────────
  // GREEN ROOM FILTER: Remove in-call/immediate actions
  // ─────────────────────────────────────────────────────────────────

  // Patterns indicating present-tense/in-meeting actions (not next steps)
  const inCallPatterns = [
    /\bintroduce\s+(you|ryan|them|everyone)\b/i,
    /\b(walk|take)\s+(you|them)\s+through\b/i,
    /\bshow\s+(you|them)\b/i,
    /\bdo\s+a\s+(quick\s+)?(intro|demo|overview)\b/i,
    /\bjump(ing)?\s+(right\s+)?in\b/i,
    /\blet('s|s)\s+(get\s+)?started\b/i,
    /\bpulling\s+up\b/i,
    /\bsharing\s+(my\s+)?screen\b/i,
    /\bgive\s+(you|them)\s+a\s+(little\s+)?background\b/i,
    /\bname\s*drop\b/i,
    // Meta-commentary about what to say IN the meeting
    /\bi'm going to say\b/i,
    /\bjust to remind (you|them|the team)\b/i,
    /\bremind (you|them|the team) that\b/i,
    /\bi('ll| will) mention\b/i,
    /\bi('ll| will) bring up\b/i,
    /\bwe('ll| will) talk about\b/i,
    /\bwe('ll| will) discuss\b/i,
    /\bwe('ll| will) cover\b/i,
  ];

  // Patterns indicating legitimate future actions (boost these)
  const futurePatterns = [
    /\bafter\s+the\s+call\b/i,
    /\bnext\s+step/i,
    /\bfollow[\s-]*up\b/i,
    /\bcircle\s+back\b/i,
    /\bget\s+back\s+to\s+you\b/i,
    /\bsend\s+(you|them)\s+.*\b(after|later|tomorrow|next\s+week)\b/i,
    /\bschedule\s+a\s+(follow[\s-]*up|call|meeting)\b/i,
    /\bwork\s+with\s+.*\s+on\s+identifying\b/i,
  ];

  const greenRoomFiltered = normalized.filter(item => {
    const evidence = item.evidence.toLowerCase();
    const action = item.action.toLowerCase();

    // Check if it's clearly an in-call action
    const isInCallAction = inCallPatterns.some(p => p.test(evidence) || p.test(action));

    // Check if it has future-oriented markers (protect from filtering)
    const hasFutureMarkers = futurePatterns.some(p => p.test(evidence) || p.test(action));

    // Filter out in-call actions UNLESS they have explicit future markers
    if (isInCallAction && !hasFutureMarkers) {
      console.log(`[GreenRoom] Filtered: "${item.action}" (in-call pattern detected)`);
      return false;
    }

    return true;
  });

  console.log(`[extractMeetingActionStates] After Green Room filter: ${greenRoomFiltered.length} items (removed ${normalized.length - greenRoomFiltered.length})`);

  // Two-tier confidence filtering:
  // - Primary (≥0.85): High-confidence explicit actions
  // - Secondary (0.70-0.85): Implied but real actions worth tracking
  // - Below 0.70: Omit entirely (precision > recall)
  const primary = greenRoomFiltered.filter((a) => a.confidence >= 0.85);
  const secondary = greenRoomFiltered.filter((a) => a.confidence >= 0.70 && a.confidence < 0.85);

  return {
    primary,
    secondary,
    promptVersions: { RAG_ACTION_ITEMS_SYSTEM_PROMPT: PROMPT_VERSIONS.RAG_ACTION_ITEMS_SYSTEM_PROMPT },
  };
}
