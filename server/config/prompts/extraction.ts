/**
 * Extraction Prompts
 * 
 * Customer question extraction, Q&A resolution, and data extraction prompts.
 * Used during transcript ingestion and question processing.
 */

/**
 * Customer questions extraction system prompt.
 * Extracts real, information-seeking questions from meeting transcripts.
 */
export const CUSTOMER_QUESTIONS_EXTRACTION_PROMPT = `You are a strict extraction engine operating on meeting transcripts.

Your task is to extract REAL, INFORMATION-SEEKING QUESTIONS
that were asked BY CUSTOMERS during the meeting.

You must operate conservatively. When in doubt, extract nothing.

GREEN ROOM FILTER (CRITICAL):
First, identify where the ACTUAL MEETING starts. Ignore all pre-meeting chatter.
Pre-meeting chatter includes:
- "Can you hear me?"
- "Is my audio working?"
- "Waiting for others to join"
- "I'll admit them"
- "Let me share my screen"
- Technical setup discussions
- Small talk before introductions

Only extract questions that occur AFTER the meeting actually begins
(e.g., after greetings like "Hi everyone", "Let's get started", formal introductions).

RULES:
1. Extract ONLY customer-asked questions. Ignore internal team questions.
2. Questions must be genuine information-seeking questions.
3. The question_text must closely match what was actually said.
4. Do NOT summarize, rewrite, or infer.
5. Mark ANSWERED only if you can quote the exact answer sentence.
6. If follow-up is promised, mark DEFERRED.
7. If unanswered, mark OPEN.
8. Use only the provided transcript text.
9. Returning no questions is valid.
10. IGNORE questions from pre-meeting chatter (Green Room).
11. CRITICAL: For question_turn_index, use the EXACT [Turn N] number from the transcript.
    This is required for context anchoring. Do NOT return -1.

Return ONLY valid JSON with a "questions" array.

Example output format:
{
  "questions": [
    {
      "question_text": "Is that compatible with our system?",
      "asked_by_name": "John Smith",
      "question_turn_index": 15,
      "status": "ANSWERED",
      "answer_evidence": "Yes, it's fully compatible with Oracle and SAP systems."
    }
  ]
}`;

/**
 * Build prompt for resolving customer question answers.
 */
export function buildQuestionAnswerResolutionPrompt(questionText: string): string {
  return `Customer question: "${questionText}"

Based on the available product knowledge and context, provide an accurate answer.
If you cannot answer definitively, say so clearly.`;
}

/**
 * Customer questions from text extraction prompt.
 * For extracting questions from raw transcript text without turn markers.
 */
export const CUSTOMER_QUESTIONS_FROM_TEXT_PROMPT = `You are a strict extraction engine analyzing meeting transcripts for customer questions.

Extract ONLY genuine, information-seeking questions asked by customers.

RULES:
1. Extract verbatim or near-verbatim question text
2. Identify the speaker name if available
3. Mark status: ANSWERED, OPEN, or DEFERRED
4. Include answer evidence if available
5. Do NOT invent or paraphrase questions
6. When in doubt, don't extract

Return JSON with "questions" array.`;

/**
 * Build transcript chunk analysis prompt.
 */
export function buildTranscriptChunkPrompt(params: {
  transcript: string;
  companyName: string;
  leverageTeam: string[];
  customerNames: string[];
  categoryList: string;
  chunkInfo: string;
  isNotes: boolean;
}): string {
  const { transcript, companyName, leverageTeam, customerNames, categoryList, chunkInfo, isNotes } = params;
  
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
- Return empty arrays [] for insights/qaPairs if none found
- Return null for posSystem if none detected
- Ensure valid JSON format`;
}
