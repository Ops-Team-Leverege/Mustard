/**
 * Transcript Prompts
 * 
 * Prompts for transcript analysis, insight extraction, and RAG composition.
 */

/**
 * Meeting summary composition prompt.
 * Used by RAG composer to generate structured meeting summaries.
 */
export const MEETING_SUMMARY_PROMPT = `You are generating a structured meeting summary.

Create a canonical, storable summary with:
- title: Brief descriptive title
- purpose: Why the meeting happened (one sentence)
- focusAreas: 2-5 recurring themes that dominated discussion
- keyTakeaways: Main conclusions and decisions (3-7 items)
- risksOrOpenQuestions: Unresolved issues and concerns
- recommendedNextSteps: Specific action items

Be concise and factual. Avoid speculation.`;

/**
 * Quote selection prompt.
 * Used to select notable quotes from transcripts.
 */
export const QUOTE_SELECTION_PROMPT = `You are selecting notable quotes from a meeting transcript.

For each quote, provide:
- chunkIndex: The location in the transcript
- speakerRole: customer, leverege, or unknown
- quote: The verbatim or near-verbatim quote
- reason: Why this quote is significant

Select quotes that:
- Reveal customer priorities or pain points
- Capture key decisions or commitments
- Highlight interesting insights
- Show important concerns or objections

Limit to 5-8 most significant quotes.`;

/**
 * Extractive answer prompt.
 * Used for extracting specific answers from transcript content.
 */
export const EXTRACTIVE_ANSWER_PROMPT = `You are extracting an answer from meeting transcript data.

RULES:
- Only answer based on what's explicitly in the transcript
- Quote evidence directly when possible
- If the information isn't present, say "wasFound: false"
- Don't infer or guess

RESPONSE FORMAT:
{
  "answer": "The extracted answer",
  "evidence": "Supporting quote from transcript",
  "wasFound": true/false
}`;

/**
 * Action items extraction prompt.
 * Used for extracting next steps and commitments from transcripts.
 */
export const ACTION_ITEMS_PROMPT = `You are extracting action items and commitments from a meeting.

For each action item, identify:
- action: What needs to be done
- owner: Who is responsible
- type: commitment, request, blocker, or plan
- deadline: If mentioned
- evidence: The exact quote
- confidence: How certain you are this is a real commitment
- isPrimary: Is this a key takeaway vs minor detail

GUIDELINES:
- Distinguish between firm commitments and tentative plans
- Note when the owner is unclear
- Prioritize concrete, actionable items
- Ignore vague intentions`;

/**
 * Build RAG composer system prompt.
 */
export function buildRAGComposerPrompt(params: {
  task: "summary" | "quotes" | "extractive" | "action_items";
  context?: string;
}): string {
  const taskPrompts: Record<string, string> = {
    summary: MEETING_SUMMARY_PROMPT,
    quotes: QUOTE_SELECTION_PROMPT,
    extractive: EXTRACTIVE_ANSWER_PROMPT,
    action_items: ACTION_ITEMS_PROMPT,
  };
  
  let prompt = taskPrompts[params.task] || MEETING_SUMMARY_PROMPT;
  
  if (params.context) {
    prompt += `\n\nADDITIONAL CONTEXT:\n${params.context}`;
  }
  
  return prompt;
}
