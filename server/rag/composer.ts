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
 * DEPRECATED: Legacy type for backward compatibility.
 * @deprecated Use MeetingActionItem instead.
 */
export type MeetingCommitment = {
  task: string;
  owner: string;
  deadline?: string;
  evidence: string;
  confidence: number;
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
 * DEPRECATED: Legacy type for backward compatibility.
 * @deprecated Use ActionExtractionResult instead.
 */
export type CommitmentExtractionResult = {
  confirmed: MeetingCommitment[];
  followUps: MeetingCommitment[];
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
): Promise<MeetingSummary> {
  const transcript = formatTranscript(chunks);

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `
You are an internal assistant summarizing a customer meeting.

Stance: neutral but direct.

Rules:
- Use ONLY the provided transcript.
- Do NOT invent product capabilities or facts.
- Do NOT infer emotions or intent unless explicitly stated.
- Prefer stating uncertainty over guessing.
- Be concise and factual.
        `.trim(),
      },
      {
        role: "user",
        content: `
Produce a structured meeting summary with:
- A short, factual title
- Purpose: one sentence explaining WHY this meeting happened (not what was discussed)
- Focus areas: 2-5 recurring themes that dominated the discussion (not one-off comments)
- Key takeaways (prioritized, non-redundant)
- Risks or open questions
- Recommended next steps grounded in the discussion

Return valid JSON only with this shape:
{
  "title": string,
  "purpose": string,
  "focusAreas": string[],
  "keyTakeaways": string[],
  "risksOrOpenQuestions": string[],
  "recommendedNextSteps": string[]
}

Transcript:
${transcript}
        `.trim(),
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned empty meeting summary");
  }

  // Strip markdown code fences if present
  const jsonStr = content.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  return JSON.parse(jsonStr) as MeetingSummary;
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
): Promise<QuoteSelectionResult> {
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
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `
You select representative quotes from customer speakers in a meeting.

Rules:
- Use ONLY the provided transcript (which contains only customer statements).
- Select quotes that capture customer priorities, concerns, pain points, or decisions.
- Do NOT rewrite quotes; use exact phrasing.
- Be neutral and factual.
        `.trim(),
      },
      {
        role: "user",
        content: `
Select up to ${maxQuotes} representative customer quotes.

Return valid JSON only as an array with this shape:
[
  {
    "chunkIndex": number,
    "speakerRole": "customer",
    "quote": string,
    "reason": string
  }
]

Transcript:
${transcript}
        `.trim(),
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned empty quote selection");
  }

  // Strip markdown code fences if present
  const jsonStr = content.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  return { quotes: JSON.parse(jsonStr) as SelectedQuote[] };
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
): Promise<ExtractiveAnswer> {
  const transcript = formatTranscript(chunks);

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `
You are answering specific questions about a meeting transcript.

STRICT RULES:
1. Only answer if the transcript EXPLICITLY supports the answer.
2. If the information was NOT mentioned, say: "This wasn't mentioned in the meeting."
3. Do NOT guess, infer, or extrapolate beyond what was said.
4. Prefer exact quantities, names, locations, and decisions when present.
5. Keep answers concise and factual (1-3 sentences).
6. If you find supporting evidence, include a brief quote or reference.

Return valid JSON only with this shape:
{
  "answer": string,
  "evidence": string | null,
  "wasFound": boolean
}

Set wasFound=true only if the answer is explicitly supported by the transcript.
Set wasFound=false and answer="This wasn't mentioned in the meeting." if not found.
        `.trim(),
      },
      {
        role: "user",
        content: `
Question: ${question}

Transcript:
${transcript}
        `.trim(),
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
): Promise<ActionExtractionResult> {
  const transcript = formatTranscript(chunks);
  const canonicalNames = buildCanonicalAttendeeList(attendees);

  // Format attendee list for prompt
  const attendeeListStr = canonicalNames.length > 0
    ? `\nCANONICAL ATTENDEES (normalize owner names to these exact spellings):\n${canonicalNames.join(", ")}`
    : "";

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `
You extract and consolidate action items from meeting transcripts.
Think like a senior operations assistant: "What actions now exist in the world because of this meeting?"

ACTION TYPES TO EXTRACT:
1. commitment: Explicit "I will..." / "We will..." / agreement to do something
2. request: "Can you..." / "Please..." that implies follow-up action
3. blocker: "We can't proceed until..." / dependency that must be resolved
4. plan: "The plan is to..." / "Next we'll..." / decided course of action
5. scheduling: Meeting coordination, follow-up calls, timeline decisions

PRIORITY HEURISTIC (treat these as HIGH-CONFIDENCE actionable commands):
- Permission grants: "You've got the green light to share X" → Action: Share X (0.95)
- Imperative instructions: "You need to chat with Randy" → Action: Chat with Randy (0.95)
- Enablement grants: "Feel free to let them know" → Action: Inform them (0.90)

OBLIGATION TRIGGERS (extract as HIGH-CONFIDENCE tasks when directed at a specific person):
- "You/We need to..." → Extract as commitment (0.95)
- "You/We have to..." → Extract as commitment (0.95)
- "You/We must..." → Extract as commitment (0.95)
- Example: "You need to figure out the pricing" → [Action: Determine pricing strategy, Owner: the person addressed]

DECISION DEPENDENCIES (always extract these):
- A "Chat," "Sync," or "Discussion" is a MANDATORY NEXT STEP if the goal is to make a decision or configure settings.
- Trigger: "You need to chat with [Person] about [Topic]"
- Rule: If the outcome affects business logic (like "alert settings"), it is NOT a social nicety.
- Example: "Chat with Randy about alert thresholds" → Extract (decision required)

DISTINCT DELIVERABLES (do not over-merge):
- If a speaker promises multiple distinct assets in one statement, extract them as SEPARATE tasks.
- Example: "I'll send the login AND the PDF guide" → TWO separate tasks
- Example: "Send login info" + "Send instructions for TV setup" → TWO separate tasks if mentioned separately

WHAT TO IGNORE:
- Hypotheticals: "we could...", "we might..."
- Vague intentions: "we should think about..."
- Rejected or deferred offers
- Questions without confirmed agreement
- Ideas that weren't committed to
- Advisory or "should" statements
- Social niceties: "Let's grab a beer," "Let's catch up soon"
  EXCEPTION: Do NOT filter out "Chats" if they are explicitly about settings, configurations, or approvals (e.g., "Chat with Randy about alert thresholds" is VALID)

SYSTEM FEATURES vs. HUMAN TASKS (critical anti-pattern):
Do NOT extract tasks where a user describes what the SOFTWARE will do.
- Anti-Pattern: "The system provides daily reports" → NOT a task (software feature)
- Anti-Pattern: "Every user will have their own login" → NOT a task (software feature)
- Anti-Pattern: "It generates alerts automatically" → NOT a task (software feature)
- Pattern: "I will email you the daily report manually" → Extract (human action)
- Pattern: "I will set up the login for everyone" → Extract (human action)
Explaining what software does is NOT a task for the person explaining it.

EXTRACTION PROCESS (three phases, internal reasoning only):

## PHASE 1: Scratchpad Analysis & Filtering (CRITICAL STEP)
Before extracting any tasks, perform these filters in your scratchpad:

### 1. Meeting Start Detection (The "Green Room" Filter):
- Scan the transcript for when the ACTUAL meeting begins (e.g., "Hi everyone," "Let's get started," "Thanks for joining," or when external guests are greeted).
- **RULE:** Any text PRIOR to this point is "Pre-Meeting Chatter" (e.g., "Can you hear me?", "I'll share my screen", "Waiting for Bob", "Let me admit them").
- **ACTION:** Completely IGNORE any commitments made in Pre-Meeting Chatter. These are NOT next steps.

### 2. Immediate Resolution Check (The "Just Now" Filter):
If a speaker says "I will [Action]" or "Let me [Action]", scan the IMMEDIATE next 10 turns:
- **Presentation handoffs:** "I'll hand it off to Ryan" followed by Ryan speaking → DISCARD (immediate handoff, not a future task)
- **Screen sharing:** "I'll share my screen" followed by "Can you see it?" → DISCARD (done immediately)
- **Admitting participants:** "I'll admit them" followed by "They're in" → DISCARD (done immediately)
- **Sending links/files:** "I'll send the link" followed by "Just pasted it" or "Sent!" → DISCARD (done immediately)
- **Slide navigation:** "I'll click through the slides" while presenting → DISCARD (in-progress action, not a future task)
- **RULE:** If the action is performed within the call context, it is NOT a next step.

### 3. Participant Filter:
If transcript metadata identifies "Leverege" vs. "Customer" participants, prioritize tasks:
- Promised TO external participants (customer requests)
- Promised BY internal team to deliver something external

## PHASE 2 — Identify candidate action states:
After applying Phase 1 filters, scan for remaining potential actions:
- Explicit commitments that remain OPEN at meeting end
- Requests that imply FUTURE follow-up action
- Blockers or dependencies that require FUTURE resolution
- Plans or decisions that require FUTURE execution
- Scheduling coordination for FUTURE meetings
- Permission grants and imperative instructions for FUTURE actions

Additional examples to DISCARD (immediate in-meeting actions):
- "Let me hand off to [Person]" → They speak next → DISCARD
- "I'll remind them about X" → They say it immediately → DISCARD
- "I'll pull up the deck" → Deck is shown → DISCARD
- "Let me reshare" → Screen is reshared → DISCARD

## PHASE 3 — Normalize and consolidate:
Clean up and merge related micro-actions when:
- Same owner(s)
- Same timeframe
- Same operational goal
Return only the consolidated, clean output.

DE-MERGING CHECK (before finalizing):
- Did a speaker promise multiple distinct items? (e.g., "Login info" AND "Start Guide")
- If yes, keep them as SEPARATE tasks, do NOT merge into one

OBLIGATION CHECK (before finalizing):
- Scan specifically for "Need to" / "Have to" phrases
- Does "You need to chat..." imply a decision? If yes, extract it as a task

RULES:
1. OWNER ASSIGNMENT:
   - Use specific person names, NOT company names
   - The owner is the person who SPOKE or AGREED to the action
   - If multiple owners, list as "Person A, Person B"
   - Use "Unassigned" only if truly unavoidable
   - If canonical attendees provided, normalize spelling

2. EVIDENCE QUOTES (MANDATORY):
   ALWAYS remove these filler words: "um", "uh", "like", "you know", "I mean", repeated words.
   Clean the quote for readability but preserve the exact meaning.
   Example: "you've got the uh the green light" → "you've got the green light"
   Do NOT change meaning or paraphrase facts.

3. CONFIDENCE SCORING:
   - 0.95-1.0: Explicit "I will do X" statement
   - 0.90: Clear verbal agreement to a request
   - 0.85: "We will..." or confirmed plan
   - 0.80: Investigation commitment ("we'll look into that")
   - 0.75: Request that implies action ("can you send...")
   - 0.70: Softer implied action worth tracking
   - Below 0.70: Too uncertain, do NOT include

4. DEADLINE: Extract if explicitly stated. Use "Not specified" otherwise.

5. ACTION PHRASING:
   Use clean verb + object format.
   Phrase as complete, professional sentences.
   After consolidation, each action = one coherent deliverable.

WHAT NOT TO DO:
- Do NOT merge actions across different owners
- Do NOT paraphrase evidence into new facts
- Do NOT infer actions that weren't spoken
- Do NOT use "should" or "recommended" language
- Do NOT include speculative or advisory items

If choosing between extracting more actions with uncertainty vs. fewer with confidence, choose fewer.

Return valid JSON only (no chain-of-thought):
[
  {
    "action": string,
    "owner": string,
    "type": "commitment" | "request" | "blocker" | "plan" | "scheduling",
    "deadline": string,
    "evidence": string,
    "confidence": number
  }
]

If no clear actions exist, return an empty array: []
        `.trim(),
      },
      {
        role: "user",
        content: `
Extract and consolidate action items from this meeting transcript.
${attendeeListStr}

Transcript:
${transcript}
        `.trim(),
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned empty action extraction");
  }

  // Strip markdown code fences if present
  const jsonStr = content.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  const parsed = JSON.parse(jsonStr) as MeetingActionItem[];

  // Post-process: Deterministic name normalization + deadline normalization
  const normalized = parsed.map(item => ({
    ...item,
    owner: normalizeOwnerName(item.owner, canonicalNames),
    // Normalize null/undefined/empty deadline to "Not specified"
    deadline: item.deadline && item.deadline.trim() !== "" ? item.deadline.trim() : "Not specified",
  }));

  // Two-tier confidence filtering:
  // - Primary (≥0.85): High-confidence explicit actions
  // - Secondary (0.70-0.85): Implied but real actions worth tracking
  // - Below 0.70: Omit entirely (precision > recall)
  const primary = normalized.filter((a) => a.confidence >= 0.85);
  const secondary = normalized.filter((a) => a.confidence >= 0.70 && a.confidence < 0.85);

  return { primary, secondary };
}

/**
 * @deprecated Use extractMeetingActionStates instead.
 * Legacy wrapper for backward compatibility.
 */
export async function extractMeetingCommitments(
  chunks: TranscriptChunk[],
  attendees?: { leverageTeam?: string; customerNames?: string },
): Promise<CommitmentExtractionResult> {
  const result = await extractMeetingActionStates(chunks, attendees);
  
  // Map new format to legacy format
  const mapToLegacy = (item: MeetingActionItem): MeetingCommitment => ({
    task: item.action,
    owner: item.owner,
    deadline: item.deadline === "Not specified" ? undefined : item.deadline,
    evidence: item.evidence,
    confidence: item.confidence,
  });
  
  return {
    confirmed: result.primary.map(mapToLegacy),
    followUps: result.secondary.map(mapToLegacy),
  };
}
