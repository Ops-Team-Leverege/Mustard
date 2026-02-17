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

export function getContractConstraints(contract: AnswerContract): AnswerContractConstraints {
  return CONTRACT_CONSTRAINTS[contract];
}

function checkSafetyRefuse(question: string): AnswerContractResult | null {
  if (shouldRefuse(question)) {
    return {
      contract: AnswerContract.REFUSE,
      contractSelectionMethod: "keyword",
      constraints: CONTRACT_CONSTRAINTS[AnswerContract.REFUSE],
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

  const refuseResult = checkSafetyRefuse(question);
  if (refuseResult) {
    console.log(`[AnswerContract] Selected: ${refuseResult.contract} (safety_refuse)`);
    return refuseResult;
  }

  // LLM-FIRST contract selection: LLM decides the contract based on semantic understanding
  console.log(`[AnswerContract] LLM contract selection for intent=${intent}`);
  return selectContractByLLM(question, intent, layers);
}
