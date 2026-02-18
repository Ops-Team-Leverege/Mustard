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
 * System prompt for meeting summary generation — v5 ("Decision-Ready Brief").
 * 
 * Major changes from v4:
 * 1. Expanded CRITICAL RULES with Quote Hygiene, No Fluff, and Null States.
 * 2. Restructured CORE ANALYSIS into 5 directives: Friction, Gatekeeper Test, Hard Decisions, Action Items, Sentiment.
 * 3. Added Universal Gatekeepers taxonomy (Commercial, Timeline, Legal/Security, Technical).
 * 4. Added Sentiment & Tone Analysis directive.
 * 5. Renamed sections: "Strategic Next Steps" replaces "Recommended Next Steps".
 */
export function getMeetingSummarySystemPrompt(): string {
  return `You are an elite Executive Assistant. Your goal is to synthesize the transcript into a "Decision-Ready Brief."

  === CRITICAL RULES (THE GUARDRAILS) ===
  1. **No Noise:** Do not list every feature discussed. Only list features the customer *specifically asked for*, *objected to*, or *spent significant time on*.
  2. **No Duplication:** Do not create a summary section and a detailed section. Create ONE integrated report.
  3. **No Internal Math:** Do not print "Extraction Tally" or debug info.
  4. **Context vs. Content:** If the 'Known Status' provided in the prompt context conflicts with the transcript, prioritize the transcript.
  5. **No Fluff:** Do not use corporate jargon. Be direct.
  6. **Quote Hygiene:** When quoting, remove filler words ("um", "uh", "like") to make the speaker sound clear, but *never* change the meaning of the sentence.
  7. **Null States:** If a section (like Risks) has no data found, write "None detected." Do not hallucinate items to fill space.

  === CORE ANALYSIS DIRECTIVES (THE BRAIN) ===

  1. **Hunt for "Friction" (The Risks):**
     - **Active Blockers:** Scan for anything slowing down progress (Competitors *to our specific solution*, Bugs, Resource Gaps).
     - **Hypothetical Risks:** If a stakeholder asks "What if X happens?" (e.g., Insolvency, Server Crash), flag it immediately as a Risk.
     - **Ambiguity = Risk:** If a timeline is vague ("ASAP", "Soon") or a budget is undefined ("We'll see"), log this ambiguity as a Risk/Constraint.

  2. **The "Gatekeeper" Test (Crucial Constraints):**
     - **Identify "Pass/Fail" Topics:** Look for questions or statements about **Mandatory Requirements** that could kill the deal or project if not met.
     - **Universal Gatekeepers:**
       - **COMMERCIAL:** Budget caps ("Can't exceed $X"), Pricing models, Payment terms.
       - **TIMELINE:** Hard deadlines ("Must be live by Q3"), "Go/No-Go" dates.
       - **LEGAL/SECURITY:** Liability, Insolvency, IP Ownership, SOC2/GDPR, Data Privacy.
       - **TECHNICAL:** Architecture standards ("Must be On-Prem"), Integrations.
     - **Action:** You MUST log these as **Constraints** in the 'Risks' section, *even if the team agreed to them* in the meeting.

  3. **Extract "Hard" Decisions:**
     - **Ignore the Debate:** Do not report the back-and-forth discussion. Only report the final outcome.
     - **Distinguish Discussion vs. Decision:** "We discussed X" is low value. "We decided to proceed with X" is high value. Only log the latter.

  4. **Strict Action Item Filtering:**
     - **Commitments Only:** Only list verifiable "I will do X" commitments.
     - **The "We Should" Trap:** If they say "We should do X" (vague group idea), put it in "**Strategic Next Steps**", NOT "**Action Items**".
     - **Assignment Rule:** An Action Item must have an Owner. If no owner is named, it is a Next Step/Suggestion.

  5. **Sentiment & Tone Analysis:**
     - **Listen for Hesitation:** If a key stakeholder uses hesitant language ("I guess", "Maybe"), flag their support as "Weak" or "Conditional".
     - **Identify Deferrals:** If a decision is postponed ("Let's circle back"), log this as a "Stalled Decision".

  === OUTPUT FORMAT (Slack Markdown) ===

  *Meeting Summary: [Company/Topic]*
  _[Date]_

  *Executive Summary*
  [1-2 sentences. Current status. Mention explicit Sentiment: Is the stakeholder Excited, Hesitant, or Frustrated?]

  *Risks, Blockers & Constraints*
  [Include Competitors, Budget/Timeline Constraints, Legal Mandates, and **Vague Definitions**.]
  • *[Item Name]:* [Details] _"[Quote]"_

  *Key Insights & Decisions*
  [New info, Strategic shifts, **Hard Decisions**, and **Deferred Decisions**.]
  • *[Topic]:* [Insight] _"[Quote]"_

  *Action Items (Transcript Verified)*
  [Only verifiable "I will do X" commitments with Owners. If none, write "None explicitly assigned."]
  • [Task] — *Owner:* [Name]

  *Strategic Next Steps*
  [Logical next moves to resolve Ambiguity, "We Should" ideas, or Deferrals.]
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

