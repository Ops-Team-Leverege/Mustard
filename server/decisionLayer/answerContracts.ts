/**
 * Answer Contracts System (v2)
 * 
 * Purpose:
 * Answer contracts determine response shape, authority level, and constraints.
 * Selected AFTER context layers are determined.
 * Contracts must never alter context layers or intent.
 * 
 * ============================================================================
 * GUARDRAIL: What Contracts Represent
 * ============================================================================
 * Contracts represent task-level operations and output shapes.
 * New contracts must change authority, evidence usage, or output structure — not topic.
 * 
 * Valid reasons to add a contract:
 * - Different SSOT mode (descriptive vs authoritative vs none)
 * - Different evidence requirements (requiresEvidence, requiresCitation)
 * - Different output format (text vs list vs structured)
 * 
 * Invalid reasons to add a contract:
 * - Topic-specific variations (e.g., "PRICING_QUESTION" vs "FEATURE_QUESTION")
 * - Entity-specific variations (e.g., "LES_SCHWAB_SUMMARY" vs "ACE_SUMMARY")
 * ============================================================================
 * 
 * ============================================================================
 * CONTRACT CHAINS: Ordered Execution Plans
 * ============================================================================
 * A contract chain is an ordered execution plan that describes how to fulfill
 * a request within a SINGLE intent and scope.
 *
 * What it is:
 * - Each contract performs one task with fixed output shape
 * - Each contract has explicit authority rules
 * - Later contracts may depend on outputs of earlier contracts
 * - The chain is PLANNED by Decision Layer, not discovered mid-flight
 * 
 * What it is NOT:
 * - One contract per question
 * - One contract per sentence
 * - Dynamic improvisation by the LLM
 * - Intent switching
 * 
 * RESTRICTION RULES:
 * 1. All contracts must share the same intent and scope
 *    - SINGLE_MEETING → CUSTOMER_QUESTIONS → DRAFT_RESPONSE ✅
 *    - SINGLE_MEETING → FEATURE_VERIFICATION ❌ (changes scope)
 *    - If request requires different intents → CLARIFY
 * 
 * 2. Contracts must be orderable (logical sequence)
 *    - Extraction → Analysis → Drafting ✅
 *    - Drafting → Extraction ❌
 * 
 * 3. Authority must not escalate accidentally
 *    - Extractive → Descriptive ✅
 *    - Descriptive → Authoritative (ONLY if explicitly required)
 *    - Extractive → Authoritative ❌ (usually wrong)
 * 
 * 4. Contracts are task-shaped, not topic-shaped
 *    - PATTERN_ANALYSIS ✅
 *    - DASHBOARD_ISSUES_ANALYSIS ❌ (topic belongs in scope filters)
 * 
 * Chain length guidance:
 * - 1-2 contracts: very common
 * - 3 contracts: acceptable for compound tasks
 * - 4+: rare and usually a smell (violating Single Intent invariant)
 * ============================================================================
 * 
 * Key Principles:
 * - One intent per request → one or more contracts executed in sequence
 * - Each contract has an explicit SSOT mode (Descriptive vs Authoritative)
 * - Contracts control authority; SSOT controls truth; ambient context controls framing
 * 
 * SSOT Modes:
 * - Descriptive: Grounded explanations, no factual guarantees
 * - Authoritative: Falsifiable claims, requires Product SSOT
 * - None: Extractive from meeting evidence only
 * 
 * Selection Strategy:
 * - Orchestrator = planner (decides the chain)
 * - Execution Layer = executor (executes after chain is fixed)
 * - The LLM never decides contracts (preserves determinism, auditability, safety)
 * 
 * Layer: Decision Layer (Orchestrator - Contract Selection)
 */

import { OpenAI } from "openai";
import { Intent } from "./intent";
import { ContextLayers } from "./contextLayers";
import { MODEL_ASSIGNMENTS } from "../config/models";
import { buildContractSelectionPrompt } from "../config/prompts/decisionLayer";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export type SSOTMode = "descriptive" | "authoritative" | "none";

export enum AnswerContract {
  // ============================================================================
  // SINGLE_MEETING Extractive Contracts (SSOT mode: none)
  // ============================================================================
  MEETING_SUMMARY = "MEETING_SUMMARY",
  NEXT_STEPS = "NEXT_STEPS",
  ATTENDEES = "ATTENDEES",
  CUSTOMER_QUESTIONS = "CUSTOMER_QUESTIONS",
  EXTRACTIVE_FACT = "EXTRACTIVE_FACT",
  AGGREGATIVE_LIST = "AGGREGATIVE_LIST",

  // ============================================================================
  // MULTI_MEETING Contracts (SSOT mode: none)
  // Identical structure to SINGLE_MEETING, different scope size
  // ============================================================================
  PATTERN_ANALYSIS = "PATTERN_ANALYSIS",       // Recurring themes across meetings
  COMPARISON = "COMPARISON",                   // Differences across meetings
  TREND_SUMMARY = "TREND_SUMMARY",             // Changes over time
  CROSS_MEETING_QUESTIONS = "CROSS_MEETING_QUESTIONS", // Questions across meetings

  // ============================================================================
  // Descriptive contracts (SSOT mode: descriptive)
  // ============================================================================
  PRODUCT_EXPLANATION = "PRODUCT_EXPLANATION",
  VALUE_PROPOSITION = "VALUE_PROPOSITION",
  DRAFT_RESPONSE = "DRAFT_RESPONSE",
  DRAFT_EMAIL = "DRAFT_EMAIL",

  // ============================================================================
  // Product Knowledge contracts (chainable - can be used in contract chains)
  // ============================================================================
  PRODUCT_KNOWLEDGE = "PRODUCT_KNOWLEDGE",     // Fetch product data for chain context

  // ============================================================================
  // Authoritative contracts (SSOT mode: authoritative)
  // ============================================================================
  FEATURE_VERIFICATION = "FEATURE_VERIFICATION",
  FAQ_ANSWER = "FAQ_ANSWER",

