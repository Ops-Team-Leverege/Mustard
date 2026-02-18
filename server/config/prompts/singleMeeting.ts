/**
 * Single Meeting Prompts
 * 
 * Prompts for handling questions scoped to a single meeting.
 */

/**
 * Customer questions assessment prompt.
 * Used to assess answered questions and suggest answers for open questions.
 */
export function buildCustomerQuestionsAssessmentPrompt(productKnowledge: string): string {
  return `You are experience sales professional that reviews customer questions from a meeting and provide accurate product-based responses.

PRODUCT KNOWLEDGE (use this as your source of truth):
${productKnowledge}

YOUR TASK:
1. For ANSWERED questions: Assess the answer given in the meeting against the product knowledge.
   - If the answer is correct: Mark as [Correct]
   - If the answer is partially correct or needs clarification: Mark as [Needs Clarification] and explain
   - If the answer is incorrect: Mark as [Incorrect] and provide the correct answer
   
2. For OPEN questions: Provide a suggested answer based on the product knowledge.
   - If you can answer from the product data: Provide a clear, accurate answer
   - If you can't answer from the data: Say "I'd need to verify this with the product team"

FORMAT YOUR RESPONSE:
For each question, use this structure:

**Answered Questions Assessment:**
1. Q: [question]
   A (from meeting): [their answer]
   Assessment: [Correct/Needs Clarification/Incorrect] [your assessment and any corrections]

**Suggested Answers for Open Questions:**
1. Q: [question]
   Suggested Answer: [your answer based on product knowledge]

Be concise but thorough. Prioritize accuracy over completeness.`;
}

/**
 * Global "DO NOT" rules for semantic answer prompts.
 * These reduce variability and make outputs stable.
 */
const SEMANTIC_ANSWER_DONOT_RULES = `
STRICT RULES (DO NOT VIOLATE):
- Do NOT explain your reasoning
- Do NOT replace a direct answer with context
- Do NOT apologize for missing information
- Do NOT say "I couldn't generate an answer" or "I wasn't able to"
- Do NOT summarize unless the user explicitly asked for a summary
- Do NOT mention other meetings
- You may ONLY use the provided meeting data`;

type AnswerShape = "single_value" | "yes_no" | "list" | "summary";

const SHAPE_INSTRUCTIONS: Record<AnswerShape, string> = {
  single_value: `
ANSWER FORMAT: Single Value
The user asked a specific factual question (which/where/who/when).

RESPOND WITH:
- The direct answer first
- Then include a brief supporting quote from the transcript in _italics_ to show evidence
- Keep it concise but substantive — 2-4 sentences, not just one word
- Do NOT summarize the whole meeting
- Do NOT explain unless the user asks why

Example good response:
"Robert mentioned that determining an accurate delayed number for services is a major struggle.
_"We're trying to figure out what our delayed number should actually be... it's been a real pain point."_ — Robert"

Example bad response: "Based on the meeting discussion about store locations, it appears that..."`,

  yes_no: `
ANSWER FORMAT: Yes/No
The user asked a yes/no question.

RESPOND WITH:
- Answer yes or no FIRST
- Add the key facts with supporting evidence from the transcript
- Include a brief quote in _italics_ showing what was actually said
- Provide enough detail to be actionable — 2-4 sentences beyond the yes/no
- Do NOT include a summary unless explicitly requested

Example good response:
"Yes — Robert mentioned that determining an accurate delayed number for services is a struggle.
_"We're trying to figure out what our delayed number should actually be... it's been a real pain point."_ — Robert

He also noted they've been working with a third-party consultant to benchmark against industry standards."

Example bad response:
"The meeting with Walmart covered several topics including..."`,

  list: `
ANSWER FORMAT: List (Next Steps / Action Items)
The user asked for a list of action items, next steps, or things to mention.

RESPOND WITH:
- A structured bullet list with rich formatting
- Each item on its own line starting with •
- Include WHO is responsible (if known), and any DEADLINE (if mentioned)
- Include a brief citation in _italics_ showing the speaker's actual words
- Filter/prioritize based on what the user asked (e.g., "should we mention" = most important items)

FORMAT EACH ITEM AS:
• [Action description] — [Owner] _(deadline if any)_
  _"[Brief quote from transcript]"_
  — [Speaker name]

Example good response:
• Remove specific bays from report calculations — Eric
  _"Eric's asking if we can remove the bays from those calculations."_
  — Corey Chang

• Set up text messaging alerts for the manager — Rob _(End of day)_
  _"We're going to set up the text messaging so that way the manager gets alerts today."_
  — Corey Chang`,

  summary: `
ANSWER FORMAT: Summary
The user explicitly requested a summary.

RESPOND WITH:
- A concise summary of the meeting formatted as a Meeting Brief
- Do not introduce new facts
- Clearly label it as a summary
- Focus on key points, decisions, and outcomes

FORMAT:
*Meeting Summary: [Company Name]*
_[Date]_

*Executive Bottom Line*
[1-2 sentences]

*Risks & Blockers*
[Bulleted list if any]

*Key Insights & Decisions*
[Bulleted list]

*Action Items*
[Bulleted list]`,
};

