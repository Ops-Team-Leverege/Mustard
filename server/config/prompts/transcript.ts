/**
 * Transcript Prompts
 * 
 * Prompts for transcript analysis, insight extraction, and RAG composition.
 * These prompts power the meeting analysis and action item extraction.
 */

/**
 * Meeting summary composition system prompt.
 * Used by RAG composer to generate structured meeting summaries.
 */
export const RAG_MEETING_SUMMARY_SYSTEM_PROMPT = `
You are an internal assistant summarizing a customer meeting.

Stance: neutral but direct.

Rules:
- Use ONLY the provided transcript.
- Do NOT invent product capabilities or facts.
- Do NOT infer emotions or intent unless explicitly stated.
- Prefer stating uncertainty over guessing.
- Be concise and factual.
`.trim();

/**
 * Meeting summary user prompt template.
 */
export function buildMeetingSummaryUserPrompt(transcript: string): string {
  return `
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
`.trim();
}

/**
 * Quote selection system prompt.
 * Used to select representative quotes from customer speakers.
 */
export const RAG_QUOTE_SELECTION_SYSTEM_PROMPT = `
You select representative quotes from customer speakers in a meeting.

Rules:
- Use ONLY the provided transcript (which contains only customer statements).
- Select quotes that capture customer priorities, concerns, pain points, or decisions.
- Do NOT rewrite quotes; use exact phrasing.
- Be neutral and factual.
`.trim();

/**
 * Quote selection user prompt template.
 */
export function buildQuoteSelectionUserPrompt(transcript: string, maxQuotes: number): string {
  return `
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
`.trim();
}

/**
 * Extractive answer system prompt.
 * Used for extracting specific answers from transcript content.
 */
export const RAG_EXTRACTIVE_ANSWER_SYSTEM_PROMPT = `
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
`.trim();

/**
 * Extractive answer user prompt template.
 */
export function buildExtractiveAnswerUserPrompt(question: string, transcript: string): string {
  return `
Question: ${question}

Transcript:
${transcript}
`.trim();
}

/**
 * Action items extraction system prompt.
 * Comprehensive prompt for extracting next steps and commitments from transcripts.
 */
export const RAG_ACTION_ITEMS_SYSTEM_PROMPT = `
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

FUTURE MEETING REQUESTS (HIGH-CONFIDENCE - these are legitimate next steps):
- "We probably need to discuss..." → Extract as scheduling (0.90)
- "We need to discuss in an additional call..." → Extract as scheduling (0.95)
- "I'd love to connect more on that..." → Extract as scheduling (0.90)
- "Let's schedule a follow-up..." → Extract as scheduling (0.95)
- "Can we set up another call to..." → Extract as scheduling (0.90)
- Example: "We probably need to discuss it in an additional call... tandem workflows" → [Action: Schedule follow-up call to discuss tandem workflows, Owner: the person who suggested it, Type: scheduling]

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

META-COMMENTARY / INTERNAL PLANNING (ignore these):
- "I'm going to say..." or "I'll mention..." → This is planning what to say IN the meeting, not a follow-up
- "Just to remind them..." or "Remind the team that..." → In-meeting reminder, not a post-meeting action
- "We'll discuss..." or "We'll cover..." without a future timeframe → Agenda items for THIS call
- Example to IGNORE: "I'm going to say, 'Hey, just to remind you, they have this system...'" → Internal planning, NOT an action item

SYSTEM FEATURES vs. HUMAN TASKS (critical anti-pattern):
Do NOT extract tasks where a user describes what the SOFTWARE will do.
- Anti-Pattern: "The system provides daily reports" → NOT a task (software feature)
- Anti-Pattern: "Every user will have their own login" → NOT a task (software feature)
- Anti-Pattern: "It generates alerts automatically" → NOT a task (software feature)
- Pattern: "I will email you the daily report manually" → Extract (human action)
- Pattern: "I will set up the login for everyone" → Extract (human action)
Explaining what software does is NOT a task for the person explaining it.

EXTRACTION PROCESS:

## STEP 1 — Scan for action items:
Look for these patterns throughout the transcript:
- "I'll send you..." / "I'll email you..." / "I'll share..." → KEEP (future deliverable)
- "We'll schedule..." / "Let's set up a call..." → KEEP (follow-up meeting)
- "I need to check with my team..." / "I'll get back to you..." → KEEP (pending follow-up)
- "We'll get you access..." / "I'll set up login..." → KEEP (future setup)
- "Can you send me...?" / "Could you share...?" → KEEP (request)
- "We'll look into that..." / "We'll investigate..." → KEEP (investigation)
- Permission grants for future sharing → KEEP
- "In terms of next steps..." → DEFINITELY KEEP (explicit next step)

## STEP 2 — Filter only OBVIOUS in-call completions:
ONLY remove an action if there is EXPLICIT EVIDENCE it was completed during the call:
- "I'll paste the link" followed by "Got it, thanks!" → Remove
- "Let me share my screen" while actively presenting → Remove
- Everything else: KEEP IT

**IMPORTANT:** When in doubt, KEEP the action. Most actions are NOT resolved in-call.

## STEP 3 — Normalize and consolidate:
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

BALANCE: Aim for 3-10 actions per typical business meeting. If you're returning 0 items, re-check the transcript for legitimate future commitments.

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
`.trim();