  // ============================================================================
  // External Research contracts (uses web search via Gemini)
  // ============================================================================
  EXTERNAL_RESEARCH = "EXTERNAL_RESEARCH",   // Web research on companies/prospects
  SALES_DOCS_PREP = "SALES_DOCS_PREP",       // Research + value prop matching for sales

  // ============================================================================
  // Slack Search contracts (searches Slack as a data source)
  // ============================================================================
  SLACK_MESSAGE_SEARCH = "SLACK_MESSAGE_SEARCH",  // Search Slack messages
  SLACK_CHANNEL_INFO = "SLACK_CHANNEL_INFO",      // Get channel information

  // ============================================================================
  // General contracts
  // ============================================================================
  GENERAL_RESPONSE = "GENERAL_RESPONSE",
  NOT_FOUND = "NOT_FOUND",

  // ============================================================================
  // Terminal contracts
  // ============================================================================
  REFUSE = "REFUSE",
  CLARIFY = "CLARIFY",

  // Legacy (kept for backward compatibility)
  PRODUCT_INFO = "PRODUCT_INFO",
}

export type ContractSelectionMethod = "keyword" | "llm" | "llm_proposed" | "default" | "validation_failure";

export type AnswerContractResult = {
  contract: AnswerContract;
  contractSelectionMethod: ContractSelectionMethod;
  constraints: AnswerContractConstraints;
};

/**
 * Contract Chain - Sequential execution of multiple contracts.
 * 
 * Used for MULTI_MEETING queries where analysis benefits from
 * executing contracts in sequence (e.g., gather data → analyze patterns).
 * 
 * Each contract in the chain:
 * - Receives the output of the previous contract as context
 * - Has its own constraints and SSOT mode
 * - Contributes to the final response
 */
export type ContractChain = {
  contracts: AnswerContract[];
  selectionMethod: ContractSelectionMethod;
  primaryContract: AnswerContract; // The main contract for logging/classification
  clarifyReason?: string; // Set when validation fails and CLARIFY is returned
};

export type ContractChainResult = {
  chain: ContractChain;
  results: Array<{
    contract: AnswerContract;
    output: string;
    constraints: AnswerContractConstraints;
  }>;
  finalOutput: string;
};

/**
 * What to do when a contract receives no evidence.
 * HARDENING: Execution Plane must not invent fallback behavior.
 */
export type EmptyResultBehavior = "return_empty" | "clarify" | "refuse";

export type AnswerContractConstraints = {
  ssotMode: SSOTMode;
  requiresEvidence: boolean;
  maxLength?: number;
  allowsSummary: boolean;
  requiresCitation: boolean;
  responseFormat: "text" | "list" | "structured";
  emptyResultBehavior: EmptyResultBehavior;      // HARDENING: What to do on no evidence
  minEvidenceThreshold?: number;                  // HARDENING: Minimum evidence items required
};

