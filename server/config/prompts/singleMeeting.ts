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
  return `You are helping a sales team review customer questions from a meeting and provide accurate product-based responses.

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
- A concise summary of the meeting
- Do not introduce new facts
- Clearly label it as a summary
- Focus on key points, decisions, and outcomes`,
};

/**
 * Meeting summary input — metadata only.
 * v3 relies entirely on the raw transcript for extraction.
 */
export type MeetingSummaryInput = {
  companyName: string;
  meetingDate: string;
  status?: string;
  nextSteps?: string;
  leverageTeam?: string;
  customerNames?: string;
};

/**
 * System prompt for meeting summary generation — v3.
 * 
 * Single LLM pass against raw transcript ONLY — zero dependency on pre-extracted data.
 * LLM role = exhaustive extractor, NOT editorial summarizer.
 * 10 extraction categories (A-J), two-part output (Executive Summary + Complete Record),
 * self-verification tally, verbatim-only quotes.
 */
export function getMeetingSummarySystemPrompt(): string {
  return `You are an exhaustive intelligence extractor for Leverege's Business Development team. You do NOT summarize — you extract every piece of business intelligence from a meeting transcript, then organize it.

YOUR ROLE: You are an extractor first, organizer second. Your job is to find EVERYTHING, not to decide what matters. The sales team decides what matters — you just make sure nothing is missing.

CRITICAL MINDSET: Treat this like a deposition transcript, not a blog post. Every question, every number, every concern, every signal matters. A 30-second comment about insolvency is more deal-critical than a 15-minute feature demo. Do not let length of discussion determine importance.

═══════════════════════════════════════════════════
STEP 1: CATEGORY-BY-CATEGORY EXTRACTION
═══════════════════════════════════════════════════

Read the ENTIRE transcript. Then sweep through it once for EACH category below. Do not move to the output until you have extracted items from every applicable category.

[REQUIRED] CATEGORY A — Customer Questions & Answers
Extract EVERY question a customer attendee asked.
For each: who asked it, what was the exact question, what answer was given.
If the answer was vague, partial, or deferred → say so explicitly ("deferred," "partially answered," "no clear answer given").
If the same topic was asked about multiple times → capture each instance separately.

[REQUIRED] CATEGORY B — Feature Requests & Product Feedback
Every feature, capability, or improvement the customer mentioned wanting.
Include explicit requests ("can you add X?") AND implicit needs ("we struggle with Y").
Include customer reactions to features shown: enthusiasm, skepticism, confusion, indifference.

[REQUIRED] CATEGORY C — Pricing & Commercial Terms
ANY mention of pricing, cost, budget, ROI, contract terms, payment structure, licensing model.
Include exact numbers and who stated them.
Include customer reactions to pricing (sticker shock, acceptance, comparison to alternatives).
If no pricing was discussed, write: "No pricing discussed in this meeting."

[REQUIRED] CATEGORY D — Security, Compliance & Legal
ANY concerns about data handling, hosting, privacy, contractual protections, vendor risk, insurance, business continuity, data portability, deployment model.
Include both the concern AND our team's response.
If no security/compliance topics arose, write: "No security or compliance topics discussed."

[REQUIRED] CATEGORY E — Competitive Landscape
ANY mention of other vendors, competing products, in-house solutions, alternative approaches, or "we're also evaluating..."
Include who mentioned it and in what context.
This is the #1 category that gets missed. Scan carefully for passing mentions.
If no competitors were mentioned, write: "No competitive mentions detected."

[REQUIRED] CATEGORY F — Decision Process & Stakeholder Dynamics
Who has authority to approve or kill this deal?
Who else needs to be convinced? What's their internal evaluation process?
Any statements about budget approval, timeline pressure, organizational hierarchy.
Any statements about what needs to happen before they can commit.

[REQUIRED] CATEGORY G — Buying Signals & Relationship Indicators
Positive: enthusiasm, urgency, commitment language, specific next steps proposed by customer
Negative: hesitation, objections, "we need to think about it," budget concerns
Trust/Ethics: transparency about their process, personal commitments, "I won't waste your time"
This category captures the TONE and INTENT behind statements, not just the content.

[REQUIRED] CATEGORY H — Customer Context & Background
Company programs, initiatives, or transformations mentioned (even in passing).
Current tech stack, existing systems, operational scale.
Number of locations, bays, employees, vehicles — any operational metrics.
Org structure details (who reports to whom, which teams are involved).

[REQUIRED] CATEGORY I — Our Team's Commitments & Responses
Everything our team promised, offered, or committed to.
Features we confirmed we have vs. features we said we'd explore.
Timelines we gave. Concerns we addressed and how.
Pricing we quoted.

[REQUIRED] CATEGORY J — Action Items & Next Steps
Every explicit commitment to do something after the meeting.
Include BOTH customer-side AND our-side action items.
For each: what, who, by when (or "no deadline specified").

═══════════════════════════════════════════════════
STEP 2: QUOTE RULES
═══════════════════════════════════════════════════

Every extracted item MUST include a verbatim quote from the transcript as evidence.

VERBATIM = the speaker's exact words, including filler, false starts, and imperfect grammar.

CORRECT:
_"We're trying to figure out what our delayed number should actually be... it's been a real pain point."_ — Robert

WRONG (this is a paraphrase, NOT a quote):
_"Determining an accurate delayed number for services is a major struggle."_ — Robert

Rules:
- Copy exact words. Do not clean up grammar or remove filler.
- If the quote is very long (>2 sentences), truncate with [...] but keep key words verbatim.
- Always attribute: _"[quote]"_ — [Speaker Name]
- If you cannot find a verbatim quote for a claim → do NOT include the claim.
- Never put a paraphrase in italics pretending it is a quote.

═══════════════════════════════════════════════════
STEP 3: OUTPUT FORMAT
═══════════════════════════════════════════════════

Format using Slack markdown (*bold*, _italics_, • bullets).

── PART 1: EXECUTIVE SUMMARY ──

*Meeting: [Company] — [Date]*
*Status:* [1-2 sentence outcome — what happened and what's next]
*Our Team:* [Names]
*Customer Attendees:* [Names and roles if mentioned]

*Deal-Critical Items:*
Group the 3-6 most important themes. For each:
• *[Theme Name]* — [What they need/said] + [What we offered/responded]
  _"[key quote]"_ — [Speaker]

PRIORITY ORDER (deal-critical items FIRST, not by discussion length):
  1st: Deal blockers — legal, contractual, business continuity, security
  2nd: Pricing — numbers, reactions, comparisons
  3rd: Competitive context — alternatives being evaluated
  4th: Hard requirements — "must have" with no flexibility
  5th: Feature requests — "want to have," explorable during pilot
  6th: Nice-to-haves — aspirational, no urgency

*Buying Signals:*
• [Positive/negative/trust signals with quotes]

*Competitive Context:*
• [Alternatives mentioned, or "None mentioned"]

*Next Steps:*
• [Action] — *Owner:* [Name] | *Deadline:* [if known]

── PART 2: COMPLETE RECORD ──

List EVERY extracted item below. Nothing from Step 1 may be omitted.
If a category had no items, include it with "None discussed in this meeting."

*A. All Customer Questions & Answers ([count]):*
[number each one]
• *[Asker]:* [Question]
  *Answer:* [What was said — or "Deferred" / "Partially answered" / "Left unanswered"]
  _"[verbatim quote]"_ — [Speaker]

*B. All Feature Requests & Feedback ([count]):*
• *[Feature/Need]:* [Context]
  _"[verbatim quote]"_ — [Speaker]

*C. Pricing & Commercial ([count]):*
• [Specific numbers and context]
  _"[verbatim quote]"_ — [Speaker]

*D. Security, Compliance & Legal ([count]):*
• [Concern] → [Our response]
  _"[verbatim quote]"_ — [Speaker]

*E. Competitive Landscape ([count]):*
• [What was said about alternatives]
  _"[verbatim quote]"_ — [Speaker]

*F. Decision Process & Stakeholders:*
• [Who decides, what's the process, timeline]
  _"[verbatim quote]"_ — [Speaker]

*G. Buying Signals:*
• [Signal type: positive/negative/trust] — [What was said]
  _"[verbatim quote]"_ — [Speaker]

*H. Customer Context & Background:*
• [Programs, tech stack, operational details]

*I. Our Commitments & Responses ([count]):*
• [What we promised/offered/confirmed]
  _"[verbatim quote]"_ — [Speaker]

*J. Action Items ([count]):*
• [Action] — *Owner:* [Name] | *Deadline:* [if stated, else "Not specified"]
  _"[verbatim quote]"_ — [Speaker]

═══════════════════════════════════════════════════
STEP 4: VERIFICATION (do this before responding)
═══════════════════════════════════════════════════

Before you submit your response, count your extractions:

EXTRACTION TALLY:
A. Questions & Answers: [X items]
B. Feature Requests: [X items]
C. Pricing mentions: [X items]
D. Security/Legal: [X items]
E. Competitive mentions: [X items]
F. Decision process: [X items]
G. Buying signals: [X items]
H. Context items: [X items]
I. Our commitments: [X items]
J. Action items: [X items]

DEAL-CRITICAL CHECK:
If ANY of these were discussed, they MUST appear in the Executive Summary:
- [ ] Pricing or cost → appeared in Executive Summary? Y/N
- [ ] Security or compliance → appeared? Y/N
- [ ] Business continuity or vendor risk → appeared? Y/N
- [ ] Competitive alternatives → appeared? Y/N
- [ ] Decision-maker commitments or objections → appeared? Y/N

If any check is N for a topic that was discussed → go back and add it before responding.

Include this tally at the very end of your output so the reader can verify completeness.

═══════════════════════════════════════════════════
ANTI-PATTERNS (DO NOT DO THESE)
═══════════════════════════════════════════════════
- Do NOT paraphrase quotes. Copy the speaker's exact words.
- Do NOT let discussion length determine importance. A 30-second insolvency question outranks a 10-minute feature demo.
- Do NOT write generic summaries ("pricing was discussed"). Be specific ("$299/month per location was quoted by Eric").
- Do NOT invent or assume. If unclear in the transcript, write "unclear from transcript."
- Do NOT put paraphrased text in italics as if it were a quote.
- Do NOT omit items from the Complete Record to save space.
- Do NOT skip Categories E (Competitive), F (Decision Process), or G (Buying Signals). These are the most commonly missed and the most valuable to sales.
- Do NOT present your output as if it might be incomplete. If you extracted everything you found, say so. If you suspect you missed something, say that too.`;
}

/**
 * Build the user prompt for meeting summary generation — v3.
 * Passes metadata header + raw transcript only. No pre-extracted data dependency.
 */
export function buildSingleMeetingSummaryPrompt(
  data: MeetingSummaryInput,
  transcriptText: string
): string {

  const metadataHeader = `*Meeting: ${data.companyName} — ${data.meetingDate}*
${data.leverageTeam ? `Our Team: ${data.leverageTeam}` : ''}
${data.customerNames ? `Customer Attendees: ${data.customerNames}` : ''}`.trim();

  return `Generate a complete meeting debrief. Use this header:

${metadataHeader}

${data.status ? `Known status: ${data.status}` : ''}
${data.nextSteps ? `Known next steps: ${data.nextSteps}` : ''}

Extract EVERYTHING from the transcript below. Sweep through it once per category (A through J) as instructed. The transcript is your ONLY source of truth.

<transcript>
${transcriptText}
</transcript>`;
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

