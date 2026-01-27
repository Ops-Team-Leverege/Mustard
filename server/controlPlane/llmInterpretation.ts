/**
 * LLM-Assisted Semantic Interpretation (Clarification Only)
 * 
 * Purpose:
 * Handle ambiguous or unmatched user input by proposing interpretations
 * and routing to CLARIFY - never by executing actions directly.
 * 
 * Core Invariant (Non-Negotiable):
 * LLMs may help the system understand language.
 * They may NEVER decide what the system does.
 * 
 * Invocation Rules:
 * - Only invoked when deterministic classification FAILS or is AMBIGUOUS
 * - Never invoked when a single intent is confidently matched
 * - Never invoked when a valid contract chain is already selected
 * 
 * Output Handling:
 * - ≥0.9 confidence: CLARIFY with single proposed interpretation
 * - 0.7-0.9 confidence: CLARIFY with 1-2 proposed options
 * - <0.7 confidence: CLARIFY asking for more detail with best guess
 * 
 * At NO confidence level may execution proceed automatically.
 */

import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export type IntentString = 
  | "SINGLE_MEETING" 
  | "MULTI_MEETING" 
  | "PRODUCT_KNOWLEDGE" 
  | "DOCUMENT_SEARCH" 
  | "GENERAL_HELP" 
  | "REFUSE" 
  | "CLARIFY";

export type ContractString = 
  | "MEETING_SUMMARY" | "NEXT_STEPS" | "ATTENDEES" | "CUSTOMER_QUESTIONS" | "EXTRACTIVE_FACT" | "AGGREGATIVE_LIST"
  | "PATTERN_ANALYSIS" | "COMPARISON" | "TREND_SUMMARY" | "CROSS_MEETING_QUESTIONS"
  | "PRODUCT_EXPLANATION" | "FEATURE_VERIFICATION" | "FAQ_ANSWER"
  | "DOCUMENT_ANSWER" | "GENERAL_RESPONSE" | "DRAFT_RESPONSE" | "DRAFT_EMAIL" | "VALUE_PROPOSITION"
  | "REFUSE" | "CLARIFY";

export type LLMInterpretation = {
  proposedIntent: IntentString;
  proposedContract: ContractString;
  confidence: number; // 0.0 – 1.0
  interpretation: string; // human-readable summary
  alternatives?: LLMInterpretationAlternative[];
};

export type LLMInterpretationAlternative = {
  intent: IntentString;
  contract: ContractString;
  description: string;
};

export type InterpretationMetadata = {
  proposedIntent: IntentString;
  proposedContract: ContractString;
  confidence: number;
  failureReason: string;
  interpretationSource: "llm_fallback" | "ambiguity_resolution";
};

export type ClarifyWithInterpretation = {
  outcome: "CLARIFY";
  proposedInterpretation: {
    intent: IntentString;
    contract: ContractString;
    summary: string;
  };
  alternatives?: LLMInterpretationAlternative[];
  message: string;
  metadata: InterpretationMetadata;
};

const INTENT_CONTRACT_MAPPING: Record<IntentString, ContractString[]> = {
  "SINGLE_MEETING": ["MEETING_SUMMARY", "NEXT_STEPS", "ATTENDEES", "CUSTOMER_QUESTIONS", "EXTRACTIVE_FACT", "AGGREGATIVE_LIST"],
  "MULTI_MEETING": ["PATTERN_ANALYSIS", "COMPARISON", "TREND_SUMMARY", "CROSS_MEETING_QUESTIONS"],
  "PRODUCT_KNOWLEDGE": ["PRODUCT_EXPLANATION", "FEATURE_VERIFICATION", "FAQ_ANSWER"],
  "DOCUMENT_SEARCH": ["DOCUMENT_ANSWER"],
  "GENERAL_HELP": ["GENERAL_RESPONSE", "DRAFT_RESPONSE", "DRAFT_EMAIL", "VALUE_PROPOSITION"],
  "REFUSE": ["REFUSE"],
  "CLARIFY": ["CLARIFY"],
};

const VALID_INTENTS: IntentString[] = ["SINGLE_MEETING", "MULTI_MEETING", "PRODUCT_KNOWLEDGE", "DOCUMENT_SEARCH", "GENERAL_HELP", "REFUSE", "CLARIFY"];

