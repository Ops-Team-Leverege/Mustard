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
