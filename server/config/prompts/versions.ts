/**
 * Prompt Version Management
 * 
 * Centralized version tracking for all prompts.
 * Uses date-based versioning: YYYY-MM-DD-NNN (e.g., 2026-02-17-001)
 * 
 * When updating a prompt:
 * 1. Increment the version number
 * 2. Update the CHANGE_LOG with the reason
 * 3. The system will automatically log the change to prompt_versions table
 */

export type PromptVersions = {
    // Decision Layer Prompts
    INTENT_CLASSIFICATION_PROMPT: string;
    CONTRACT_SELECTION_PROMPT: string;
    AMBIGUOUS_QUERY_INTERPRETATION_PROMPT: string;
    AGGREGATE_SPECIFICITY_CHECK_PROMPT: string;

    // Single Meeting Prompts
    SEMANTIC_ANSWER_PROMPT: string;

    // Transcript Analysis Prompts
    RAG_MEETING_SUMMARY_SYSTEM_PROMPT: string;
    RAG_QUOTE_SELECTION_SYSTEM_PROMPT: string;
    RAG_EXTRACTIVE_ANSWER_SYSTEM_PROMPT: string;
    RAG_ACTION_ITEMS_SYSTEM_PROMPT: string;
    TRANSCRIPT_ANALYZER_SYSTEM_PROMPT: string;

    // External & MCP Prompts
    MCP_ROUTING_PROMPT: string;

    // Extraction Prompts
    CUSTOMER_QUESTIONS_EXTRACTION_PROMPT: string;
    PRODUCT_KNOWLEDGE_DRAFTING_PROMPT: string;
};

/**
 * Current versions for all prompts.
 * Update these when you modify a prompt.
 */
export const PROMPT_VERSIONS: PromptVersions = {
    // Decision Layer - Initial versions
    INTENT_CLASSIFICATION_PROMPT: "2026-02-18-003",
    CONTRACT_SELECTION_PROMPT: "2026-02-17-001",
    AMBIGUOUS_QUERY_INTERPRETATION_PROMPT: "2026-02-17-001",
    AGGREGATE_SPECIFICITY_CHECK_PROMPT: "2026-02-17-001",

    // Single Meeting - Initial versions
    SEMANTIC_ANSWER_PROMPT: "2026-02-17-001",

    // Transcript Analysis - Initial versions
    RAG_MEETING_SUMMARY_SYSTEM_PROMPT: "2026-02-18-004",
    RAG_QUOTE_SELECTION_SYSTEM_PROMPT: "2026-02-17-001",
    RAG_EXTRACTIVE_ANSWER_SYSTEM_PROMPT: "2026-02-17-001",
    RAG_ACTION_ITEMS_SYSTEM_PROMPT: "2026-02-17-001",
    TRANSCRIPT_ANALYZER_SYSTEM_PROMPT: "2026-02-17-001",

    // External & MCP - Initial versions
    MCP_ROUTING_PROMPT: "2026-02-17-001",

    // Extraction - Initial versions
    CUSTOMER_QUESTIONS_EXTRACTION_PROMPT: "2026-02-17-001",
    PRODUCT_KNOWLEDGE_DRAFTING_PROMPT: "2026-02-17-001",
};

/**
 * Change log for prompt versions.
 * Add entries when you update a prompt version.
 */