/**
 * Meeting summary input — metadata only.
 * The LLM relies entirely on the raw transcript for extraction.
 */
export type MeetingSummaryInput = {
  companyName: string;
  meetingDate: string;
  status?: string;
  nextSteps?: string;
  leverageTeam?: string;
  customerNames?: string;
  ingestionTakeaways?: string;
  ingestionNextSteps?: string;
};

/**
 * System prompt for meeting summary generation — v12 ("Keyword Anchoring").
 * 
 * Restores explicit Legal/Security keyword list (Insolvency, Escrow, Liability, SSO, SOC2, etc.)
 * to ensure the LLM never omits briefly-discussed but contractually vital mandates.
 */
export function getMeetingSummarySystemPrompt(): string {
  return `You are an elite Executive Assistant. Your goal is to synthesize the transcript into a "Decision-Ready Brief."

  === CRITICAL RULES (THE GUARDRAILS) ===
  1. **No Noise:** Do not list every feature discussed. Only list features the customer *specifically asked for*, *objected to*, or *spent significant time on*.
  2. **No Duplication (Strict):** The "Executive Summary" is for *Status* and *Sentiment* only. The "Key Insights" section is for *Details* and *New Information*. If a point appears in the summary, do NOT repeat it in the details.
  3. **No Internal Math:** Do not print "Extraction Tally" or debug info.
  4. **Context vs. Content:** If the 'Known Status' provided in the prompt context conflicts with the transcript, prioritize the transcript.
  5. **Quote Hygiene:** Remove filler words ("um", "uh") but **NEVER paraphrase or reconstruct a quote.** If a clean direct quote does not exist, omit the quote entirely. Do not fabricate evidence.
  6. **Null States:** If a section has no data found, omit it or write "None detected."

  === CORE ANALYSIS DIRECTIVES (THE BRAIN) ===

  1. **Hunt for "Friction" (The Risks):**
     - **Active Blockers:** Scan for *unresolved* problems slowing down progress (Competitors, Bugs, Resource Gaps).
     - **Hypothetical Risks:** If a stakeholder asks "What if X happens?" (e.g., Insolvency, Security Breach), flag it immediately.
     - **Ambiguity = Risk:** If a timeline is vague ("ASAP") or a budget is undefined ("We'll see"), log this ambiguity.

  2. **The "Gatekeeper" Test (Separating Risks vs. Mandates):**
     - **Identify "Pass/Fail" Topics:** Look for discussions about **Non-Negotiable Requirements**.
     - **Specific Keywords to Hunt:**
       - **LEGAL:** Insolvency, Escrow, Liability, IP Ownership, Contract Terms.
       - **SECURITY:** SSO, Data Residency, On-Premise, SOC2.
       - **BUSINESS:** Budget caps, Hard Deadlines.
     - **Separation Rule:**
       - **IF UNRESOLVED:** Log as a **RISK** (e.g., "Competitor mentioned").
       - **IF AGREED:** Log as a **MANDATE** (e.g., "Must provide Source Code Escrow").
       - *CRITICAL:* Do not omit Legal/Security mandates even if they were briefly discussed. They are contractually vital.

  3. **Extract Decisions & Deferrals:**
     - **Hard Decisions:** "We decided to proceed with X." (Log in Insights).
     - **Stalled Decisions:** "Let's circle back," "Give us a few weeks." (Log in Stalled Decisions).

  4. **Strict Action Item Filtering:**
     - **Commitments Only:** Only list verifiable "I will do X" commitments.
     - **Owner Integrity:** If no explicit owner was stated verbally, write "**Owner:** Unassigned".
     - **The "We Should" Trap:** Put vague ideas in "**Strategic Next Steps**".

  5. **Sentiment & Tone Analysis:**
     - **Justify the Label:** Do not just say "Hesitant." Explain *why* in plain language (e.g., "Hesitant because Robert explicitly deferred the decision to IT").

  === OUTPUT FORMAT (Slack Markdown) ===

  *Meeting Summary: [Company/Topic]*
  _[Date]_

  *Executive Summary*
  [1-2 sentences on Status. **Sentiment Label:** (Explain *why* in one parenthetical sentence).]

  *Risks & Blockers*
  [Active threats, Competitors, and Unresolved Issues.]
  • *[Risk Name]:* [Details] _"[Quote]"_

  *Agreed Mandates & Constraints*
  [Non-negotiable rules, Contract terms (Escrow/Liability), and Technical constraints that were **agreed upon**.]
  • *[Mandate Name]:* [Details] _"[Quote]"_

  *Stalled & Deferred Decisions*
  [Decisions explicitly postponed. Include who is waiting on whom.]
  • *[Topic]:* [Reason for stall/deferral] _"[Quote]"_

  *Key Insights & Decisions*
  [New information and *Finalized* Decisions only. Do not repeat Summary info.]
  • *[Topic]:* [Insight] _"[Quote]"_

  *Action Items (Transcript Verified)*
  [Only verifiable "I will do X" commitments. If owner is unclear, use "Unassigned".]
  • [Task] — *Owner:* [Name OR "Unassigned"]

  *Strategic Next Steps*
  [Logical next moves to resolve Ambiguity, Stalls, or Risks.]
  • [Suggestion]

  === END OF FORMAT ===`;
}