const VALID_CONTRACTS: ContractString[] = [
  "MEETING_SUMMARY", "NEXT_STEPS", "ATTENDEES", "CUSTOMER_QUESTIONS", "EXTRACTIVE_FACT", "AGGREGATIVE_LIST",
  "PATTERN_ANALYSIS", "COMPARISON", "TREND_SUMMARY", "CROSS_MEETING_QUESTIONS",
  "PRODUCT_EXPLANATION", "FEATURE_VERIFICATION", "FAQ_ANSWER",
  "DOCUMENT_ANSWER", "GENERAL_RESPONSE", "DRAFT_RESPONSE", "DRAFT_EMAIL", "VALUE_PROPOSITION",
  "REFUSE", "CLARIFY"
];

function isValidIntent(s: string): s is IntentString {
  return VALID_INTENTS.includes(s as IntentString);
}

function isValidContract(s: string): s is ContractString {
  return VALID_CONTRACTS.includes(s as ContractString);
}

function getDefaultContractForIntent(intent: IntentString): ContractString {
  const contracts = INTENT_CONTRACT_MAPPING[intent];
  return contracts?.[0] ?? "GENERAL_RESPONSE";
}

function generateClarifyMessage(
  interpretation: LLMInterpretation,
  hasAlternatives: boolean
): string {
  const { confidence, interpretation: summary } = interpretation;
  
  if (confidence >= 0.9) {
    return `I think I understand what you're looking for. ${summary} Is that what you had in mind?`;
  }
  
  if (confidence >= 0.7) {
    if (hasAlternatives) {
      return `I want to make sure I help you correctly. ${summary} Or were you looking for something else?`;
    }
    return `It sounds like ${summary.toLowerCase()} – is that right?`;
  }
  
  return `I'd like to help, but I want to make sure I understand. Could you tell me a bit more about what you're looking for? My best guess is that ${summary.toLowerCase()}`;
}

