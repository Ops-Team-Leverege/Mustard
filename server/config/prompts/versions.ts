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
    INTENT_CLASSIFICATION_PROMPT: "2026-02-18-006",
    CONTRACT_SELECTION_PROMPT: "2026-02-17-001",
    AMBIGUOUS_QUERY_INTERPRETATION_PROMPT: "2026-02-17-001",
    AGGREGATE_SPECIFICITY_CHECK_PROMPT: "2026-02-17-001",

    // Single Meeting - Initial versions
    SEMANTIC_ANSWER_PROMPT: "2026-02-17-001",

    // Transcript Analysis - Initial versions
    RAG_MEETING_SUMMARY_SYSTEM_PROMPT: "2026-02-18-012",
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
        { version: "2026-02-18-006", reason: "Follow-up routing v3: reframed as 'message = topic, thread = context'. LLM uses thread to identify meeting/company and message to determine what user wants NOW. No contract defaults — contract is chosen based on the current message's topic.", date: "2026-02-18" },
        { version: "2026-02-18-005", reason: "Follow-up routing fix v2: follow-ups about a previous summary now select the best-fit contract (EXTRACTIVE_FACT, ATTENDEES, NEXT_STEPS, etc.) instead of hardcoding EXTRACTIVE_FACT. Key rule: follow-up is NEVER a request to regenerate the summary.", date: "2026-02-18" },
        { version: "2026-02-18-004", reason: "Follow-up routing fix: added CRITICAL section for follow-up questions about a previous summary — routes to EXTRACTIVE_FACT instead of regenerating MEETING_SUMMARY. Covers patterns like 'why didn't you mention X', 'what about the escrow discussion', 'you missed the part about SSO'.", date: "2026-02-18" },
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
        { version: "2026-02-18-012", reason: "v15 No Noise Removal: removed 'No Noise' rule entirely — it was filtering out brief but critical topics like Escrow and SOC2. Also removed 'Compliance Override' (no longer needed). Guardrails reduced to 4 rules.", date: "2026-02-18" },
        { version: "2026-02-18-011", reason: "v14 Compliance Override: added Rule #3 making Legal/Security/Insolvency/Liability topics immune to 'No Noise' filter; renamed directive #2 to 'The Compliance Check' shifting mindset from negotiation to verification; mandate example uses 'verified to have' wording.", date: "2026-02-18" },
        { version: "2026-02-18-010", reason: "v13 Mandate Verification: added CRITICAL rule for feature verification (Escrow, SOC2, Encryption) where 'YES' answer must be logged as Agreed Mandate; updated output format to explicitly include Verified Legal/Security Capabilities.", date: "2026-02-18" },
        { version: "2026-02-18-009", reason: "v12 Keyword Anchoring: restored explicit Legal/Security/Business keyword lists (Insolvency, Escrow, Liability, IP Ownership, SSO, Data Residency, SOC2, Budget caps, Hard Deadlines) to Gatekeeper directive; added CRITICAL rule to never omit Legal/Security mandates even if briefly discussed; Mandates output section now references Escrow/Liability explicitly.", date: "2026-02-18" },
        { version: "2026-02-18-008", reason: "v8 polish: added Security Breach to hypothetical risk examples; Gatekeeper subtitle clarified to 'Separating Risks vs. Mandates' with AWS example; owner integrity now blocks context-based inference; 'We Should' trap explicitly says NOT Action Items; sentiment justification requires plain language.", date: "2026-02-18" },
        { version: "2026-02-18-007", reason: "v7 Split Sections: separated Risks (active threats) from Mandates (agreed constraints) into dedicated output sections; added Stalled & Deferred Decisions section; sentiment requires justification; anti-hallucination rules for quotes and owner inference; strict Executive Summary vs Insights boundary.", date: "2026-02-18" },
        { version: "2026-02-18-006", reason: "v6 Gatekeeper rework: replaced Universal Gatekeepers taxonomy with Classify the Outcome (IF UNRESOLVED→BLOCKER, IF AGREED→MANDATE); output header renamed to 'Risks, Blockers & Mandates' with Risk/Mandate status labels; tightened prose throughout directives.", date: "2026-02-18" },
        { version: "2026-02-18-005", reason: "v5 Decision-Ready Brief: expanded to 7 guardrail rules (Quote Hygiene, No Fluff, Null States), 5 analysis directives (added Gatekeeper Test with Universal Gatekeepers taxonomy and Sentiment & Tone Analysis), Assignment Rule for action items, Strategic Next Steps replaces Recommended Next Steps.", date: "2026-02-18" },
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
