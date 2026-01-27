/**
 * Answer Contracts System (v2)
 * 
 * Purpose:
 * Answer contracts determine response shape, authority level, and constraints.
 * Selected AFTER context layers are determined.
 * Contracts must never alter context layers or intent.
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
 * 1. Deterministic matching first (keyword patterns)
 * 2. LLM fallback only if ambiguous
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

// MULTI_MEETING contracts - different scope size, same contract structure
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

export function getContractConstraints(contract: AnswerContract): AnswerContractConstraints {
  return CONTRACT_CONSTRAINTS[contract];
}
