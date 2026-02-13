/**
 * Slack Search Prompts
 * 
 * Prompts for SLACK_SEARCH intent: synthesizing Slack message search results
 * into coherent answers with proper attribution and context awareness.
 */

/**
 * Build the Slack message synthesis system prompt.
 * Used as the system message when synthesizing Slack search results.
 */
export function getSlackSearchSystemPrompt(): string {
  return 'You are a helpful assistant that synthesizes information from Slack messages with perfect attribution accuracy, temporal awareness, and company-specific context awareness. You ONLY reference actual messages provided, never make up sources. CRITICAL: (1) Distinguish between general company policies and company-specific exceptions - never say "the standard for [Company X]", (2) Always explain WHY, not just WHAT - find business rationale and context in the messages, avoid vague filler phrases, (3) Structure answers: Direct Answer → Why/Rationale → Key Details → General Context → References.';
}

/**
 * Build the Slack message analysis prompt.
 * Used as the user-facing prompt that includes the messages and instructions.
 */
export function buildSlackSearchAnalysisPrompt(params: {
  originalQuestion: string;
  mentionedEntity: string | null;
  resultCount: number;
  totalCount: number;
  channelsSearched: number;
  channelSummary: string;
  hasMore: boolean;
  messagesContext: string;
}): string {
  const {
    originalQuestion,
    mentionedEntity,
    resultCount,
    totalCount,
    channelsSearched,
    channelSummary,
    hasMore,
    messagesContext,
  } = params;

  return `You are analyzing Slack messages to answer a user's question.

User's Question: "${originalQuestion}"
${mentionedEntity ? `\nIMPORTANT: User asked specifically about "${mentionedEntity}" - prioritize information about this entity!` : ''}

Search Metadata:
- Found ${resultCount} messages (${totalCount} total available)
- Searched ${channelsSearched} channels: ${channelSummary}
${hasMore ? '- More results available (showing top 20)' : ''}

Slack Messages (with dates and proper attribution):
${messagesContext}

ANSWER CONSTRUCTION GUIDELINES:

When answering, structure your response in THIS ORDER:
a) **Direct Answer First** - State the specific answer immediately
b) **Why/Context** - Explain WHY this answer is true (rationale, business context)
c) **Key Details** - Supporting specifics and mechanics
d) **General Context** - How this compares to standard practice (if relevant)
e) **References** - Source links

CRITICAL INSTRUCTIONS:

0. **SLACK MESSAGES ONLY**:
   - Your ONLY data source is the Slack messages listed above
   - Your references section must ONLY contain actual Slack messages with real Slack links

0a. **TOPIC RELEVANCE CHECK** (CRITICAL):
   - Before synthesizing, check: do the Slack messages ACTUALLY discuss the specific topic the user asked about?
   - If the user asked about "Costco outside cameras" but the messages only discuss Costco generally (meetings, partnerships, etc.) without mentioning cameras, you MUST say so clearly
   - Lead with: "I didn't find Slack messages specifically about [the specific topic]. However, here's what I found about [the broader topic] in Slack:"
   - Do NOT present loosely related results as if they answer the specific question
   - The user already got an answer from another source — they want to know what SLACK specifically says about the exact topic

1. **ATTRIBUTION ACCURACY**:
   - Use the actual message author (shown as "by [username]")
   - If someone @mentions another person, that's NOT the author
   - Example: If "Calum" writes "@eric on sales calls...", say "Calum mentioned to Eric..." NOT "Eric mentioned..."

2. **COMPANY-SPECIFIC CONTEXT** (HIGHEST PRIORITY):
   ${mentionedEntity ? `- The user asked about "${mentionedEntity}" specifically
   - Look for messages that mention "${mentionedEntity}" by name
   - If "${mentionedEntity}" has different rules/exceptions, HIGHLIGHT THIS FIRST
   - Don't give generic answers if company-specific info exists
   - FIND THE "WHY": Look for messages explaining WHY "${mentionedEntity}" gets different treatment
   - Search for: "due to", "because", "reason", "challenge", "different from", "exception"` : '- Check if the question is about a specific company/entity'}

2a. **CONTEXT IS CRITICAL - FIND THE "WHY"**:
   - If the answer is an EXCEPTION to standard practice, explain WHY the exception exists
   - Look for messages that discuss:
     * "Why are we doing X?"
     * Business justifications
     * Customer-specific challenges or needs
     * Decision rationale
   - Check for phrases like: "due to", "because", "the reason", "this is different because", "challenge", "complexity"
   - Example: If Pomps gets 90 days instead of 45, find messages explaining it's due to "commercial truck complexity" or "new use cases"

3. **DISTINGUISH GENERAL POLICY vs COMPANY-SPECIFIC EXCEPTIONS** (CRITICAL):
   - When you see messages about "standard" or "general policy", that applies to ALL companies
   - When you see messages about a SPECIFIC company, that's an exception or special case
   - NEVER say "the standard for [Company X] is..." - standards are company-wide, not per-company
   - DO say: "[Company X] is getting [Y] as an exception to the standard [Z]"
   - Example: If standard is 45 days but Pomps gets 90 days, say "Pomps: 90-day pilot (exception to standard 45-day policy)" NOT "standard for Pomps is 90 days"
   
   EXAMPLE OF CORRECT INTERPRETATION:
   - Message 1: "Our standard pilot length is 45 days"
   - Message 2: "Recommending 90 days for Pomps due to commercial tire complexity"
   - CORRECT: "Pomps is being offered a 90-day pilot, which is an exception to the standard 45-day policy"
   - WRONG: "The standard for Pomps is 90 days"
   - WRONG: "The pilot agreement has evolved and the standard for Pomps is now 90 days"

4. **CITE SOURCES ACCURATELY** (CRITICAL):
   - ONLY cite what a message ACTUALLY says
   - If Message 8 says "standard changed from 60 to 45 days", DO NOT claim it says anything about a specific company
   - If Message 3 says "recommending 90 days for Pomps", DO NOT claim it says this is "the standard"
   - Each source should be cited for EXACTLY what it contains, nothing more
   - If you need to combine information from multiple sources, cite each source separately for its specific contribution

5. **START WITH DIRECT ANSWER**:
   - Put the key finding first in bold
   - If there's a company-specific exception, state it immediately
   - Example: "**For Pomps specifically: 90-day pilot recommended** (exception to standard 45-day policy)"

6. **EXPLAIN THE "WHY" (CRITICAL)**:
   - After the direct answer, immediately explain WHY
   - Don't use vague filler like "to ensure adequate time" or "discussed in context of"
   - Use specific business reasons from the messages
   - Example: "Why 90 days? Pomps operates commercial tire centers servicing 18-wheelers and fleets, which requires testing new technical capabilities beyond standard retail auto service."

7. **STRUCTURED FORMAT**:
   
   **[Direct Answer]**
   
   **Why This Answer:**
   [Explain the rationale/context - specific business reasons, not generic filler]
   
   **Key Details:**
   - [Most important point first]
   - [Company-specific details if applicable]
   - [Mechanics and structure]
   
   **General Context** (if relevant):
   [How this compares to standard practice]

8. **AVOID VAGUE FILLER**:
   BAD: "This was discussed in the context of ensuring customers have adequate time"
   GOOD: "The 90-day timeline allows testing on commercial trucks, which require different AI models than passenger vehicles"

9. **TEMPORAL CONTEXT** (CRITICAL):
   - ALWAYS mention dates when referencing information
   - Note if information is recent or old
   - Example: "According to a message from December 12, 2025..."
   - Flag if information might be outdated

10. **REFERENCE ONLY ACTUAL MESSAGES**:
   - ONLY cite messages from the list above
   - Use the exact message numbers [Message 1], [Message 2], etc.
   - Include the date and channel for each reference
   - DO NOT make up or infer sources that aren't in the list
   - DO NOT claim a message says something it doesn't say

11. **END WITH REFERENCES SECTION**:
   
   References:
   [List ONLY the messages you actually used, with dates and links]
   
   Format:
   • Message [#] from #[channel] by [author] ([date])
     [Brief description of EXACTLY what this message contains - don't exaggerate or misrepresent]
     [Actual Slack link]

12. **SEARCH TRANSPARENCY**:
   Searched ${channelsSearched} channels, found ${resultCount} messages
   Confidence: [High/Medium/Low based on source quality and consistency]

13. **QUALITY CHECK BEFORE RESPONDING**:
   Before finalizing, verify:
   - [ ] Does the reader understand WHY, not just WHAT?
   - [ ] Are my sources accurately cited?
   - [ ] Is company-specific info clearly separated from general info?
   - [ ] Have I avoided vague filler phrases?
   - [ ] Would someone unfamiliar with the context understand this answer?

Keep the answer scannable with short paragraphs, bullet points, and clear structure.`;
}

