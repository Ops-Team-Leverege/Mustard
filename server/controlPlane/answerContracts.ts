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
 * - The chain is PLANNED by control plane, not discovered mid-flight
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
 * - Control Plane = planner (decides the chain)
 * - LLM = executor (executes after chain is fixed)
 * - The LLM never decides contracts (preserves determinism, auditability, safety)
 * 
 * Layer: Control Plane (Answer Contract Selection)
 */

import { OpenAI } from "openai";
import { Intent } from "./intent";
import { ContextLayers } from "./contextLayers";

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
  // Authoritative contracts (SSOT mode: authoritative)
  // ============================================================================
  FEATURE_VERIFICATION = "FEATURE_VERIFICATION",
  FAQ_ANSWER = "FAQ_ANSWER",
  
  // ============================================================================
  // General contracts
  // ============================================================================
  DOCUMENT_ANSWER = "DOCUMENT_ANSWER",
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

export type ContractSelectionMethod = "keyword" | "llm" | "default";

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

export type AnswerContractConstraints = {
  ssotMode: SSOTMode;
  requiresEvidence: boolean;
  maxLength?: number;
  allowsSummary: boolean;
  requiresCitation: boolean;
  responseFormat: "text" | "list" | "structured";
};

const CONTRACT_CONSTRAINTS: Record<AnswerContract, AnswerContractConstraints> = {
  // Extractive contracts (meeting evidence only)
  [AnswerContract.MEETING_SUMMARY]: {
    ssotMode: "none",
    requiresEvidence: false,
    allowsSummary: true,
    requiresCitation: false,
    responseFormat: "text",
  },
  [AnswerContract.NEXT_STEPS]: {
    ssotMode: "none",
    requiresEvidence: true,
    allowsSummary: false,
    requiresCitation: true,
    responseFormat: "list",
  },
  [AnswerContract.ATTENDEES]: {
    ssotMode: "none",
    requiresEvidence: false,
    allowsSummary: false,
    requiresCitation: false,
    responseFormat: "list",
  },
  [AnswerContract.CUSTOMER_QUESTIONS]: {
    ssotMode: "none",
    requiresEvidence: true,
    allowsSummary: false,
    requiresCitation: true,
    responseFormat: "list",
  },
  [AnswerContract.EXTRACTIVE_FACT]: {
    ssotMode: "none",
    requiresEvidence: true,
    allowsSummary: false,
    requiresCitation: true,
    responseFormat: "text",
  },
  [AnswerContract.AGGREGATIVE_LIST]: {
    ssotMode: "none",
    requiresEvidence: true,
    allowsSummary: false,
    requiresCitation: false,
    responseFormat: "list",
  },
  
  // MULTI_MEETING contracts (identical structure to SINGLE_MEETING, different scope)
  [AnswerContract.PATTERN_ANALYSIS]: {
    ssotMode: "none",
    requiresEvidence: true,
    allowsSummary: true,
    requiresCitation: true,
    responseFormat: "text",
  },
  [AnswerContract.COMPARISON]: {
    ssotMode: "none",
    requiresEvidence: true,
    allowsSummary: false,
    requiresCitation: true,
    responseFormat: "structured",
  },
  [AnswerContract.TREND_SUMMARY]: {
    ssotMode: "none",
    requiresEvidence: true,
    allowsSummary: true,
    requiresCitation: true,
    responseFormat: "text",
  },
  [AnswerContract.CROSS_MEETING_QUESTIONS]: {
    ssotMode: "none",
    requiresEvidence: true,
    allowsSummary: false,
    requiresCitation: true,
    responseFormat: "list",
  },
  
  // Descriptive contracts (grounded, non-authoritative)
  [AnswerContract.PRODUCT_EXPLANATION]: {
    ssotMode: "descriptive",
    requiresEvidence: false,
    allowsSummary: true,
    requiresCitation: false,
    responseFormat: "text",
  },
  [AnswerContract.VALUE_PROPOSITION]: {
    ssotMode: "descriptive",
    requiresEvidence: false,
    allowsSummary: true,
    requiresCitation: false,
    responseFormat: "text",
  },
  [AnswerContract.DRAFT_RESPONSE]: {
    ssotMode: "descriptive",
    requiresEvidence: false,
    allowsSummary: true,
    requiresCitation: false,
    responseFormat: "text",
  },
  [AnswerContract.DRAFT_EMAIL]: {
    ssotMode: "descriptive",
    requiresEvidence: false,
    allowsSummary: true,
    requiresCitation: false,
    responseFormat: "text",
  },
  
  // Authoritative contracts (requires Product SSOT)
  [AnswerContract.FEATURE_VERIFICATION]: {
    ssotMode: "authoritative",
    requiresEvidence: true,
    allowsSummary: false,
    requiresCitation: true,
    responseFormat: "text",
  },
  [AnswerContract.FAQ_ANSWER]: {
    ssotMode: "authoritative",
    requiresEvidence: true,
    allowsSummary: false,
    requiresCitation: false,
    responseFormat: "text",
  },
  
  // General/Legacy contracts
  [AnswerContract.PRODUCT_INFO]: {
    ssotMode: "descriptive",
    requiresEvidence: false,
    allowsSummary: true,
    requiresCitation: false,
    responseFormat: "text",
  },
  [AnswerContract.DOCUMENT_ANSWER]: {
    ssotMode: "none",
    requiresEvidence: true,
    allowsSummary: false,
    requiresCitation: true,
    responseFormat: "text",
  },
  [AnswerContract.GENERAL_RESPONSE]: {
    ssotMode: "none",
    requiresEvidence: false,
    allowsSummary: true,
    requiresCitation: false,
    responseFormat: "text",
  },
  [AnswerContract.NOT_FOUND]: {
    ssotMode: "none",
    requiresEvidence: false,
    allowsSummary: false,
    requiresCitation: false,
    responseFormat: "text",
  },
  
  // Terminal contracts
  [AnswerContract.REFUSE]: {
    ssotMode: "none",
    requiresEvidence: false,
    allowsSummary: false,
    requiresCitation: false,
    responseFormat: "text",
  },
  [AnswerContract.CLARIFY]: {
    ssotMode: "none",
    requiresEvidence: false,
    allowsSummary: false,
    requiresCitation: false,
    responseFormat: "text",
  },
};

