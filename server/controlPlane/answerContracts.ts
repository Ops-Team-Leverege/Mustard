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
  // Extractive contracts (SSOT mode: none)
  MEETING_SUMMARY = "MEETING_SUMMARY",
  NEXT_STEPS = "NEXT_STEPS",
  ATTENDEES = "ATTENDEES",
  CUSTOMER_QUESTIONS = "CUSTOMER_QUESTIONS",
  EXTRACTIVE_FACT = "EXTRACTIVE_FACT",
  AGGREGATIVE_LIST = "AGGREGATIVE_LIST",
  
  // Descriptive contracts (SSOT mode: descriptive)
  PRODUCT_EXPLANATION = "PRODUCT_EXPLANATION",
  VALUE_PROPOSITION = "VALUE_PROPOSITION",
  DRAFT_RESPONSE = "DRAFT_RESPONSE",
  DRAFT_EMAIL = "DRAFT_EMAIL",
  
  // Authoritative contracts (SSOT mode: authoritative)
  FEATURE_VERIFICATION = "FEATURE_VERIFICATION",
  FAQ_ANSWER = "FAQ_ANSWER",
  
  // General contracts
  DOCUMENT_ANSWER = "DOCUMENT_ANSWER",
  GENERAL_RESPONSE = "GENERAL_RESPONSE",
  NOT_FOUND = "NOT_FOUND",
  
  // Terminal contracts
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
      contract: AnswerContract.AGGREGATIVE_LIST,
      contractSelectionMethod: "default",
      constraints: CONTRACT_CONSTRAINTS[AnswerContract.AGGREGATIVE_LIST],
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
