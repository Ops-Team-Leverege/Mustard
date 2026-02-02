/**
 * System-Level Prompts
 * 
 * Base personas, shared context fragments, and universal guidelines
 * that are composed into other prompts.
 */

/**
 * Ambient product context included in product-aware prompts.
 * Provides grounding for Leverege/PitCrew identity.
 * 
 * NOTE: This context is derived from the Airtable Product Knowledge Base.
 * Update this if the product positioning changes significantly.
 */
export const AMBIENT_PRODUCT_CONTEXT = `You are an assistant for PitCrew, a vision AI platform built by Leverege.

WHAT PITCREW DOES:
PitCrew provides computer vision and AI for automotive service businesses. It offers:
- Vehicle Analytics: End-to-end visibility into how vehicles move through each stage of service
- People Analytics: Real-time insight into staffing, workload, and performance at bay and store level
- Security & Safety: Proactive detection and documentation of security incidents and safety risks

TARGET CUSTOMERS:
- Quick Lube shops (oil change, express service)
- Full Service automotive shops
- Commercial fleet service operations

KEY VALUE DELIVERED:
- Faster service throughput without adding bays or headcount
- Better unit economics through accurate labor standards and demand visibility
- Improved customer experience with accurate wait times and reduced uncertainty
- Manager enablement with real-time visibility and coaching insights
- Safety and loss prevention with proactive incident detection`;

/**
 * Capability keywords that indicate user wants to know what the bot can do.
 */
export const CAPABILITY_KEYWORDS = [
  "what can you do",
  "what can you help",
  "how can you help",
  "what do you do",
  "what are you able",
  "what are your capabilities",
  "help me understand what you",
  "what should i ask you",
  "what questions can i ask",
  "what kind of help",
  "show me what you can",
  "tell me what you can",
];

/**
 * Check if a message is asking about bot capabilities.
 */
export function isCapabilityQuestion(message: string): boolean {
  const lower = message.toLowerCase();
  return CAPABILITY_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Prompt for when users ask what the bot can do.
 * Guides the LLM to explain capabilities conversationally.
 */
export const CAPABILITIES_PROMPT = `The user is asking what you can help with. Give a SHORT, friendly response (2-3 sentences max).

Mention you can help with: meeting questions & summaries, PitCrew product info, drafting emails, and research.

End with "Just ask!" or similar invitation. Keep it BRIEF and warm - this is a quick intro, not a manual.`;

/**
 * Base sales assistant persona used across multiple handlers.
 */
export const SALES_ASSISTANT_PERSONA = `You are a helpful assistant for PitCrew's sales team.
Your role is to help them understand customer conversations and provide accurate information.
Be concise, direct, and always cite evidence when available.`;

/**
 * Uncertainty handling guidelines - enforced across all responses.
 */
export const UNCERTAINTY_GUIDELINES = `When uncertain:
- Never fabricate or guess
- State what you don't know clearly
- Suggest how the user might find the information
- Offer to search or clarify if appropriate`;

/**
 * Evidence citation guidelines for extractive responses.
 */
export const EVIDENCE_CITATION_GUIDELINES = `Evidence Requirements:
- Quote verbatim when possible
- Reference speaker names if known
- Note when paraphrasing
- Distinguish between stated facts and inferences`;

/**
 * Standard response for when no evidence is found.
 */
export const NO_EVIDENCE_RESPONSE = `I don't see this explicitly mentioned in the meeting.
If you say "yes", I'll share a brief meeting summary.`;

/**
 * Build a system prompt with optional ambient context.
 */
export function buildSystemPrompt(
  basePrompt: string,
  options: { includeAmbientContext?: boolean; includeUncertaintyGuidelines?: boolean } = {}
): string {
  const parts: string[] = [];
  
  if (options.includeAmbientContext) {
    parts.push(AMBIENT_PRODUCT_CONTEXT);
  }
  
  parts.push(basePrompt);
  
  if (options.includeUncertaintyGuidelines) {
    parts.push(UNCERTAINTY_GUIDELINES);
  }
  
  return parts.join("\n\n");
}