const SINGLE_MEETING_CONTRACT_KEYWORDS: Record<string, AnswerContract> = {
  "summary": AnswerContract.MEETING_SUMMARY,
  "summarize": AnswerContract.MEETING_SUMMARY,
  "overview": AnswerContract.MEETING_SUMMARY,
  "action items": AnswerContract.NEXT_STEPS,
  "next steps": AnswerContract.NEXT_STEPS,
  "commitments": AnswerContract.NEXT_STEPS,
  "follow up": AnswerContract.NEXT_STEPS,
  "to-do": AnswerContract.NEXT_STEPS,
  "attendees": AnswerContract.ATTENDEES,
  "who was on": AnswerContract.ATTENDEES,
  "who attended": AnswerContract.ATTENDEES,
  "participants": AnswerContract.ATTENDEES,
  "customer questions": AnswerContract.CUSTOMER_QUESTIONS,
  "what did they ask": AnswerContract.CUSTOMER_QUESTIONS,
  "questions asked": AnswerContract.CUSTOMER_QUESTIONS,
  "what questions": AnswerContract.CUSTOMER_QUESTIONS,
  "help me answer": AnswerContract.DRAFT_RESPONSE,
  "draft a response": AnswerContract.DRAFT_RESPONSE,
  "respond to": AnswerContract.DRAFT_RESPONSE,
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
 * Predefined contract chains.
 * 
 * Chains execute contracts in sequence, where each contract
 * can use the output of previous contracts as context.
 * 
 * IMPORTANT: All contracts in a chain must share the same intent and scope.
 * The chain is ordered: Extraction → Analysis → Drafting
 * 
 * Chain naming: {INTENT}_{PRIMARY_CONTRACT}_CHAIN
 */

// SINGLE_MEETING chains - scoped to one meeting
const SINGLE_MEETING_CONTRACT_CHAINS: Record<string, ContractChain> = {
  // Questions + Draft: Extract questions, then draft responses
  // Example: "Help me answer the questions from the ACE meeting"
  QUESTIONS_DRAFT_CHAIN: {
    contracts: [AnswerContract.CUSTOMER_QUESTIONS, AnswerContract.DRAFT_RESPONSE],
    selectionMethod: "keyword",
    primaryContract: AnswerContract.CUSTOMER_QUESTIONS,
  },
};

// MULTI_MEETING chains - scoped across multiple meetings
const MULTI_MEETING_CONTRACT_CHAINS: Record<string, ContractChain> = {
  // Questions + Pattern: Gather questions first, then analyze patterns
  // Example: "What common objections are customers raising about dashboards?"
  QUESTIONS_PATTERN_CHAIN: {
    contracts: [AnswerContract.CROSS_MEETING_QUESTIONS, AnswerContract.PATTERN_ANALYSIS],
    selectionMethod: "keyword",
    primaryContract: AnswerContract.CROSS_MEETING_QUESTIONS,
  },
  
  // Comparison + Trend: Compare meetings, then summarize trends
  // Example: "Compare how concerns have changed over time"
  COMPARISON_TREND_CHAIN: {
    contracts: [AnswerContract.COMPARISON, AnswerContract.TREND_SUMMARY],
    selectionMethod: "keyword",
    primaryContract: AnswerContract.COMPARISON,
  },
  
  // Pattern only (single contract, no chaining)
  PATTERN_SINGLE: {
    contracts: [AnswerContract.PATTERN_ANALYSIS],
    selectionMethod: "keyword",
    primaryContract: AnswerContract.PATTERN_ANALYSIS,
  },
  
  // Trend only (single contract, no chaining)
  TREND_SINGLE: {
    contracts: [AnswerContract.TREND_SUMMARY],
    selectionMethod: "keyword",
    primaryContract: AnswerContract.TREND_SUMMARY,
  },
};

/**
 * Select a contract chain for SINGLE_MEETING queries.
 * 
 * Chains are selected based on the minimum set of tasks required.
 * Example: "Help me answer the questions" → CUSTOMER_QUESTIONS → DRAFT_RESPONSE
 */
export function selectSingleMeetingContractChain(userMessage: string): ContractChain | null {
  const msg = userMessage.toLowerCase();
  
  // Questions + Draft chain: "help me answer questions", "respond to their questions"
  if (/help\s+(me\s+)?(answer|respond|reply)/i.test(msg) && 
      /questions?|concerns|objections/i.test(msg)) {
    return SINGLE_MEETING_CONTRACT_CHAINS.QUESTIONS_DRAFT_CHAIN;
  }
  
  // No chain needed - return null to use single contract selection
  return null;
}

/**
 * Select a contract chain for MULTI_MEETING queries.
 * 
 * Keywords are used to infer the analytical task and determine
 * whether chaining provides value. Chaining is ONLY triggered when:
 * - Explicit conjunction language is present (e.g., "questions and patterns")
 * - Clear compound intent is expressed (e.g., "compare trends over time")
 * 
 * This is task inference within a fixed intent, not intent classification.
 * 
 * IMPORTANT: Chain triggers must be strict to avoid false positives.
 * "common questions" should NOT trigger chaining (no explicit pattern request).
 */
export function selectMultiMeetingContractChain(userMessage: string): ContractChain {
  const msg = userMessage.toLowerCase();
  
  // CHAIN TRIGGERS - Require explicit conjunction or compound language
  
  // Questions + Pattern chain: ONLY with explicit "and" or clear compound request
  // e.g., "questions and patterns", "questions with recurring themes", "what questions and what patterns"
  if (/questions?\s+(and|with)\s+(pattern|theme|recurring)/i.test(msg) ||
      /pattern.*questions?|recurring.*questions?/i.test(msg)) {
    return MULTI_MEETING_CONTRACT_CHAINS.QUESTIONS_PATTERN_CHAIN;
  }
  
  // Comparison + Trend chain: "compare... over time" or "how have differences changed"
  // e.g., "compare how things have changed over time", "differences and trends"
  if (/compare.*over time|comparison.*trend|differences?\s+and\s+trend/i.test(msg) ||
      /how\s+(have|has|did).*differ.*over time/i.test(msg)) {
    return MULTI_MEETING_CONTRACT_CHAINS.COMPARISON_TREND_CHAIN;
  }
  
  // SINGLE CONTRACT FALLBACKS - Default behavior for simple queries
  
  // Trend: explicit time-based analysis
  if (/trend|over time|changing|evolving|growing|declining|progression/i.test(msg)) {
    return MULTI_MEETING_CONTRACT_CHAINS.TREND_SINGLE;
  }
  
  // Questions: customer questions across meetings (includes "common questions")
  if (/questions?|asked|concerns|objections/i.test(msg)) {
    return {
      contracts: [AnswerContract.CROSS_MEETING_QUESTIONS],
      selectionMethod: "keyword",
      primaryContract: AnswerContract.CROSS_MEETING_QUESTIONS,
    };
  }
  
  // Comparison: differences between meetings
  if (/compare|difference|differ|contrast|versus|vs\b/i.test(msg)) {
    return {
      contracts: [AnswerContract.COMPARISON],
      selectionMethod: "keyword",
      primaryContract: AnswerContract.COMPARISON,
    };
  }
  
  // Default to pattern analysis for general cross-meeting queries
  return MULTI_MEETING_CONTRACT_CHAINS.PATTERN_SINGLE;
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

  if (intent === Intent.DOCUMENT_SEARCH) {
    return {
      contract: AnswerContract.DOCUMENT_ANSWER,
      contractSelectionMethod: "default",
      constraints: CONTRACT_CONSTRAINTS[AnswerContract.DOCUMENT_ANSWER],
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
  
  const systemPrompt = `You are selecting an answer contract for a question.

Intent: ${intent}

Available contracts: ${validContracts}

For SINGLE_MEETING intent, prefer:
- MEETING_SUMMARY: when user asks for summary/overview
- NEXT_STEPS: when asking about action items, commitments, follow-ups
- ATTENDEES: when asking who was present
- CUSTOMER_QUESTIONS: when asking what the customer asked
- EXTRACTIVE_FACT: for specific factual questions about the meeting

Respond with JSON: {"contract": "CONTRACT_NAME", "reason": "brief explanation"}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
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
  layers: ContextLayers
): Promise<AnswerContractResult> {
  const keywordResult = selectContractByKeyword(question, intent, layers);
  
  if (keywordResult) {
    console.log(`[AnswerContract] Selected: ${keywordResult.contract} (${keywordResult.contractSelectionMethod})`);
    return keywordResult;
  }

  console.log(`[AnswerContract] No keyword match, using LLM fallback`);
  return selectContractByLLM(question, intent, layers);
}