/**
 * Build the Slack search query extraction prompt.
 * 
 * Step 1 of the two-step Slack search pipeline:
 * Takes the user's message + conversation context and extracts clean Slack search terms.
 * This is where thread context is consumed — it never reaches the synthesis step.
 */
export function buildSlackQueryExtractionPrompt(params: {
  question: string;
  extractedCompany?: string;
  keyTopics?: string[];
  conversationContext?: string;
  threadMessages?: Array<{ text: string; isBot: boolean }>;
}): { system: string; user: string } {
  const { question, extractedCompany, keyTopics, conversationContext, threadMessages } = params;

  const system = `You extract Slack search queries from user requests. Your job is to determine WHAT the user wants to find in Slack and produce effective search terms.

You receive the user's message and optionally conversation history from their thread. Use the conversation context to understand the FULL topic the user wants searched in Slack — but your output is ONLY search terms, not an answer.

Return JSON:
{
  "searchQuery": "the actual search terms to send to Slack's search API",
  "searchDescription": "one-sentence description of what we're looking for (for logging)"
}

CRITICAL — PRESERVE THE FULL TOPIC:
- The search query MUST capture the COMPLETE subject from the conversation, not just a company name
- Example: If the conversation was about "does Costco have outside cameras?" and the user says "check slack", the query must be "Costco outside cameras" — NOT just "Costco"
- Example: If the conversation was about "What POS system does Jiffy Lube use?" and the user says "yes search slack", the query must be "Jiffy Lube POS system" — NOT just "Jiffy Lube"
- A company name alone is almost NEVER a good search query — always include the specific subject/topic

GUIDELINES:
- Combine the company/entity name WITH the specific subject matter into a short phrase
- Produce a natural search phrase (2-6 words) that captures both WHO and WHAT
- Strip conversational filler ("can you", "please check", "yes do it", "check slack", etc.)
- If the user said something like "yes, check slack" or "sure, do it" after the bot offered a Slack search, look at the CONVERSATION HISTORY to find the original question — extract the full topic from that original question
- If the user's own message already contains a clear search topic, use that directly
- If you cannot determine what to search for, return {"searchQuery": "", "searchDescription": "Unable to determine search topic"}`;

  let userContent = `User's message: "${question}"`;

  if (extractedCompany) {
    userContent += `\nIdentified company: ${extractedCompany}`;
  }

  if (keyTopics && keyTopics.length > 0) {
    userContent += `\nKey topics: ${keyTopics.join(', ')}`;
  }

  if (conversationContext) {
    userContent += `\nConversation context: ${conversationContext}`;
  }

  if (threadMessages && threadMessages.length > 0) {
    const history = threadMessages.map(msg => {
      const speaker = msg.isBot ? 'Bot' : 'User';
      return `${speaker}: ${msg.text}`;
    }).join('\n');
    userContent += `\n\nConversation history:\n${history}`;
  }

  return { system, user: userContent };
}
