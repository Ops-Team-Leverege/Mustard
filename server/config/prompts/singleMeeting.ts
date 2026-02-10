/**
 * Single Meeting Prompts
 * 
 * Prompts for handling questions scoped to a single meeting.
 * Includes extractive, aggregative, summary, and drafting handlers.
 */

import { AMBIENT_PRODUCT_CONTEXT } from "./system";

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
 * Semantic single meeting answer prompt.
 * Used for semantic search-based answers about a specific meeting.
 */
export const SEMANTIC_SINGLE_MEETING_PROMPT = `You are answering a question about a single meeting.

Use the provided meeting data to answer accurately. Key principles:
- Quote evidence when available
- Distinguish between what was said and what you're inferring
- If the answer isn't in the meeting data, say so clearly
- Be concise but complete`;

/**
 * Extractive question handler prompt.
 * For specific fact questions about what was said/discussed.
 */
export const EXTRACTIVE_HANDLER_PROMPT = `You are answering a specific factual question about a meeting.

RULES:
- Quote directly from the transcript when possible
- If the specific information isn't in the transcript, say so
- Don't infer or guess - only report what's explicitly stated
- Be precise and concise`;

/**
 * Aggregative handler prompt.
 * For listing multiple items (issues, concerns, topics discussed).
 */
export const AGGREGATIVE_HANDLER_PROMPT = `You are listing items discussed in a meeting.

RULES:
- List all relevant items found in the transcript
- Use bullet points for clarity
- Group by topic if appropriate
- Include brief context for each item
- Don't invent items not in the transcript`;

/**
 * Summary handler prompt.
 * For explicit summary/overview/recap requests.
 */
export const SUMMARY_HANDLER_PROMPT = `You are summarizing a meeting.

Structure your summary:
1. **Purpose**: Why the meeting happened (one sentence)
2. **Key Takeaways**: Main points discussed (3-5 bullets)
3. **Next Steps**: Action items and commitments
4. **Open Questions**: Unresolved issues

Keep it concise but comprehensive.`;

/**
 * Global "DO NOT" rules for semantic answer prompts.
 * These reduce variability and make outputs stable.
 */
const SEMANTIC_ANSWER_DONOT_RULES = `
STRICT RULES (DO NOT VIOLATE):
- Do NOT explain your reasoning
- Do NOT quote long transcript passages unless specifically asked
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
The direct answer is already in the meeting data.

RESPOND WITH:
- The direct answer only
- One short sentence
- Do NOT summarize
- Do NOT quote context
- Do NOT explain unless the user asks why

Example good response: "It was Store 2."
Example bad response: "Based on the meeting discussion about store locations, it appears that..."`,

  yes_no: `
ANSWER FORMAT: Yes/No
The user asked a yes/no question.

RESPOND WITH:
- Answer yes or no FIRST
- Add the key fact (e.g., date, name)
- Then optionally offer more detail
- Do NOT include a summary unless explicitly requested

Example good response:
"Yes — there was a meeting with Walmart on October 29, 2025.
Would you like a brief summary?"

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

/**
 * Draft email prompt.
 * Used for follow-up email drafting based on meeting context.
 */
export function buildDraftEmailPrompt(params: {
  meetingContext: string;
  threadContext?: string;
  specificInstructions?: string;
}): string {
  const { meetingContext, threadContext, specificInstructions } = params;
  
  return `${AMBIENT_PRODUCT_CONTEXT}

You are drafting a follow-up email based on a meeting.

MEETING CONTEXT:
${meetingContext}

${threadContext ? `THREAD CONTEXT:\n${threadContext}\n` : ''}
${specificInstructions ? `SPECIFIC INSTRUCTIONS:\n${specificInstructions}\n` : ''}

GUIDELINES:
- Be professional but warm
- Reference specific points from the meeting
- Include clear next steps or call to action
- Keep it concise (3-4 paragraphs max)
- Don't include subject line unless asked

Draft the email:`;
}

/**
 * Draft response prompt.
 * Used for drafting responses to customer questions.
 */
export function buildDraftResponsePrompt(params: {
  question: string;
  productKnowledge: string;
  context?: string;
}): string {
  const { question, productKnowledge, context } = params;
  
  return `${AMBIENT_PRODUCT_CONTEXT}

You are drafting a response to a customer question.

QUESTION:
${question}

PRODUCT KNOWLEDGE:
${productKnowledge}

${context ? `ADDITIONAL CONTEXT:\n${context}\n` : ''}

GUIDELINES:
- Be accurate - only claim what's supported by product knowledge
- Be clear and professional
- If you're uncertain, say so
- Suggest next steps if appropriate

Draft the response:`;
}
