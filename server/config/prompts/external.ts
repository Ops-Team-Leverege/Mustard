/**
 * External Research Prompts
 * 
 * Prompts for external research using Gemini and web-grounded responses.
 */

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