export const PROMPT_CHANGE_LOG: Record<string, Array<{ version: string; reason: string; date: string }>> = {
    INTENT_CLASSIFICATION_PROMPT: [
        { version: "2026-02-18-003", reason: "Simplified chain-of-thought: single reasoning field before intent, letting model reason through what user wants before picking enum value", date: "2026-02-18" },
        { version: "2026-02-18-002", reason: "Chain-of-thought reasoning: restructured JSON schema so model reasons through data source and intent before labeling. Moved reasoning, extractedCompany, conversationContext before intent field to force deliberate classification", date: "2026-02-18" },
        { version: "2026-02-18-001", reason: "Enforce exact enum values in intent response — LLM was returning synonyms like 'summary' instead of 'SINGLE_MEETING', causing fallback to GENERAL_RESPONSE", date: "2026-02-18" },
        { version: "2026-02-17-001", reason: "Initial version with prompt version control system", date: "2026-02-17" }
    ],
    CONTRACT_SELECTION_PROMPT: [
        { version: "2026-02-17-001", reason: "Initial version with prompt version control system", date: "2026-02-17" }
    ],
    AMBIGUOUS_QUERY_INTERPRETATION_PROMPT: [
        { version: "2026-02-17-001", reason: "Initial version with prompt version control system", date: "2026-02-17" }
    ],
    AGGREGATE_SPECIFICITY_CHECK_PROMPT: [
        { version: "2026-02-17-001", reason: "Initial version with prompt version control system", date: "2026-02-17" }
    ],
    SEMANTIC_ANSWER_PROMPT: [
        { version: "2026-02-17-001", reason: "Initial version with prompt version control system", date: "2026-02-17" }
    ],
    RAG_MEETING_SUMMARY_SYSTEM_PROMPT: [
        { version: "2026-02-18-004", reason: "Reframed Section 1 as 'Friction & Constraints' with Active Blockers, Conditional Mandates, and 'Yes Trap' sub-directives; renamed output header to 'Risks, Blockers & Constraints' to capture agreed-upon constraints as engineering requirements.", date: "2026-02-18" },
        { version: "2026-02-18-003", reason: "Refined Section 1 to 'Friction & Hard Requirements' with MANDATORY REQUIREMENTS sub-directive; renamed output section to 'Risks, Blockers & Hard Requirements' to surface deal constraints even when verbally resolved.", date: "2026-02-18" },
        { version: "2026-02-18-002", reason: "Updated Analysis Directives to explicitly catch 'Must-Haves' and source code escrow/SSO mandates as risks/blockers.", date: "2026-02-18" },
        { version: "2026-02-18-001", reason: "Added 'CORE ANALYSIS DIRECTIVES' for better risk/blocker extraction and decision vs. debate filtering.", date: "2026-02-18" },
        { version: "2026-02-17-003", reason: "v4 Google Polish: removed Complete Record duplication, removed verification tally from output, stricter action items (must be explicit), cleaner Slack formatting, CRM context labeling", date: "2026-02-17" },
        { version: "2026-02-17-002", reason: "v3 rewrite: 10-category exhaustive extraction (A-J), two-part output (Executive Summary + Complete Record), self-verification tally, verbatim-only quotes, no pre-extracted data dependency", date: "2026-02-17" },
        { version: "2026-02-17-001", reason: "Initial version with prompt version control system", date: "2026-02-17" }
    ],
    RAG_QUOTE_SELECTION_SYSTEM_PROMPT: [
        { version: "2026-02-17-001", reason: "Initial version with prompt version control system", date: "2026-02-17" }
    ],
    RAG_EXTRACTIVE_ANSWER_SYSTEM_PROMPT: [
        { version: "2026-02-17-001", reason: "Initial version with prompt version control system", date: "2026-02-17" }
    ],
    RAG_ACTION_ITEMS_SYSTEM_PROMPT: [
        { version: "2026-02-17-001", reason: "Initial version with prompt version control system", date: "2026-02-17" }
    ],
    TRANSCRIPT_ANALYZER_SYSTEM_PROMPT: [
        { version: "2026-02-17-001", reason: "Initial version with prompt version control system", date: "2026-02-17" }
    ],
    MCP_ROUTING_PROMPT: [
        { version: "2026-02-17-001", reason: "Initial version with prompt version control system", date: "2026-02-17" }
    ],
    CUSTOMER_QUESTIONS_EXTRACTION_PROMPT: [
        { version: "2026-02-17-001", reason: "Initial version with prompt version control system", date: "2026-02-17" }
    ],
    PRODUCT_KNOWLEDGE_DRAFTING_PROMPT: [
        { version: "2026-02-17-001", reason: "Initial version for email drafting", date: "2026-02-17" }
    ],
};

/**
 * Helper to get the next version number for a prompt.
 * Useful when creating a new version.
 */
export function getNextVersion(promptName: keyof PromptVersions): string {
    const today = new Date().toISOString().split('T')[0];
    const history = PROMPT_CHANGE_LOG[promptName] || [];
    const todayVersions = history.filter(h => h.date === today);
    const nextNum = String(todayVersions.length + 1).padStart(3, '0');
    return `${today}-${nextNum}`;
}

/**
 * Get version for a specific prompt.
 */
export function getPromptVersion(promptName: keyof PromptVersions): string {
    return PROMPT_VERSIONS[promptName];
}