/**
 * Action items user prompt template.
 */
export function buildActionItemsUserPrompt(transcript: string, attendeeListStr: string): string {
  return `
Extract and consolidate action items from this meeting transcript.
${attendeeListStr}

Transcript:
${transcript}
`.trim();
}

/**
 * Transcript analyzer system prompt.
 * Used for analyzing BD call transcripts to extract insights and Q&A.
 */
export const TRANSCRIPT_ANALYZER_SYSTEM_PROMPT =
  "You are an expert at analyzing business development call transcripts to extract product insights and customer questions. Always respond with valid JSON.";

/**
 * Build the transcript analysis user prompt.
 * Dynamic prompt with many template variables for transcript analysis.
 */
export function buildTranscriptAnalysisPrompt(params: {
  transcript: string;
  companyName: string;
  leverageTeam: string[];
  customerNames: string[];
  categoryList: string;
  contentType: "transcript" | "notes";
  chunkInfo?: string;
}): string {
  const { transcript, companyName, leverageTeam, customerNames, categoryList, contentType, chunkInfo = "" } = params;
  const isNotes = contentType === "notes";
  const contentLabel = isNotes ? "meeting notes" : "BD (Business Development) call transcript";

  return `You are analyzing ${contentLabel} to extract product insights and Q&A pairs${chunkInfo}.

${isNotes ? 'MEETING NOTES:' : 'TRANSCRIPT:'}
${transcript}

CONTEXT:
- Company: ${companyName}
- Leverege Team Members: ${leverageTeam.join(', ')}
- Customer Names: ${customerNames.join(', ')}

AVAILABLE CATEGORIES:
${categoryList}

${isNotes ? `
NOTE: These are meeting notes from an onsite visit, not a full transcript. The notes may be brief, informal, or fragmented. Extract insights and questions based on the captured information, understanding that details may be condensed or paraphrased by the note-taker.
` : ''}

TASK 1 - Extract Product Insights (LEARNINGS ONLY):
Focus on meaningful learnings, NOT simple confirmations or explanations. Extract insights ONLY if they meet one of these criteria:

A) Customer comments on EXISTING features that reveal VALUE/USEFULNESS:
   - How useful/important a feature is to them
   - Their specific use case that shows why they need it
   - Pain points the feature would solve

B) Customer asks about or expresses interest in NEW features we DON'T currently have:
   - Requests for capabilities we don't offer
   - Questions about features we're missing
   - Suggestions for improvements

DO NOT include:
- Simple confirmations of how a feature works
${isNotes ? '- General observations without specific product relevance' : '- BD team explaining features (unless customer responds with value/need)'}
- Administrative or scheduling topics

For each insight:
- feature: The specific feature or capability name
- context: Why this feature is important/valuable to the customer (their use case/need)
- quote: ${isNotes ? 'Key observation or customer statement from notes - lightly paraphrased for clarity' : 'Customer quote - lightly paraphrased for readability while preserving exact intent and meaning'}
- categoryId: Match to one of the category IDs above, or null if no good match (will be marked as NEW)

TASK 2 - Extract Q&A Pairs:
${isNotes ? 'Identify any product-specific questions that were asked and answered during the meeting.' : 'Identify product-specific questions asked during the call.'} For each:
- question: The question that was asked (product-related only, not scheduling/admin) - lightly paraphrased for clarity
- answer: The answer that was provided - lightly paraphrased for clarity
- asker: The name of the person who asked (from customer names list)
- categoryId: Match to one of the category IDs above, or null if no good match (will be marked as NEW)

TASK 3 - Detect Point of Sale (POS) System:
If the customer mentions their POS system by name (e.g., Square, Toast, Clover, Lightspeed, NCR, etc.), extract:
- name: The POS system name (normalized, e.g., "Square" not "square pos system")
- websiteLink: If mentioned or if you know it, provide the official website (optional)
- description: Brief description of what was mentioned about it (optional)

If no POS system is mentioned, set "posSystem" to null.

OUTPUT FORMAT:
Respond with valid JSON in this exact structure:
{
  "insights": [
    {
      "feature": "feature name",
      "context": "why valuable to customer",
      "quote": "paraphrased customer quote (readable, intent preserved)",
      "categoryId": "category-id-or-null"
    }
  ],
  "qaPairs": [
    {
      "question": "paraphrased question (clear and readable)",
      "answer": "paraphrased answer (clear and readable)",
      "asker": "person name",
      "categoryId": "category-id-or-null"
    }
  ],
  "posSystem": {
    "name": "POS system name",
    "websiteLink": "https://example.com (optional)",
    "description": "brief description (optional)"
  }
}

IMPORTANT:
- Be SELECTIVE - only include real learnings, not confirmations
- Paraphrase quotes lightly for readability without changing meaning
- Focus on VALUE and NEW capabilities
- categoryId must be one of the IDs listed above or null
- Only include product-specific Q&A, not logistics/scheduling`;
}
