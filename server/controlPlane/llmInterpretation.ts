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
  // Smart clarification enhancements
  canPartialAnswer: boolean; // true = we can give a short helpful answer
  partialAnswer?: string; // short answer to provide while clarifying
  questionForm: string; // natural question to ask user (e.g., "Are you asking about...")
};

export type SmartClarification = {
  bestGuess: {
    interpretation: string;
    intent: IntentString;
    contract: ContractString;
    confidence: number;
    questionForm: string;
    partialAnswer?: string;
  };
  alternatives: Array<{
    interpretation: string;
    intent: IntentString;
    contract: ContractString;
    hint?: string;
  }>;
  canPartialAnswer: boolean;
};

export type LLMInterpretationAlternative = {
  intent: IntentString;
  contract: ContractString;
  description: string;
  hint?: string; // Specific examples like "Les Schwab, ACE, etc."
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

function generateSmartClarifyMessage(
  interpretation: LLMInterpretation,
  alternatives: LLMInterpretationAlternative[]
): string {
  const { confidence, questionForm, partialAnswer, canPartialAnswer } = interpretation;
  const hasAlternatives = alternatives.length > 0;
  
  let response = "";
  
  // Lead with the best guess as a natural question
  response += questionForm + "\n\n";
  
  // If we can give a partial answer and confidence is decent, include it
  if (canPartialAnswer && partialAnswer && confidence > 0.5) {
    response += `If so—${partialAnswer}\n\n`;
  }
  
  // Offer specific alternatives if available
  if (hasAlternatives) {
    response += "Or did you mean:\n";
    alternatives.forEach(alt => {
      response += `• ${alt.description}`;
      if (alt.hint) response += ` (${alt.hint})`;
      response += "\n";
    });
    response += "\n";
  }
  
  // Friendly close
  if (hasAlternatives || confidence < 0.8) {
    response += "Just say 'yes' or let me know which!";
  } else {
    response += "Let me know!";
  }
  
  return response.trim();
}

function generateFallbackClarifyMessage(): string {
  return `I want to help but I'm not sure what you're looking for. Are you asking about:

• A customer meeting (which company?)
• PitCrew product info (which feature?)
• Help with a task (what kind?)

Give me a hint and I'll get you sorted!`;
}

export async function interpretAmbiguousQuery(
  question: string,
  failureReason: string
): Promise<ClarifyWithInterpretation> {
  const systemPrompt = `You are a helpful assistant for PitCrew's sales team. Your job is to make smart clarifications that are conversational and helpful—never robotic dead ends.

CONTEXT: PitCrew sells vision AI to automotive service businesses. You have access to:
- Customer meeting data (Les Schwab, ACE, Jiffy Lube, Canadian Tire, etc.)
- Contact information (Tyler Wiggins, Randy, Robert, etc.)
- Product knowledge (features, pricing, integrations)
- General assistance (drafting, summarizing, etc.)

YOUR GOAL: When a request is ambiguous, provide a HELPFUL clarification that:
1. Leads with your best guess as a natural question
2. Offers a short partial answer if possible (so the user gets SOMETHING helpful)
3. Lists specific alternatives (not generic options)
4. Uses friendly, conversational language

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
  "interpretation": "Brief summary of what user likely wants",
  "questionForm": "A natural question to ask the user, e.g., 'Are you asking how camera installation works with PitCrew?'",
  "canPartialAnswer": true/false,
  "partialAnswer": "A short helpful answer IF canPartialAnswer is true. Keep it 1-2 sentences.",
  "alternatives": [
    {
      "intent": "ALTERNATE_INTENT",
      "contract": "ALTERNATE_CONTRACT",
      "description": "Specific alternative in plain language",
      "hint": "Examples like 'Les Schwab, ACE' or 'pricing, features' if relevant"
    }
  ]
}

RULES:
1. "questionForm" should be a natural question leading with the best guess (e.g., "Are you asking about...")
2. "partialAnswer" should give REAL value—not "I can help with that" but actual info
3. For PRODUCT_KNOWLEDGE, you CAN provide partial answers about PitCrew (cameras, pricing model, integrations)
4. Alternatives should be SPECIFIC—not "something else" but concrete options with hints
5. Use contractions (it's, I'll, you're) and conversational tone
6. Never say "I need more context"—always offer a path forward

COMMON PATTERNS:
- "how does X work" → PRODUCT_KNOWLEDGE with partial answer about X
- "what about [company]" → SINGLE_MEETING or MULTI_MEETING depending on context
- "pricing/cost/price" → PRODUCT_KNOWLEDGE with partial pricing model info
- "[company] + [topic]" → SINGLE_MEETING with company-specific search

EXAMPLES:

User: "how does the cameras installation work?"
Response: {
  "proposedIntent": "PRODUCT_KNOWLEDGE",
  "proposedContract": "PRODUCT_EXPLANATION",
  "confidence": 0.7,
  "interpretation": "how PitCrew camera installation works",
  "questionForm": "Are you asking how camera installation works with PitCrew?",
  "canPartialAnswer": true,
  "partialAnswer": "Cameras are typically mounted in service bays pointing at the work area. Your IT team or ours handles physical install; PitCrew then connects to the feeds over your network. I can go deeper on any part.",
  "alternatives": [
    {
      "intent": "SINGLE_MEETING",
      "contract": "EXTRACTIVE_FACT",
      "description": "A specific customer's installation experience",
      "hint": "Les Schwab, ACE, etc."
    },
    {
      "intent": "PRODUCT_KNOWLEDGE",
      "contract": "FAQ_ANSWER",
      "description": "Technical requirements for your own deployment",
      "hint": "network specs, camera specs"
    }
  ]
}

User: "what's the deal with Canadian Tire?"
Response: {
  "proposedIntent": "SINGLE_MEETING",
  "proposedContract": "MEETING_SUMMARY",
  "confidence": 0.6,
  "interpretation": "summary of Canadian Tire meetings",
  "questionForm": "Are you looking for a summary of our Canadian Tire meetings?",
  "canPartialAnswer": false,
  "partialAnswer": "",
  "alternatives": [
    {
      "intent": "SINGLE_MEETING",
      "contract": "NEXT_STEPS",
      "description": "Their pilot status and next steps",
      "hint": ""
    },
    {
      "intent": "SINGLE_MEETING",
      "contract": "EXTRACTIVE_FACT",
      "description": "Something specific they discussed",
      "hint": "pricing, integration, concerns"
    }
  ]
}

User: "can you help me with the pricing stuff?"
Response: {
  "proposedIntent": "PRODUCT_KNOWLEDGE",
  "proposedContract": "FAQ_ANSWER",
  "confidence": 0.5,
  "interpretation": "PitCrew pricing information",
  "questionForm": "Happy to help with pricing! Are you looking for:",
  "canPartialAnswer": false,
  "partialAnswer": "",
  "alternatives": [
    {
      "intent": "PRODUCT_KNOWLEDGE",
      "contract": "PRODUCT_EXPLANATION",
      "description": "PitCrew's pricing model",
      "hint": "I can outline the general structure"
    },
    {
      "intent": "MULTI_MEETING",
      "contract": "CROSS_MEETING_QUESTIONS",
      "description": "What customers have asked about pricing",
      "hint": ""
    },
    {
      "intent": "GENERAL_HELP",
      "contract": "DRAFT_RESPONSE",
      "description": "Help structuring a quote or proposal",
      "hint": ""
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
      questionForm?: string;
      canPartialAnswer?: boolean;
      partialAnswer?: string;
      alternatives?: Array<{
        intent: string;
        contract: string;
        description: string;
        hint?: string;
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
    const questionForm = parsed.questionForm || `Are you asking about ${interpretation}?`;
    const canPartialAnswer = parsed.canPartialAnswer ?? false;
    const partialAnswer = parsed.partialAnswer || undefined;

    const alternatives: LLMInterpretationAlternative[] = (parsed.alternatives || [])
      .slice(0, 3) // Allow up to 3 alternatives for better UX
      .map(alt => ({
        intent: (isValidIntent(alt.intent) ? alt.intent : "GENERAL_HELP") as IntentString,
        contract: (isValidContract(alt.contract) ? alt.contract : "GENERAL_RESPONSE") as ContractString,
        description: alt.description,
        hint: alt.hint || undefined,
      }))
      .filter(alt => alt.intent !== proposedIntent || alt.contract !== proposedContract);

    const llmInterpretation: LLMInterpretation = {
      proposedIntent,
      proposedContract,
      confidence,
      interpretation,
      alternatives: alternatives.length > 0 ? alternatives : undefined,
      canPartialAnswer,
      partialAnswer,
      questionForm,
    };

    const message = generateSmartClarifyMessage(llmInterpretation, alternatives);

    console.log(`[LLMInterpretation] Interpretation: intent=${proposedIntent}, contract=${proposedContract}, confidence=${confidence}, reason=${failureReason}`);

    return {
      outcome: "CLARIFY",
      proposedInterpretation: {
        intent: proposedIntent,
        contract: proposedContract,
        summary: interpretation,
      },
      alternatives: alternatives.length > 0 ? alternatives : undefined,
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
    message: generateFallbackClarifyMessage(),
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