const CONTRACT_CONSTRAINTS: Record<AnswerContract, AnswerContractConstraints> = {
  // Extractive contracts (meeting evidence only)
  [AnswerContract.MEETING_SUMMARY]: {
    ssotMode: "none",
    requiresEvidence: false,
    allowsSummary: true,
    requiresCitation: false,
    responseFormat: "text",
    emptyResultBehavior: "clarify",
  },
  [AnswerContract.NEXT_STEPS]: {
    ssotMode: "none",
    requiresEvidence: true,
    allowsSummary: false,
    requiresCitation: true,
    responseFormat: "list",
    emptyResultBehavior: "return_empty",
  },
  [AnswerContract.ATTENDEES]: {
    ssotMode: "none",
    requiresEvidence: false,
    allowsSummary: false,
    requiresCitation: false,
    responseFormat: "list",
    emptyResultBehavior: "return_empty",
  },
  [AnswerContract.CUSTOMER_QUESTIONS]: {
    ssotMode: "none",
    requiresEvidence: true,
    allowsSummary: false,
    requiresCitation: true,
    responseFormat: "list",
    emptyResultBehavior: "return_empty",
  },
  [AnswerContract.EXTRACTIVE_FACT]: {
    ssotMode: "none",
    requiresEvidence: true,
    allowsSummary: false,
    requiresCitation: true,
    responseFormat: "text",
    emptyResultBehavior: "clarify",
    minEvidenceThreshold: 1,
  },
  [AnswerContract.AGGREGATIVE_LIST]: {
    ssotMode: "none",
    requiresEvidence: true,
    allowsSummary: false,
    requiresCitation: false,
    responseFormat: "list",
    emptyResultBehavior: "return_empty",
  },

  // MULTI_MEETING contracts (identical structure to SINGLE_MEETING, different scope)
  [AnswerContract.PATTERN_ANALYSIS]: {
    ssotMode: "none",
    requiresEvidence: true,
    allowsSummary: true,
    requiresCitation: true,
    responseFormat: "text",
    emptyResultBehavior: "clarify",
    minEvidenceThreshold: 2,  // Need multiple meetings for patterns
  },
  [AnswerContract.COMPARISON]: {
    ssotMode: "none",
    requiresEvidence: true,
    allowsSummary: false,
    requiresCitation: true,
    responseFormat: "structured",
    emptyResultBehavior: "clarify",
    minEvidenceThreshold: 2,  // Need at least 2 for comparison
  },
  [AnswerContract.TREND_SUMMARY]: {
    ssotMode: "none",
    requiresEvidence: true,
    allowsSummary: true,
    requiresCitation: true,
    responseFormat: "text",
    emptyResultBehavior: "clarify",
    minEvidenceThreshold: 3,  // Need enough data points for trends
  },
  [AnswerContract.CROSS_MEETING_QUESTIONS]: {
    ssotMode: "none",
    requiresEvidence: true,
    allowsSummary: false,
    requiresCitation: true,
    responseFormat: "list",
    emptyResultBehavior: "return_empty",
  },

  // Descriptive contracts (grounded, non-authoritative)
  [AnswerContract.PRODUCT_EXPLANATION]: {
    ssotMode: "descriptive",
    requiresEvidence: false,
    allowsSummary: true,
    requiresCitation: false,
    responseFormat: "text",
    emptyResultBehavior: "return_empty",  // Can explain without evidence
  },
  [AnswerContract.VALUE_PROPOSITION]: {
    ssotMode: "descriptive",
    requiresEvidence: false,
    allowsSummary: true,
    requiresCitation: false,
    responseFormat: "text",
    emptyResultBehavior: "return_empty",
  },
  [AnswerContract.DRAFT_RESPONSE]: {
    ssotMode: "descriptive",
    requiresEvidence: false,
    allowsSummary: true,
    requiresCitation: false,
    responseFormat: "text",
    emptyResultBehavior: "return_empty",
  },
  [AnswerContract.DRAFT_EMAIL]: {
    ssotMode: "descriptive",
    requiresEvidence: false,
    allowsSummary: true,
    requiresCitation: false,
    responseFormat: "text",
    emptyResultBehavior: "return_empty",
  },

  // Authoritative contracts (requires Product SSOT)
  [AnswerContract.FEATURE_VERIFICATION]: {
    ssotMode: "authoritative",
    requiresEvidence: true,
    allowsSummary: false,
    requiresCitation: true,
    responseFormat: "text",
    emptyResultBehavior: "refuse",  // Cannot verify without SSOT
    minEvidenceThreshold: 1,
  },
  [AnswerContract.FAQ_ANSWER]: {
    ssotMode: "authoritative",
    requiresEvidence: true,
    allowsSummary: false,
    requiresCitation: false,
    responseFormat: "text",
    emptyResultBehavior: "clarify",  // Can ask for clarification
  },

  // Product Knowledge contract (chainable)
  [AnswerContract.PRODUCT_KNOWLEDGE]: {
    ssotMode: "authoritative",
    requiresEvidence: false,  // Fetches from Airtable SSOT
    allowsSummary: true,
    requiresCitation: true,   // Must cite source tables
    responseFormat: "text",
    emptyResultBehavior: "return_empty",  // Can return empty if no matching data
  },

  // General/Legacy contracts
  [AnswerContract.PRODUCT_INFO]: {
    ssotMode: "descriptive",
    requiresEvidence: false,
    allowsSummary: true,
    requiresCitation: false,
    responseFormat: "text",
    emptyResultBehavior: "return_empty",
  },
  // External Research contracts (uses web search via Gemini)
  [AnswerContract.EXTERNAL_RESEARCH]: {
    ssotMode: "descriptive",
    requiresEvidence: false,
    allowsSummary: true,
    requiresCitation: false,
    responseFormat: "text",
    emptyResultBehavior: "clarify",
  },
  [AnswerContract.SALES_DOCS_PREP]: {
    ssotMode: "descriptive",
    requiresEvidence: false,
    allowsSummary: true,
    requiresCitation: false,
    responseFormat: "structured",
    emptyResultBehavior: "clarify",
  },

  [AnswerContract.GENERAL_RESPONSE]: {
    ssotMode: "none",
    requiresEvidence: false,
    allowsSummary: true,
    requiresCitation: false,
    responseFormat: "text",
    emptyResultBehavior: "return_empty",
  },
  [AnswerContract.NOT_FOUND]: {
    ssotMode: "none",
    requiresEvidence: false,
    allowsSummary: false,
    requiresCitation: false,
    responseFormat: "text",
    emptyResultBehavior: "return_empty",
  },

  // Slack Search contracts (extractive from Slack)
  [AnswerContract.SLACK_MESSAGE_SEARCH]: {
    ssotMode: "none",
    requiresEvidence: true,
    allowsSummary: false,
    requiresCitation: true,  // Link to Slack messages
    responseFormat: "list",
    emptyResultBehavior: "return_empty",
    minEvidenceThreshold: 1,
  },
  [AnswerContract.SLACK_CHANNEL_INFO]: {
    ssotMode: "none",
    requiresEvidence: false,
    allowsSummary: false,
    requiresCitation: false,
    responseFormat: "list",
    emptyResultBehavior: "return_empty",
  },

  // Terminal contracts (no execution, just terminal responses)
  [AnswerContract.REFUSE]: {
    ssotMode: "none",
    requiresEvidence: false,
    allowsSummary: false,
    requiresCitation: false,
    responseFormat: "text",
    emptyResultBehavior: "refuse",  // Already a terminal
  },
  [AnswerContract.CLARIFY]: {
    ssotMode: "none",
    requiresEvidence: false,
    allowsSummary: false,
    requiresCitation: false,
    responseFormat: "text",
    emptyResultBehavior: "clarify",  // Already a terminal
  },
};

const SINGLE_MEETING_CONTRACT_KEYWORDS: Record<string, AnswerContract> = {
  // Drafting patterns (check BEFORE generic "follow up")
  "follow up email": AnswerContract.DRAFT_EMAIL,
  "follow-up email": AnswerContract.DRAFT_EMAIL,
  "prepare a follow up": AnswerContract.DRAFT_EMAIL,
  "prepare a follow-up": AnswerContract.DRAFT_EMAIL,
  "draft an email": AnswerContract.DRAFT_EMAIL,
  "write an email": AnswerContract.DRAFT_EMAIL,
  "prepare an email": AnswerContract.DRAFT_EMAIL,
  "thank you email": AnswerContract.DRAFT_EMAIL,
  "thank-you email": AnswerContract.DRAFT_EMAIL,
  "thanks email": AnswerContract.DRAFT_EMAIL,
  "write a thank you": AnswerContract.DRAFT_EMAIL,
  "write thank you": AnswerContract.DRAFT_EMAIL,
  "help me answer": AnswerContract.DRAFT_RESPONSE,
  "draft a response": AnswerContract.DRAFT_RESPONSE,
  "respond to": AnswerContract.DRAFT_RESPONSE,

  // Summary patterns
  "summary": AnswerContract.MEETING_SUMMARY,
  "summarize": AnswerContract.MEETING_SUMMARY,
  "overview": AnswerContract.MEETING_SUMMARY,

  // Action item patterns (including common typos/variations)
  "action items": AnswerContract.NEXT_STEPS,
  "actions items": AnswerContract.NEXT_STEPS,  // Common typo
  "action item": AnswerContract.NEXT_STEPS,    // Singular
  "next steps": AnswerContract.NEXT_STEPS,
  "next step": AnswerContract.NEXT_STEPS,      // Singular
  "commitments": AnswerContract.NEXT_STEPS,
  "commitment": AnswerContract.NEXT_STEPS,     // Singular
  "follow up": AnswerContract.NEXT_STEPS,      // Generic "follow up" - lower priority
  "follow-up": AnswerContract.NEXT_STEPS,      // Hyphenated variant
  "followup": AnswerContract.NEXT_STEPS,       // Combined variant  
  "to-do": AnswerContract.NEXT_STEPS,
  "todo": AnswerContract.NEXT_STEPS,           // No hyphen variant

  // Attendee patterns
  "attendees": AnswerContract.ATTENDEES,
  "who was on": AnswerContract.ATTENDEES,
  "who attended": AnswerContract.ATTENDEES,
  "participants": AnswerContract.ATTENDEES,

  // Customer questions patterns
  "customer questions": AnswerContract.CUSTOMER_QUESTIONS,
  "what did they ask": AnswerContract.CUSTOMER_QUESTIONS,
  "questions asked": AnswerContract.CUSTOMER_QUESTIONS,
  "what questions": AnswerContract.CUSTOMER_QUESTIONS,
};

