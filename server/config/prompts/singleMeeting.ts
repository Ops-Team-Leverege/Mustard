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
 * Structured meeting data for the summary formatter.
 * All fields come from pre-extracted database records — no raw transcript analysis.
 */
export type MeetingSummaryData = {
  companyName: string;
  meetingDate: string;
  status: string;
  nextSteps: string;
  leverageTeam: string;
  customerNames: string;
  productInsights: Array<{
    feature: string;
    context: string;
    quote: string;
    categoryName?: string | null;
  }>;
  qaPairs: Array<{
    question: string;
    answer: string;
    asker: string;
  }>;
  actionItems: Array<{
    action: string;
    owner: string;
    deadline: string | null;
  }>;
};

/**
 * System prompt for meeting summary formatting.
 * 
 * The LLM's role is FORMATTING AND PRESENTATION ONLY — not analysis.
 * All data has already been extracted and stored during transcript processing.
 * The LLM organizes and presents it clearly for Slack.
 */
export function getMeetingSummaryFormattingSystemPrompt(): string {
  return `You are formatting pre-extracted meeting data for display in Slack. Your role is PRESENTATION ONLY — do not analyze, interpret, or omit any data.

STRICT RULES:
- DO NOT omit any Q&A pairs — include every single one
- DO NOT paraphrase quotes — use them exactly as provided
- DO NOT add information that is not in the provided data
- DO NOT invent or infer details beyond what is given
- DO prioritize and highlight items related to: security, pricing, compliance, business continuity, deal blockers
- DO group related product insights together logically
- Use Slack markdown formatting: *bold* for section headers, • for bullets, _italics_ for quotes`;
}

/**
 * Build the user prompt for meeting summary formatting.
 * Assembles all pre-extracted structured data into a prompt the LLM formats.
 */
export function buildMeetingSummaryFormattingPrompt(data: MeetingSummaryData): string {
  const insightsSection = data.productInsights.length > 0
    ? data.productInsights.map((ins, i) =>
        `  ${i + 1}. Feature: ${ins.feature}\n     Context: ${ins.context}\n     Quote: "${ins.quote}"${ins.categoryName ? `\n     Category: ${ins.categoryName}` : ''}`
      ).join('\n')
    : '  (None extracted)';

  const qaSection = data.qaPairs.length > 0
    ? data.qaPairs.map((qa, i) =>
        `  ${i + 1}. Asker: ${qa.asker}\n     Question: ${qa.question}\n     Answer: ${qa.answer}`
      ).join('\n')
    : '  (None extracted)';

  const actionSection = data.actionItems.length > 0
    ? data.actionItems.map((item, i) =>
        `  ${i + 1}. Action: ${item.action}\n     Owner: ${item.owner}\n     Deadline: ${item.deadline || 'Not specified'}`
      ).join('\n')
    : '  (None extracted)';

  return `Format this pre-extracted meeting data into a clear, structured Slack message.

MEETING METADATA:
- Company: ${data.companyName}
- Date: ${data.meetingDate}
- Status/Takeaways: ${data.status || '(Not available)'}
- Next Steps: ${data.nextSteps || '(Not available)'}
- Our Team: ${data.leverageTeam || '(Not available)'}
- Customer Attendees: ${data.customerNames || '(Not available)'}

PRODUCT INSIGHTS (${data.productInsights.length} total):
${insightsSection}

Q&A PAIRS (${data.qaPairs.length} total — include ALL):
${qaSection}

ACTION ITEMS (${data.actionItems.length} total):
${actionSection}

FORMAT THE OUTPUT AS:
*Meeting Summary: ${data.companyName} — ${data.meetingDate}*

*Status:* [main takeaways]

*Attendees:*
• Our team: [names]
• Customer: [names]

*Next Steps:* [next steps from metadata]

---

*Critical Requirements & Concerns:*
[Product insights related to security, compliance, pricing, business continuity — with verbatim quotes in _italics_]

*Feature Requests & Feedback:*
[Remaining product insights — with verbatim quotes in _italics_]

*Questions Asked & Answers Given (${data.qaPairs.length}):*
[ALL Q&A pairs — who asked, question, answer]

*Action Items (${data.actionItems.length}):*
[All action items with owner and deadline]`;
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

