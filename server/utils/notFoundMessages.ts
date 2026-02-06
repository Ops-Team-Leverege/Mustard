/**
 * Centralized Not-Found Messages
 * 
 * Provides consistent error messages when companies, meetings,
 * or other entities are not found in our records.
 * Used across Slack events handler and OpenAssistant handler.
 */

export interface NotFoundContext {
  extractedCompany?: string | null;
  searchedFor?: string | null;
  scope?: "single" | "multi";
}

/**
 * Generate a user-friendly message when no meetings are found.
 * If the user mentioned a specific company/entity that wasn't in the DB,
 * tell them that - don't ask them to repeat what they already said.
 */
export function getMeetingNotFoundMessage(ctx: NotFoundContext): string {
  const { extractedCompany, searchedFor, scope = "single" } = ctx;

  if (extractedCompany) {
    return `I couldn't find "${extractedCompany}" in our records. This could mean:\n- No transcripts have been uploaded for this company yet\n- The name might be spelled differently in our system\n\nYou can try a different spelling or the full company name.`;
  }

  if (scope === "multi") {
    return `I looked across all available transcripts${searchedFor ? ` (searched for: "${searchedFor}")` : ''} but didn't find any matching data for this analysis.\n\nThis could mean:\n- There are no transcripts uploaded yet that match your criteria\n- The topic you're asking about hasn't come up in recorded calls\n\nYou can try a different question about specific customers or topics that have been discussed.`;
  }

  if (searchedFor) {
    return `I searched for "${searchedFor}" but didn't find any matching call transcripts in the system.\n\nThis could mean:\n- No transcripts have been uploaded yet for that customer or topic\n- The meeting you're looking for uses a different name or spelling\n\nYou can try asking about a specific customer by name.`;
  }

  return "Which meeting are you asking about? Please mention the company name or a specific meeting date.";
}