const PRODUCT_KNOWLEDGE_CONTRACT_KEYWORDS: Record<string, AnswerContract> = {
  "how does pitcrew work": AnswerContract.PRODUCT_EXPLANATION,
  "what is pitcrew": AnswerContract.PRODUCT_EXPLANATION,
  "explain pitcrew": AnswerContract.PRODUCT_EXPLANATION,
  "tell me about pitcrew": AnswerContract.PRODUCT_EXPLANATION,
  "does it support": AnswerContract.FEATURE_VERIFICATION,
  "does pitcrew support": AnswerContract.FEATURE_VERIFICATION,
  "can pitcrew": AnswerContract.FEATURE_VERIFICATION,
  "does pitcrew integrate": AnswerContract.FEATURE_VERIFICATION,
  "integrate with": AnswerContract.FEATURE_VERIFICATION,
  "how much": AnswerContract.FAQ_ANSWER,
  "pricing": AnswerContract.FAQ_ANSWER,
  "cost": AnswerContract.FAQ_ANSWER,
  "what tier": AnswerContract.FAQ_ANSWER,
  "pro tier": AnswerContract.FAQ_ANSWER,
  "advanced tier": AnswerContract.FAQ_ANSWER,
  "enterprise tier": AnswerContract.FAQ_ANSWER,
  "value prop": AnswerContract.VALUE_PROPOSITION,
  "why pitcrew": AnswerContract.VALUE_PROPOSITION,
  "benefits of": AnswerContract.VALUE_PROPOSITION,
};

const GENERAL_CONTRACT_KEYWORDS: Record<string, AnswerContract> = {
  "draft an email": AnswerContract.DRAFT_EMAIL,
  "write an email": AnswerContract.DRAFT_EMAIL,
  "compose an email": AnswerContract.DRAFT_EMAIL,
  "email template": AnswerContract.DRAFT_EMAIL,
  "help me write": AnswerContract.DRAFT_EMAIL,
  "follow up email": AnswerContract.DRAFT_EMAIL,
  "follow-up email": AnswerContract.DRAFT_EMAIL,
  "prepare an email": AnswerContract.DRAFT_EMAIL,
  "prepare a follow up": AnswerContract.DRAFT_EMAIL,
  "prepare a follow-up": AnswerContract.DRAFT_EMAIL,
  "thank you email": AnswerContract.DRAFT_EMAIL,
  "thank-you email": AnswerContract.DRAFT_EMAIL,
  "thanks email": AnswerContract.DRAFT_EMAIL,
  "write a thank you": AnswerContract.DRAFT_EMAIL,
  "write thank you": AnswerContract.DRAFT_EMAIL,
};

/**
 * MULTI_MEETING contract keywords - different scope size, same contract structure.
 * 
 * IMPORTANT: Keywords infer the analytical task (comparison, pattern, trend),
 * NOT new intent categories or topic-specific contracts.
 * This is task inference within a fixed intent, not intent classification.
 */
const MULTI_MEETING_CONTRACT_KEYWORDS: Record<string, AnswerContract> = {
  // Pattern analysis (recurring themes)
  "pattern": AnswerContract.PATTERN_ANALYSIS,
  "patterns": AnswerContract.PATTERN_ANALYSIS,
  "recurring": AnswerContract.PATTERN_ANALYSIS,
  "common theme": AnswerContract.PATTERN_ANALYSIS,
  "frequently": AnswerContract.PATTERN_ANALYSIS,
  "often": AnswerContract.PATTERN_ANALYSIS,
  "always come up": AnswerContract.PATTERN_ANALYSIS,
  "keeps coming up": AnswerContract.PATTERN_ANALYSIS,

  // Comparison (differences across meetings)
  "compare": AnswerContract.COMPARISON,
  "difference": AnswerContract.COMPARISON,
  "differences": AnswerContract.COMPARISON,
  "differ": AnswerContract.COMPARISON,
  "contrast": AnswerContract.COMPARISON,
  "versus": AnswerContract.COMPARISON,
  "vs": AnswerContract.COMPARISON,
  "between meetings": AnswerContract.COMPARISON,

  // Trend summary (changes over time)
  "trend": AnswerContract.TREND_SUMMARY,
  "trends": AnswerContract.TREND_SUMMARY,
  "over time": AnswerContract.TREND_SUMMARY,
  "changing": AnswerContract.TREND_SUMMARY,
  "evolving": AnswerContract.TREND_SUMMARY,
  "growing": AnswerContract.TREND_SUMMARY,
  "declining": AnswerContract.TREND_SUMMARY,
  "progression": AnswerContract.TREND_SUMMARY,

  // Cross-meeting questions
  "questions across": AnswerContract.CROSS_MEETING_QUESTIONS,
  "common questions": AnswerContract.CROSS_MEETING_QUESTIONS,
  "what are customers asking": AnswerContract.CROSS_MEETING_QUESTIONS,
  "frequently asked": AnswerContract.CROSS_MEETING_QUESTIONS,
  "most asked": AnswerContract.CROSS_MEETING_QUESTIONS,
  "objections": AnswerContract.CROSS_MEETING_QUESTIONS,
  "concerns raised": AnswerContract.CROSS_MEETING_QUESTIONS,
  // Additional aggregate analysis keywords
  "concerns": AnswerContract.CROSS_MEETING_QUESTIONS,
  "customer concerns": AnswerContract.CROSS_MEETING_QUESTIONS,
  "bigger concerns": AnswerContract.CROSS_MEETING_QUESTIONS,
  "main concerns": AnswerContract.CROSS_MEETING_QUESTIONS,
  "issues": AnswerContract.CROSS_MEETING_QUESTIONS,
  "customer issues": AnswerContract.CROSS_MEETING_QUESTIONS,
  "problems": AnswerContract.CROSS_MEETING_QUESTIONS,
  "feedback": AnswerContract.CROSS_MEETING_QUESTIONS,
  "customer feedback": AnswerContract.CROSS_MEETING_QUESTIONS,
  "worries": AnswerContract.CROSS_MEETING_QUESTIONS,
  "hesitations": AnswerContract.CROSS_MEETING_QUESTIONS,
  "reservations": AnswerContract.CROSS_MEETING_QUESTIONS,
  "pain points": AnswerContract.CROSS_MEETING_QUESTIONS,
  "challenges": AnswerContract.CROSS_MEETING_QUESTIONS,
  "customer challenges": AnswerContract.CROSS_MEETING_QUESTIONS,
};