export async function interpretAmbiguousQuery(
  question: string,
  failureReason: string
): Promise<ClarifyWithInterpretation> {
  const systemPrompt = `You are a semantic interpreter for PitCrew's sales assistant.

CONTEXT: PitCrew sells vision AI to automotive service businesses. The system handles:
- Customer meeting data (Les Schwab, ACE, Jiffy Lube, etc.)
- Contact information (Tyler Wiggins, Randy, Robert, etc.)
- Product knowledge (features, pricing, integrations)
- General assistance (drafting, summarizing, etc.)

YOUR ROLE: Interpret what the user LIKELY wants and express it in plain language.
You are NOT deciding what happens - you are helping understand the request.

VALID INTENTS:
- SINGLE_MEETING: Questions about a specific meeting or conversation
- MULTI_MEETING: Questions across multiple meetings (trends, patterns)
- PRODUCT_KNOWLEDGE: Questions about PitCrew product capabilities
- DOCUMENT_SEARCH: Looking for specific documents
- GENERAL_HELP: Drafting, writing, general assistance
- REFUSE: Clearly out-of-scope requests

VALID CONTRACTS per intent:
- SINGLE_MEETING: MEETING_SUMMARY, NEXT_STEPS, ATTENDEES, CUSTOMER_QUESTIONS, EXTRACTIVE_FACT, AGGREGATIVE_LIST
- MULTI_MEETING: PATTERN_ANALYSIS, COMPARISON, TREND_SUMMARY, CROSS_MEETING_QUESTIONS
- PRODUCT_KNOWLEDGE: PRODUCT_EXPLANATION, FEATURE_VERIFICATION, FAQ_ANSWER
- GENERAL_HELP: GENERAL_RESPONSE, DRAFT_RESPONSE, DRAFT_EMAIL, VALUE_PROPOSITION

RESPONSE FORMAT (JSON):
{
  "proposedIntent": "INTENT_NAME",
  "proposedContract": "CONTRACT_NAME",
  "confidence": 0.0-1.0,
  "interpretation": "A natural language summary of what the user likely wants",
  "alternatives": [
    {
      "intent": "ALTERNATE_INTENT",
      "contract": "ALTERNATE_CONTRACT",
      "description": "Alternative interpretation in plain language"
    }
  ]
}

RULES:
1. The "interpretation" field must be a natural, conversational summary
2. Do NOT use technical terms like "contract" or "intent" in the interpretation
3. Provide 1-2 alternatives if confidence is below 0.9
4. Only provide alternatives if they are meaningfully different
5. Confidence should reflect how sure you are about the interpretation

EXAMPLES:
User: "tyler schwab"
Response: {
  "proposedIntent": "SINGLE_MEETING",
  "proposedContract": "MEETING_SUMMARY",
  "confidence": 0.6,
  "interpretation": "you're asking about a meeting with someone named Tyler or a company like Les Schwab",
  "alternatives": [
    {
      "intent": "MULTI_MEETING",
      "contract": "CROSS_MEETING_QUESTIONS",
      "description": "you want to find all meetings mentioning Tyler or Schwab"
    }
  ]
}

User: "help with pricing response"
Response: {
  "proposedIntent": "GENERAL_HELP",
  "proposedContract": "DRAFT_RESPONSE",
  "confidence": 0.8,
  "interpretation": "you want help drafting a response about pricing",
  "alternatives": [
    {
      "intent": "PRODUCT_KNOWLEDGE",
      "contract": "FAQ_ANSWER",
      "description": "you have a question about PitCrew's pricing"
    }
  ]
}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.warn("[LLMInterpretation] Empty response from LLM");
      return createFallbackClarify(question, failureReason);
    }

    const parsed = JSON.parse(content) as {
      proposedIntent: string;
      proposedContract: string;
      confidence: number;
      interpretation: string;
      alternatives?: Array<{
        intent: string;
        contract: string;
        description: string;
      }>;
    };

    const proposedIntent: IntentString = isValidIntent(parsed.proposedIntent) 
      ? parsed.proposedIntent 
      : "GENERAL_HELP";
    const proposedContract: ContractString = isValidContract(parsed.proposedContract)
      ? parsed.proposedContract
      : getDefaultContractForIntent(proposedIntent);
    const confidence = Math.max(0, Math.min(1, parsed.confidence ?? 0.5));
    const interpretation = parsed.interpretation || "you have a question I'd like to help with";

    const alternatives: LLMInterpretationAlternative[] = (parsed.alternatives || [])
      .slice(0, 2)
      .map(alt => ({
        intent: (isValidIntent(alt.intent) ? alt.intent : "GENERAL_HELP") as IntentString,
        contract: (isValidContract(alt.contract) ? alt.contract : "GENERAL_RESPONSE") as ContractString,
        description: alt.description,
      }))
      .filter(alt => alt.intent !== proposedIntent);

    const llmInterpretation: LLMInterpretation = {
      proposedIntent,
      proposedContract,
      confidence,
      interpretation,
      alternatives: alternatives.length > 0 ? alternatives : undefined,
    };

    const hasAlternatives = alternatives.length > 0 && confidence < 0.9;
    const message = generateClarifyMessage(llmInterpretation, hasAlternatives);

    console.log(`[LLMInterpretation] Interpretation: intent=${proposedIntent}, contract=${proposedContract}, confidence=${confidence}, reason=${failureReason}`);

    return {
      outcome: "CLARIFY",
      proposedInterpretation: {
        intent: proposedIntent,
        contract: proposedContract,
        summary: interpretation,
      },
      alternatives: hasAlternatives ? alternatives : undefined,
      message,
      metadata: {
        proposedIntent,
        proposedContract,
        confidence,
        failureReason,
        interpretationSource: "llm_fallback",
      },
    };
  } catch (error) {
    console.error("[LLMInterpretation] Error:", error);
    return createFallbackClarify(question, failureReason);
  }
}

function createFallbackClarify(_question: string, failureReason: string): ClarifyWithInterpretation {
  return {
    outcome: "CLARIFY",
    proposedInterpretation: {
      intent: "GENERAL_HELP",
      contract: "GENERAL_RESPONSE",
      summary: "you have a question I'd like to help with",
    },
    message: "I'd like to help, but I want to make sure I understand. Could you tell me a bit more about what you're looking for?",
    metadata: {
      proposedIntent: "GENERAL_HELP",
      proposedContract: "GENERAL_RESPONSE",
      confidence: 0,
      failureReason,
      interpretationSource: "llm_fallback",
    },
  };
}

export type InterpretationInvocationReason = 
  | "no_intent_match"
  | "multi_intent_ambiguity"
  | "low_confidence_match";

export function shouldInvokeLLMInterpretation(
  hasKeywordMatch: boolean,
  hasMultiIntentAmbiguity: boolean,
  keywordConfidence: number | null
): { shouldInvoke: boolean; reason: InterpretationInvocationReason | null } {
  if (!hasKeywordMatch) {
    return { shouldInvoke: true, reason: "no_intent_match" };
  }
  
  if (hasMultiIntentAmbiguity) {
    return { shouldInvoke: true, reason: "multi_intent_ambiguity" };
  }
  
  if (keywordConfidence !== null && keywordConfidence < 0.7) {
    return { shouldInvoke: true, reason: "low_confidence_match" };
  }
  
  return { shouldInvoke: false, reason: null };
}
