/**
 * External Research Prompts
 * 
 * Prompts for external research using Gemini and web-grounded responses.
 */

import { AMBIENT_PRODUCT_CONTEXT } from "./system";

/**
 * Build external research prompt for Gemini.
 */
export function buildExternalResearchPrompt(params: {
  query: string;
  companyName?: string | null;
  topic?: string | null;
}): string {
  const { query, companyName, topic } = params;
  
  const companyContext = companyName 
    ? `\n\nTARGET COMPANY: ${companyName}\nResearch this company specifically.`
    : '';
  
  const topicContext = topic
    ? `\n\nFOCUS TOPIC: ${topic}\nFocus your research on this aspect.`
    : '';
  
  return `You are a research assistant helping a B2B sales team.

RESEARCH REQUEST:
${query}${companyContext}${topicContext}

GUIDELINES:
1. Find current, relevant information from authoritative sources
2. Include specific facts and figures when available
3. Note the source and date of information
4. Distinguish between confirmed facts and speculation
5. Focus on information useful for sales preparation

STRUCTURE YOUR RESPONSE:
**Overview:** Brief summary (2-3 sentences)

**Key Findings:**
- [Finding 1 with source]
- [Finding 2 with source]
...

**Strategic Insights:** (if applicable)
What this means for sales approach

**Sources:** List your sources with dates

Be accurate and cite your sources.`;
}

/**
 * Sales docs preparation prompt.
 * For creating pitch materials based on external research.
 */
export function buildSalesDocsPrepPrompt(params: {
  companyName: string;
  research: string;
  docType: "slide_deck" | "pitch" | "one_pager";
}): string {
  const { companyName, research, docType } = params;
  
  const docTypeInstructions: Record<string, string> = {
    slide_deck: `Create an outline for a slide deck (8-12 slides):
- Title slide
- Company overview (what we know about them)
- Their challenges (based on research)
- Our solution
- Relevant case studies/proof points
- Proposed approach
- Next steps`,
    pitch: `Create a pitch outline:
- Opening hook (why we're reaching out)
- Their situation (based on research)
- The opportunity
- Our solution
- Differentiators
- Call to action`,
    one_pager: `Create a one-pager outline:
- Headline: Value proposition for this company
- Their challenges (2-3 bullets)
- Our solution (2-3 bullets)
- Key benefits
- Proof points
- Contact/next step`,
  };
  
  return `${AMBIENT_PRODUCT_CONTEXT}

You are preparing sales materials for ${companyName}.

RESEARCH FINDINGS:
${research}

TASK: ${docTypeInstructions[docType]}

GUIDELINES:
- Tailor content specifically to ${companyName}
- Use research findings to personalize messaging
- Focus on their likely priorities
- Keep it concise and actionable
- Suggest specific PitCrew features that match their needs

Create the ${docType.replace('_', ' ')}:`;
}

/**
 * Value proposition prompt.
 * For generating tailored value propositions.
 */
export function buildValuePropositionPrompt(params: {
  targetCompany: string;
  industry?: string;
  knownChallenges?: string[];
  productContext?: string;
}): string {
  const { targetCompany, industry, knownChallenges, productContext } = params;
  
  const challengesList = knownChallenges?.length 
    ? `\n\nKNOWN CHALLENGES:\n${knownChallenges.map(c => `- ${c}`).join('\n')}`
    : '';
  
  const industryContext = industry ? ` in the ${industry} industry` : '';
  
  return `${AMBIENT_PRODUCT_CONTEXT}

${productContext ? `PRODUCT DETAILS:\n${productContext}\n\n` : ''}

Create a tailored value proposition for ${targetCompany}${industryContext}.${challengesList}

STRUCTURE:
1. **Headline:** One compelling sentence for their situation
2. **The Challenge:** What they likely struggle with
3. **The Solution:** How PitCrew addresses this
4. **The Benefit:** Quantifiable outcomes they can expect
5. **The Differentiator:** Why PitCrew vs alternatives

Keep each section to 2-3 sentences. Be specific to their context.`;
}

/**
 * MCP routing prompt.
 * Used for routing user requests to capabilities.
 */
export const MCP_ROUTING_PROMPT = `You route user requests to the correct capability.

CRITICAL RULES:
1. ALWAYS call a capability when the user's INTENT is clear, even if some parameters are missing.
2. Missing parameters like company name or meeting ID will be filled from thread context - that's not your concern.
3. Only return a text response (no tool call) if the question is completely unrelated to any capability.

Examples of when to CALL a capability (even without explicit params):
- "Who attended the meeting?" → call get_meeting_attendees (companyId will come from context)
- "What were the next steps?" → call get_last_meeting (context provides company/meeting)
- "Any feedback about pricing?" → call get_last_meeting with topic extraction

Examples of when to NOT call a capability:
- "Hello" → greeting, not a data query
- "What can you do?" → meta question about capabilities`;

