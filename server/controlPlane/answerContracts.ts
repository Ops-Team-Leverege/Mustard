/**
 * Answer Contracts System
 * 
 * Purpose:
 * Answer contracts determine response shape and constraints.
 * Selected AFTER context layers are determined.
 * Contracts must never alter context layers or intent.
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

export enum AnswerContract {
  MEETING_SUMMARY = "MEETING_SUMMARY",
  NEXT_STEPS = "NEXT_STEPS",
  ATTENDEES = "ATTENDEES",
  CUSTOMER_QUESTIONS = "CUSTOMER_QUESTIONS",
  EXTRACTIVE_FACT = "EXTRACTIVE_FACT",
  AGGREGATIVE_LIST = "AGGREGATIVE_LIST",
  PRODUCT_INFO = "PRODUCT_INFO",
  DOCUMENT_ANSWER = "DOCUMENT_ANSWER",
  GENERAL_RESPONSE = "GENERAL_RESPONSE",
  NOT_FOUND = "NOT_FOUND",
}

export type ContractSelectionMethod = "keyword" | "llm" | "default";

export type AnswerContractResult = {
  contract: AnswerContract;
  contractSelectionMethod: ContractSelectionMethod;
  constraints: AnswerContractConstraints;
};

export type AnswerContractConstraints = {
  requiresEvidence: boolean;
  maxLength?: number;
  allowsSummary: boolean;
  requiresCitation: boolean;
  responseFormat: "text" | "list" | "structured";
};

const CONTRACT_CONSTRAINTS: Record<AnswerContract, AnswerContractConstraints> = {
  [AnswerContract.MEETING_SUMMARY]: {
    requiresEvidence: false,
    allowsSummary: true,
    requiresCitation: false,
    responseFormat: "text",
  },
  [AnswerContract.NEXT_STEPS]: {
    requiresEvidence: true,
    allowsSummary: false,
    requiresCitation: true,
    responseFormat: "list",
  },
  [AnswerContract.ATTENDEES]: {
    requiresEvidence: false,
    allowsSummary: false,
    requiresCitation: false,
    responseFormat: "list",
  },
  [AnswerContract.CUSTOMER_QUESTIONS]: {
    requiresEvidence: true,
    allowsSummary: false,
    requiresCitation: true,
    responseFormat: "list",
  },
  [AnswerContract.EXTRACTIVE_FACT]: {
    requiresEvidence: true,
    allowsSummary: false,
    requiresCitation: true,
    responseFormat: "text",
  },
  [AnswerContract.AGGREGATIVE_LIST]: {
    requiresEvidence: true,
    allowsSummary: false,
    requiresCitation: false,
    responseFormat: "list",
  },
  [AnswerContract.PRODUCT_INFO]: {
    requiresEvidence: false,
    allowsSummary: true,
    requiresCitation: false,
    responseFormat: "text",
  },
  [AnswerContract.DOCUMENT_ANSWER]: {
    requiresEvidence: true,
    allowsSummary: false,
    requiresCitation: true,
    responseFormat: "text",
  },
  [AnswerContract.GENERAL_RESPONSE]: {
    requiresEvidence: false,
    allowsSummary: true,
    requiresCitation: false,
    responseFormat: "text",
  },
  [AnswerContract.NOT_FOUND]: {
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
};

function selectContractByKeyword(
  question: string,
  intent: Intent,
  _layers: ContextLayers
): AnswerContractResult | null {
  const lower = question.toLowerCase();

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
    return {
      contract: AnswerContract.AGGREGATIVE_LIST,
      contractSelectionMethod: "default",
      constraints: CONTRACT_CONSTRAINTS[AnswerContract.AGGREGATIVE_LIST],
    };
  }

  if (intent === Intent.PRODUCT_KNOWLEDGE) {
    return {
      contract: AnswerContract.PRODUCT_INFO,
      contractSelectionMethod: "default",
      constraints: CONTRACT_CONSTRAINTS[AnswerContract.PRODUCT_INFO],
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
