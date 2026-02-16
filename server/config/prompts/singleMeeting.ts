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
 * System prompt for meeting summary generation.
 * 
 * The LLM reads the raw transcript to produce a comprehensive BD meeting summary.
 * Structured data (insights, Q&A, action items) is provided as a completeness
 * checklist — anything in those lists MUST appear in the summary.
 */
export function getMeetingSummarySystemPrompt(): string {
  return `You are a Business Development analyst summarizing a sales/BD meeting transcript for the Leverege team. Your audience is sales leadership and product managers who need to understand the deal landscape.

YOUR GOAL: Extract every piece of actionable intelligence from this conversation. Generic summaries are useless — specifics win deals.

EXTRACT AND ORGANIZE:

*1. Deal Context & Customer Profile*
• Who attended (both sides), their roles, and decision-making authority
• Company size, current operations, number of locations/bays/technicians
• Current tech stack — what POS, DMS, or inspection systems they use today
• Where they are in their evaluation/buying journey

*2. Customer Pain Points & Needs*
• Specific operational problems they described (with verbatim quotes where impactful)
• What prompted them to take this meeting — the trigger event
• What metrics or KPIs they care about (car count, ticket time, revenue per bay, etc.)

*3. Product Discussion*
• Which PitCrew features/capabilities were discussed
• Customer reactions to specific features — enthusiasm, skepticism, confusion
• Feature gaps or requests the customer raised
• Competitive mentions — other vendors they're evaluating or currently using

*4. Pricing, Security & Compliance*
• Any pricing discussions, budget constraints, or cost expectations
• Security requirements (data handling, network, compliance standards)
• Integration requirements or technical constraints
• Deal blockers or concerns that could stall the deal

*5. Questions & Answers*
• Every question the customer asked and what answer was given (or left open)
• Every question our team asked and what the customer revealed
• Mark unanswered questions clearly

*6. Next Steps & Action Items*
• Specific commitments made by either side (with owners and deadlines if mentioned)
• Follow-up meetings, demos, trials, or POC discussions
• Internal action items for the Leverege team

*7. Deal Assessment*
• Overall sentiment — how interested/engaged was the customer?
• Buying signals or warning signs
• Recommended next moves for our team

FORMATTING RULES:
- Use Slack markdown: *bold* for section headers, • for bullets, _italics_ for verbatim quotes
- Include verbatim quotes for key moments — pricing reactions, objections, enthusiasm
- Be specific: "they have 12 locations with 8-10 bays each" not "multi-location business"
- If a section has no relevant content from the transcript, omit it entirely
- DO NOT invent or assume details not present in the transcript`;
}

/**
 * Build the user prompt for meeting summary generation.
 * Includes raw transcript plus structured data as a completeness checklist.
 */
export function buildSingleMeetingSummaryPrompt(
  data: MeetingSummaryData,
  transcriptText: string
): string {
  let completenessChecklist = '';

  if (data.productInsights.length > 0 || data.qaPairs.length > 0 || data.actionItems.length > 0) {
    completenessChecklist = `\n\n=== COMPLETENESS CHECKLIST ===
The following items were previously extracted from this transcript. Your summary MUST cover all of them — do not drop any.

`;
    if (data.productInsights.length > 0) {
      completenessChecklist += `PRODUCT INSIGHTS (${data.productInsights.length}):\n`;
      completenessChecklist += data.productInsights.map((ins, i) =>
        `  ${i + 1}. ${ins.feature}: ${ins.context}${ins.quote ? ` — _"${ins.quote}"_` : ''}`
      ).join('\n');
      completenessChecklist += '\n\n';
    }

    if (data.qaPairs.length > 0) {
      completenessChecklist += `Q&A PAIRS (${data.qaPairs.length} — include ALL):\n`;
      completenessChecklist += data.qaPairs.map((qa, i) =>
        `  ${i + 1}. [${qa.asker}] Q: ${qa.question}\n     A: ${qa.answer}`
      ).join('\n');
      completenessChecklist += '\n\n';
    }

    if (data.actionItems.length > 0) {
      completenessChecklist += `ACTION ITEMS (${data.actionItems.length}):\n`;
      completenessChecklist += data.actionItems.map((item, i) =>
        `  ${i + 1}. ${item.action} (Owner: ${item.owner}${item.deadline ? `, Deadline: ${item.deadline}` : ''})`
      ).join('\n');
    }
  }

  const metadataHeader = `*Meeting Summary: ${data.companyName} — ${data.meetingDate}*
${data.leverageTeam ? `Our Team: ${data.leverageTeam}` : ''}
${data.customerNames ? `Customer Attendees: ${data.customerNames}` : ''}`.trim();

  return `Summarize this BD meeting. Start with this header:

${metadataHeader}

${data.status ? `Known status/takeaways: ${data.status}` : ''}
${data.nextSteps ? `Known next steps: ${data.nextSteps}` : ''}

=== TRANSCRIPT ===
${transcriptText}${completenessChecklist}`;
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