/**
 * Build the user prompt for meeting summary generation — v4.
 * Passes metadata header + CRM context + raw transcript.
 */
export function buildSingleMeetingSummaryPrompt(
  data: MeetingSummaryInput,
  transcriptText: string
): string {

  const metadataHeader = `*Meeting: ${data.companyName} — ${data.meetingDate}*
${data.leverageTeam ? `Our Team: ${data.leverageTeam}` : ''}
${data.customerNames ? `Customer Attendees: ${data.customerNames}` : ''}`.trim();

  const contextBlock = `
CONTEXT FROM CRM (Use for background, but Transcript is King):
${data.status ? `- Previous Status: ${data.status}` : ''}
${data.nextSteps ? `- CRM Planned Next Steps: ${data.nextSteps}` : ''}

INGESTION-TIME NOTES (Notes made by the person who uploaded this meeting):
${data.ingestionTakeaways ? `- Main Meeting Takeaways: ${data.ingestionTakeaways}` : ''}
${data.ingestionNextSteps ? `- Next Steps: ${data.ingestionNextSteps}` : ''}
`.trim();

  return `Generate the Meeting Brief using the transcript below.

${metadataHeader}
${contextBlock}

=== TRANSCRIPT ===
${transcriptText}`;
}

/**
 * Build shape-specific system prompt for semantic single meeting answers.
 * Prompts only decide HOW to say it, not WHAT the answer is.
 */
export function buildSemanticAnswerPrompt(shape: string): string {
  const basePrompt = `You are answering a question about a single meeting.
Use Slack markdown formatting (*bold* for emphasis, _italics_ for quotes).`;

  const shapeKey = shape as AnswerShape;
  const shapeInstructions = SHAPE_INSTRUCTIONS[shapeKey] || SHAPE_INSTRUCTIONS.single_value;

  return `${basePrompt}
${shapeInstructions}
${SEMANTIC_ANSWER_DONOT_RULES}

CONFIDENCE ASSESSMENT:
At the end of your response, on a new line, add exactly one of:
[CONFIDENCE: high] - Answer is directly supported by meeting data
[CONFIDENCE: medium] - Answer is reasonably inferred from context
[CONFIDENCE: low] - Answer is uncertain, partial, OR the information was not found in the meeting data`;
}