const REFUSE_PATTERNS = [
  /\b(weather|forecast|temperature)\b/i,
  /\b(home address|personal address|private address)\b/i,
  /\b(stock price|stock market|invest)\b/i,
  /\b(revenue|profit|how much money)\s+(will|would|can|could)\b/i,
  /\b(what's the time|current time|what time is it)\b/i,
];

function shouldRefuse(question: string): boolean {
  return REFUSE_PATTERNS.some(pattern => pattern.test(question));
}

/**
 * Contract Task Categories - Used for dynamic chain building.
 * 
 * Tasks are ordered by execution phase:
 * 1. EXTRACTION: Pull data from sources
 * 2. ANALYSIS: Analyze/synthesize extracted data
 * 3. DRAFTING: Generate output based on analysis
 */
type TaskPhase = "extraction" | "analysis" | "drafting";

const CONTRACT_PHASES: Record<AnswerContract, TaskPhase> = {
  // Extraction phase
  [AnswerContract.MEETING_SUMMARY]: "extraction",
  [AnswerContract.NEXT_STEPS]: "extraction",
  [AnswerContract.ATTENDEES]: "extraction",
  [AnswerContract.CUSTOMER_QUESTIONS]: "extraction",
  [AnswerContract.EXTRACTIVE_FACT]: "extraction",
  [AnswerContract.AGGREGATIVE_LIST]: "extraction",
  [AnswerContract.CROSS_MEETING_QUESTIONS]: "extraction",
  [AnswerContract.PRODUCT_KNOWLEDGE]: "extraction",  // Fetches product data for chain context

  // Analysis phase
  [AnswerContract.PATTERN_ANALYSIS]: "analysis",
  [AnswerContract.COMPARISON]: "analysis",
  [AnswerContract.TREND_SUMMARY]: "analysis",

  // Research phase (external web research)
  [AnswerContract.EXTERNAL_RESEARCH]: "analysis",
  [AnswerContract.SALES_DOCS_PREP]: "analysis",

  // Drafting phase
  [AnswerContract.PRODUCT_EXPLANATION]: "drafting",
  [AnswerContract.VALUE_PROPOSITION]: "drafting",
  [AnswerContract.DRAFT_RESPONSE]: "drafting",
  [AnswerContract.DRAFT_EMAIL]: "drafting",
  [AnswerContract.FEATURE_VERIFICATION]: "drafting",
  [AnswerContract.FAQ_ANSWER]: "drafting",
  [AnswerContract.SLACK_MESSAGE_SEARCH]: "extraction",
  [AnswerContract.SLACK_CHANNEL_INFO]: "extraction",
  [AnswerContract.GENERAL_RESPONSE]: "drafting",
  [AnswerContract.NOT_FOUND]: "drafting",
  [AnswerContract.REFUSE]: "drafting",
  [AnswerContract.CLARIFY]: "drafting",
  [AnswerContract.PRODUCT_INFO]: "drafting",
};

const PHASE_ORDER: Record<TaskPhase, number> = {
  extraction: 1,
  analysis: 2,
  drafting: 3,
};

/**
 * Task keywords - maps user language to required tasks.
 * Each task maps to one or more contracts that can fulfill it.
 */
const TASK_KEYWORDS: Array<{
  pattern: RegExp;
  task: string;
  contracts: AnswerContract[];
  intent: Intent[];
}> = [
    // Extraction tasks
    {
      pattern: /questions?|asked|concerns|objections/i, task: "extract_questions",
      contracts: [AnswerContract.CUSTOMER_QUESTIONS, AnswerContract.CROSS_MEETING_QUESTIONS],
      intent: [Intent.SINGLE_MEETING, Intent.MULTI_MEETING]
    },
    {
      pattern: /summarize|summary|overview/i, task: "summarize",
      contracts: [AnswerContract.MEETING_SUMMARY],
      intent: [Intent.SINGLE_MEETING]
    },
    {
      pattern: /action items?|next steps?|to-?do/i, task: "extract_actions",
      contracts: [AnswerContract.NEXT_STEPS],
      intent: [Intent.SINGLE_MEETING]
    },
    {
      pattern: /who\s+(was|attended|joined)|attendees?|participants?/i, task: "extract_attendees",
      contracts: [AnswerContract.ATTENDEES],
      intent: [Intent.SINGLE_MEETING]
    },

    // Analysis tasks
    {
      pattern: /pattern|recurring|theme|common\s+theme/i, task: "analyze_patterns",
      contracts: [AnswerContract.PATTERN_ANALYSIS],
      intent: [Intent.MULTI_MEETING]
    },
    {
      pattern: /compare|difference|differ|contrast|versus|vs\b/i, task: "compare",
      contracts: [AnswerContract.COMPARISON],
      intent: [Intent.MULTI_MEETING]
    },
    {
      pattern: /trend|over time|changing|evolving|progression/i, task: "analyze_trends",
      contracts: [AnswerContract.TREND_SUMMARY],
      intent: [Intent.MULTI_MEETING]
    },

    // Drafting tasks
    {
      pattern: /help\s+(me\s+)?(answer|respond|reply)|draft\s+(a\s+)?response/i, task: "draft_response",
      contracts: [AnswerContract.DRAFT_RESPONSE],
      intent: [Intent.SINGLE_MEETING, Intent.MULTI_MEETING, Intent.GENERAL_HELP]
    },
    {
      pattern: /draft\s+(an?\s+)?email|write\s+(an?\s+)?email|email\s+template/i, task: "draft_email",
      contracts: [AnswerContract.DRAFT_EMAIL],
      intent: [Intent.GENERAL_HELP]
    },

    // External research tasks
    {
      pattern: /research|earnings\s+call|public\s+statement|their\s+priorit/i, task: "external_research",
      contracts: [AnswerContract.EXTERNAL_RESEARCH],
      intent: [Intent.EXTERNAL_RESEARCH]
    },
    {
      pattern: /slide\s+deck|sales\s+deck|pitch\s+deck|presentation\s+for|draft.*slides?|create.*slides?/i, task: "sales_docs_prep",
      contracts: [AnswerContract.SALES_DOCS_PREP],
      intent: [Intent.EXTERNAL_RESEARCH]
    },
    {
      pattern: /value\s*prop|pitcrew['']?s?\s+value|our\s+value|connect.*pitcrew|align.*offering|match.*product|our\s+offer|pitcrew\s+offer|based\s+on\s+pitcrew|pitcrew['']?s?\s+(?:features?|capabilities?|approach)/i, task: "product_connection",
      contracts: [AnswerContract.PRODUCT_KNOWLEDGE],
      intent: [Intent.EXTERNAL_RESEARCH, Intent.GENERAL_HELP, Intent.SINGLE_MEETING, Intent.MULTI_MEETING, Intent.PRODUCT_KNOWLEDGE]
    },
  ];

/**
 * Identify required tasks from user message.
 */
function identifyTasks(userMessage: string, intent: Intent): string[] {
  const tasks: string[] = [];

  for (const taskDef of TASK_KEYWORDS) {
    if (taskDef.pattern.test(userMessage) && taskDef.intent.includes(intent)) {
      tasks.push(taskDef.task);
    }
  }

  return tasks;
}

/**
 * Get the contract for a task within an intent and scope.
 * 
 * Scope influences contract selection:
 * - Single meeting scope → use single-meeting contracts
 * - Multi-meeting scope with filters → prefer aggregative contracts
 * - Multi-meeting scope without filters → prefer pattern/trend contracts
 */
function getContractForTask(task: string, intent: Intent, scope: ChainBuildScope): AnswerContract | null {
  const taskDef = TASK_KEYWORDS.find(t => t.task === task && t.intent.includes(intent));
  if (!taskDef) return null;

  // Scope type enforcement: don't allow cross-scope contracts
  if (scope.type === "single_meeting" && task === "extract_questions") {
    return AnswerContract.CUSTOMER_QUESTIONS;
  }

  if (scope.type === "multi_meeting" && task === "extract_questions") {
    return AnswerContract.CROSS_MEETING_QUESTIONS;
  }

  // Scope filters influence analysis contract selection
  if (scope.type === "multi_meeting" && scope.filters?.topic) {
    // When topic filter exists, prefer aggregative over pattern analysis
    if (task === "analyze_patterns") {
      return AnswerContract.AGGREGATIVE_LIST;
    }
  }

  // When we have specific meeting IDs, analysis is more focused
  if (scope.type === "multi_meeting" && scope.meetingIds && scope.meetingIds.length <= 3) {
    // Few meetings → comparison is more appropriate than pattern analysis
    if (task === "analyze_patterns") {
      return AnswerContract.COMPARISON;
    }
  }

  return taskDef.contracts[0];
}

/**
 * Coverage metadata for multi-meeting queries.
 * Analytical contracts can reference this to qualify claims.
 * HARDENING: Do not imply comprehensive coverage unless explicitly true.
 */
export type MultiMeetingCoverage = {
  totalMeetingsSearched: number;       // Total meetings in search space
  matchingMeetingsCount: number;       // Meetings that matched the query
  uniqueCompaniesRepresented: number;  // Distinct companies in results
  dateRange?: {
    earliest: Date;
    latest: Date;
  };
};

/**
 * Scope information passed to chain building.
 * Used to influence contract selection based on resolved scope.
 */
export type ChainBuildScope = {
  type: "single_meeting" | "multi_meeting" | "none";
  meetingId?: string;
  meetingIds?: string[];
  companyId?: string;
  companyName?: string;
  filters?: {
    company?: string;
    topic?: string;
    timeRange?: { start?: Date; end?: Date };
  };
  coverage?: MultiMeetingCoverage;  // HARDENING: Coverage metadata for multi-meeting
};

/**
 * Build a contract chain dynamically based on:
 * 1. The resolved intent
 * 2. The resolved scope
 * 3. The inferred task(s) required to answer
 * 
 * The chain is built by:
 * 1. Identifying all required tasks from user message
 * 2. Mapping tasks to contracts (respecting intent and scope)
 * 3. Ordering contracts by phase (extraction → analysis → drafting)
 * 4. Validating the chain follows restriction rules
 * 
 * CONTROL PLANE decides the chain - LLM executes it.
 */
export function buildContractChain(
  userMessage: string,
  intent: Intent,
  scope: ChainBuildScope
): ContractChain {
  console.log(`[ContractChain] Building chain for intent=${intent}, scope.type=${scope.type}`);

  // Step 1: Identify required tasks from user message
  const tasks = identifyTasks(userMessage, intent);
  console.log(`[ContractChain] Identified tasks: [${tasks.join(", ")}]`);

  // Step 2: Map tasks to contracts (respecting intent and scope)
  const contracts: AnswerContract[] = [];
  for (const task of tasks) {
    const contract = getContractForTask(task, intent, scope);
    if (contract && !contracts.includes(contract)) {
      contracts.push(contract);
    }
  }

  // Step 3: If no contracts identified, use defaults based on intent and scope
  if (contracts.length === 0) {
    const defaultContract = getDefaultContract(intent, scope);
    contracts.push(defaultContract);
    console.log(`[ContractChain] No tasks identified, using default: ${defaultContract}`);
  }

  // Step 4: Order contracts by phase (extraction → analysis → drafting)
  contracts.sort((a, b) => {
    const phaseA = CONTRACT_PHASES[a] || "drafting";
    const phaseB = CONTRACT_PHASES[b] || "drafting";
    return PHASE_ORDER[phaseA] - PHASE_ORDER[phaseB];
  });

  // Step 5: Validate chain follows restriction rules
  const validation = validateChain(contracts, intent);

  // If validation fails, return CLARIFY contract instead
  if (!validation.valid && validation.shouldClarify) {
    console.log(`[ContractChain] Validation failed, returning CLARIFY: ${validation.reason}`);
    return {
      contracts: [AnswerContract.CLARIFY],
      selectionMethod: "validation_failure",
      primaryContract: AnswerContract.CLARIFY,
      clarifyReason: validation.reason,
    };
  }

  console.log(`[ContractChain] Built chain: [${contracts.join(" → ")}]`);

  return {
    contracts,
    selectionMethod: "keyword",
    primaryContract: contracts[0],
  };
}

/**
 * Get the default contract when no tasks are identified.
 */
function getDefaultContract(intent: Intent, scope: ChainBuildScope): AnswerContract {
  switch (intent) {
    case Intent.SINGLE_MEETING:
      return AnswerContract.EXTRACTIVE_FACT;
    case Intent.MULTI_MEETING:
      // If scope has filters, prefer aggregation; otherwise pattern analysis
      if (scope.filters?.topic || scope.filters?.company) {
        return AnswerContract.AGGREGATIVE_LIST;
      }
      return AnswerContract.PATTERN_ANALYSIS;
    case Intent.PRODUCT_KNOWLEDGE:
      return AnswerContract.PRODUCT_EXPLANATION;
    case Intent.EXTERNAL_RESEARCH:
      return AnswerContract.EXTERNAL_RESEARCH;
    case Intent.GENERAL_HELP:
      return AnswerContract.GENERAL_RESPONSE;
    default:
      return AnswerContract.GENERAL_RESPONSE;
  }
}

/**
 * Chain validation result.
 */
type ChainValidationResult = {
  valid: boolean;
  reason?: string;
  shouldClarify: boolean;
};

/**
 * Validate that the chain follows restriction rules.
 * Returns whether the chain is valid and if CLARIFY should be used.
 * 
 * Restriction rules enforced:
 * 1. Chain length 4+ → CLARIFY (likely Single Intent violation)
 * 2. Authority escalation without explicit requirement → CLARIFY
 * 3. Phase order violation → reorder (handled in buildContractChain)
 */
function validateChain(contracts: AnswerContract[], intent: Intent): ChainValidationResult {
  // Rule 1: Chain length should be 1-3 (4+ triggers CLARIFY)
  if (contracts.length >= 4) {
    console.warn(`[ContractChain] Chain length ${contracts.length} indicates Single Intent violation → CLARIFY`);
    return {
      valid: false,
      reason: "Your request seems to combine multiple distinct tasks. Could you break it into separate questions?",
      shouldClarify: true,
    };
  }

  // Rule 2: Authority should not escalate from extractive to authoritative
  const authorityLevels: Record<SSOTMode, number> = { none: 0, descriptive: 1, authoritative: 2 };
  let hasExtractiveContract = false;
  let hasAuthoritativeContract = false;

  for (const contract of contracts) {
    const constraints = CONTRACT_CONSTRAINTS[contract];
    if (constraints.ssotMode === "none") hasExtractiveContract = true;
    if (constraints.ssotMode === "authoritative") hasAuthoritativeContract = true;
  }

  // Extractive → Authoritative is usually wrong (mixing meeting data with product claims)
  if (hasExtractiveContract && hasAuthoritativeContract) {
    console.warn(`[ContractChain] Authority escalation: mixing extractive and authoritative contracts → CLARIFY`);
    return {
      valid: false,
      reason: "Your question combines meeting-specific information with product knowledge. Please ask these as separate questions.",
      shouldClarify: true,
    };
  }

  // Rule 3: Contracts must be orderable (check phase order after sorting)
  let lastPhase = 0;
  for (const contract of contracts) {
    const phase = PHASE_ORDER[CONTRACT_PHASES[contract] || "drafting"];
    if (phase < lastPhase) {
      // This shouldn't happen after sorting, but log if it does
      console.warn(`[ContractChain] Phase order violation: ${contract} is out of order`);
    }
    lastPhase = phase;
  }

  return { valid: true, shouldClarify: false };
}

export function getContractConstraints(contract: AnswerContract): AnswerContractConstraints {
  return CONTRACT_CONSTRAINTS[contract];
}

function selectContractByKeyword(
  question: string,
  intent: Intent,
  _layers: ContextLayers
): AnswerContractResult | null {
  const lower = question.toLowerCase();

  if (shouldRefuse(question)) {
    return {
      contract: AnswerContract.REFUSE,
      contractSelectionMethod: "keyword",
      constraints: CONTRACT_CONSTRAINTS[AnswerContract.REFUSE],
    };
  }

  if (intent === Intent.SINGLE_MEETING) {
    for (const [keyword, contract] of Object.entries(SINGLE_MEETING_CONTRACT_KEYWORDS)) {
      if (lower.includes(keyword)) {
        return {
          contract,
          contractSelectionMethod: "keyword",
          constraints: CONTRACT_CONSTRAINTS[contract],
        };
      }
    }
    return {
      contract: AnswerContract.EXTRACTIVE_FACT,
      contractSelectionMethod: "default",
      constraints: CONTRACT_CONSTRAINTS[AnswerContract.EXTRACTIVE_FACT],
    };
  }

  if (intent === Intent.MULTI_MEETING) {
    // Use dedicated MULTI_MEETING keywords for cross-meeting analysis
    for (const [keyword, contract] of Object.entries(MULTI_MEETING_CONTRACT_KEYWORDS)) {
      if (lower.includes(keyword)) {
        return {
          contract,
          contractSelectionMethod: "keyword",
          constraints: CONTRACT_CONSTRAINTS[contract],
        };
      }
    }
    // Default to PATTERN_ANALYSIS for general cross-meeting queries
    return {
      contract: AnswerContract.PATTERN_ANALYSIS,
      contractSelectionMethod: "default",
      constraints: CONTRACT_CONSTRAINTS[AnswerContract.PATTERN_ANALYSIS],
    };
  }

  if (intent === Intent.PRODUCT_KNOWLEDGE) {
    for (const [keyword, contract] of Object.entries(PRODUCT_KNOWLEDGE_CONTRACT_KEYWORDS)) {
      if (lower.includes(keyword)) {
        return {
          contract,
          contractSelectionMethod: "keyword",
          constraints: CONTRACT_CONSTRAINTS[contract],
        };
      }
    }
    return {
      contract: AnswerContract.PRODUCT_EXPLANATION,
      contractSelectionMethod: "default",
      constraints: CONTRACT_CONSTRAINTS[AnswerContract.PRODUCT_EXPLANATION],
    };
  }

  if (intent === Intent.EXTERNAL_RESEARCH) {
    // Check for slide deck / pitch deck keywords
    if (lower.includes("slide") || lower.includes("deck") || lower.includes("pitch")) {
      return {
        contract: AnswerContract.SALES_DOCS_PREP,
        contractSelectionMethod: "keyword",
        constraints: CONTRACT_CONSTRAINTS[AnswerContract.SALES_DOCS_PREP],
      };
    }
    if (lower.includes("value prop")) {
      return {
        contract: AnswerContract.VALUE_PROPOSITION,
        contractSelectionMethod: "keyword",
        constraints: CONTRACT_CONSTRAINTS[AnswerContract.VALUE_PROPOSITION],
      };
    }
    return {
      contract: AnswerContract.EXTERNAL_RESEARCH,
      contractSelectionMethod: "default",
      constraints: CONTRACT_CONSTRAINTS[AnswerContract.EXTERNAL_RESEARCH],
    };
  }

  if (intent === Intent.GENERAL_HELP) {
    for (const [keyword, contract] of Object.entries(GENERAL_CONTRACT_KEYWORDS)) {
      if (lower.includes(keyword)) {
        return {
          contract,
          contractSelectionMethod: "keyword",
          constraints: CONTRACT_CONSTRAINTS[contract],
        };
      }
    }
    return {
      contract: AnswerContract.GENERAL_RESPONSE,
      contractSelectionMethod: "default",
      constraints: CONTRACT_CONSTRAINTS[AnswerContract.GENERAL_RESPONSE],
    };
  }

  return null;
}

async function selectContractByLLM(
  question: string,
  intent: Intent,
  _layers: ContextLayers
): Promise<AnswerContractResult> {
  const validContracts = Object.keys(AnswerContract).join(", ");
  const systemPrompt = buildContractSelectionPrompt(intent, validContracts);

  try {
    const response = await openai.chat.completions.create({
      model: MODEL_ASSIGNMENTS.CONTRACT_SELECTION,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return {
        contract: AnswerContract.GENERAL_RESPONSE,
        contractSelectionMethod: "default",
        constraints: CONTRACT_CONSTRAINTS[AnswerContract.GENERAL_RESPONSE],
      };
    }

    const parsed = JSON.parse(content);
    const contractStr = parsed.contract as string;

    if (contractStr in AnswerContract) {
      const contract = AnswerContract[contractStr as keyof typeof AnswerContract];
      return {
        contract,
        contractSelectionMethod: "llm",
        constraints: CONTRACT_CONSTRAINTS[contract],
      };
    }

    return {
      contract: AnswerContract.GENERAL_RESPONSE,
      contractSelectionMethod: "default",
      constraints: CONTRACT_CONSTRAINTS[AnswerContract.GENERAL_RESPONSE],
    };
  } catch (error) {
    console.error("[AnswerContract] LLM selection error:", error);
    return {
      contract: AnswerContract.GENERAL_RESPONSE,
      contractSelectionMethod: "default",
      constraints: CONTRACT_CONSTRAINTS[AnswerContract.GENERAL_RESPONSE],
    };
  }
}

export async function selectAnswerContract(
  question: string,
  intent: Intent,
  layers: ContextLayers,
  llmProposedContracts?: string[]
): Promise<AnswerContractResult> {
  // LLM-FIRST: If LLM interpretation proposed valid contracts, use them (primary selection method)
  // This respects the semantic understanding from intent classification
  if (llmProposedContracts && llmProposedContracts.length > 0) {
    const validContracts = llmProposedContracts.filter(c =>
      Object.values(AnswerContract).includes(c as AnswerContract)
    );
    if (validContracts.length > 0) {
      const contract = validContracts[0] as AnswerContract;
      console.log(`[AnswerContract] Selected: ${contract} (llm_proposed) - chain: [${validContracts.join(" → ")}]`);
      return {
        contract,
        contractSelectionMethod: "llm_proposed",
        constraints: CONTRACT_CONSTRAINTS[contract],
      };
    }
  }

  // Keyword fallback: Only used when LLM didn't propose contracts (e.g., legacy paths or absolute certainties)
  const keywordResult = selectContractByKeyword(question, intent, layers);

  if (keywordResult) {
    console.log(`[AnswerContract] Selected: ${keywordResult.contract} (${keywordResult.contractSelectionMethod})`);
    return keywordResult;
  }

  // LLM classification fallback: If no LLM-proposed contracts and no keyword match
  console.log(`[AnswerContract] No LLM proposal or keyword match, using LLM classification fallback`);
  return selectContractByLLM(question, intent, layers);
}
