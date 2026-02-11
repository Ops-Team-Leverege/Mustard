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
import { MODEL_ASSIGNMENTS } from "../config/models";
import { 
  buildIntentValidationPrompt, 
  AMBIGUOUS_QUERY_INTERPRETATION_PROMPT,
  FALLBACK_CLARIFY_MESSAGE 
} from "../config/prompts";
import { getIntentContractMapping } from "../config/capabilities";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export type IntentString = 
  | "SINGLE_MEETING" 
  | "MULTI_MEETING" 
  | "PRODUCT_KNOWLEDGE" 
  | "EXTERNAL_RESEARCH"
  | "GENERAL_HELP" 
  | "REFUSE" 
  | "CLARIFY";

export type ContractString = 
  | "MEETING_SUMMARY" | "NEXT_STEPS" | "ATTENDEES" | "CUSTOMER_QUESTIONS" | "EXTRACTIVE_FACT" | "AGGREGATIVE_LIST"
  | "PATTERN_ANALYSIS" | "COMPARISON" | "TREND_SUMMARY" | "CROSS_MEETING_QUESTIONS"
  | "PRODUCT_EXPLANATION" | "FEATURE_VERIFICATION" | "FAQ_ANSWER"
  | "EXTERNAL_RESEARCH" | "SALES_DOCS_PREP"
  | "GENERAL_RESPONSE" | "DRAFT_RESPONSE" | "DRAFT_EMAIL" | "VALUE_PROPOSITION"
  | "PRODUCT_KNOWLEDGE_ENRICH" | "STYLE_MATCH_WRITE" | "SEMANTIC_TRANSCRIPT_ANALYSIS"
  | "REFUSE" | "CLARIFY";

export type LLMInterpretation = {
  proposedIntent: IntentString;
  // Note: contracts are in proposedInterpretation.contracts (single source of truth)
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
    contracts: ContractString[];  // Ordered array for contract chain
    confidence: number;
    questionForm: string;
    partialAnswer?: string;
  };
  alternatives: Array<{
    interpretation: string;
    intent: IntentString;
    contracts: ContractString[];  // Ordered array for contract chain
    hint?: string;
  }>;
  canPartialAnswer: boolean;
};

export type LLMInterpretationAlternative = {
  intent: IntentString;
  contracts: ContractString[];  // Ordered array for contract chain
  description: string;
  hint?: string; // Specific examples like "Les Schwab, ACE, etc."
};

export type InterpretationMetadata = {
  proposedIntent: IntentString;
  // Note: contracts are in proposedInterpretation.contracts (single source of truth)
  confidence: number;
  failureReason: string;
  interpretationSource: "llm_fallback" | "ambiguity_resolution";
};

export type ClarifyWithInterpretation = {
  outcome: "CLARIFY";
  proposedInterpretation: {
    intent: IntentString;
    contracts: ContractString[];  // Ordered array for contract chain
    summary: string;
  };
  alternatives?: LLMInterpretationAlternative[];
  message: string;
  metadata: InterpretationMetadata;
};

const INTENT_CONTRACT_MAPPING = getIntentContractMapping() as Record<IntentString, ContractString[]>;

const VALID_INTENTS: IntentString[] = ["SINGLE_MEETING", "MULTI_MEETING", "PRODUCT_KNOWLEDGE", "EXTERNAL_RESEARCH", "GENERAL_HELP", "REFUSE", "CLARIFY"];

const VALID_CONTRACTS: ContractString[] = [
  "MEETING_SUMMARY", "NEXT_STEPS", "ATTENDEES", "CUSTOMER_QUESTIONS", "EXTRACTIVE_FACT", "AGGREGATIVE_LIST",
  "PATTERN_ANALYSIS", "COMPARISON", "TREND_SUMMARY", "CROSS_MEETING_QUESTIONS",
  "PRODUCT_EXPLANATION", "FEATURE_VERIFICATION", "FAQ_ANSWER",
  "EXTERNAL_RESEARCH", "SALES_DOCS_PREP",
  "GENERAL_RESPONSE", "DRAFT_RESPONSE", "DRAFT_EMAIL", "VALUE_PROPOSITION",
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
  
  // Offer specific alternatives if available (numbered so user can reply with a number)
  if (hasAlternatives) {
    response += "Or did you mean:\n";
    alternatives.forEach((alt, index) => {
      response += `${index + 1}. ${alt.description}`;
      if (alt.hint) response += ` (${alt.hint})`;
      response += "\n";
    });
    response += "\n";
  }
  
  // Friendly close with clear instructions
  if (hasAlternatives) {
    response += "Reply with a number or describe what you need!";
  } else if (confidence < 0.8) {
    response += "Let me know if that's right, or tell me more!";
  } else {
    response += "Let me know!";
  }
  
  return response.trim();
}

function generateFallbackClarifyMessage(): string {
  return FALLBACK_CLARIFY_MESSAGE;
}

export type IntentValidationResult = {
  confirmed: boolean;
  suggestedIntent?: IntentString;
  suggestedContract?: ContractString;
  confidence: number;
  reason: string;
};

/**
 * LLM Validation for Low-Confidence Matches
 * 
 * Purpose:
 * When the deterministic classifier matches but with low confidence (single signal,
 * keyword-only match), validate semantically with LLM before executing.
 * 
 * Behavior:
 * - If LLM confirms the deterministic match → return confirmed: true
 * - If LLM suggests a different intent → return confirmed: false with suggestion
 * - On error → default to confirmed: true (fail-open to avoid blocking)
 * 
 * This does NOT ask the user - it's a semantic validation layer.
 */
export async function validateLowConfidenceIntent(
  question: string,
  deterministicIntent: IntentString,
  deterministicReason: string,
  matchedSignals: string[]
): Promise<IntentValidationResult> {
  const systemPrompt = buildIntentValidationPrompt(deterministicIntent, deterministicReason, matchedSignals);

  try {
    const response = await openai.chat.completions.create({
      model: MODEL_ASSIGNMENTS.LLM_INTERPRETATION,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `User question: "${question}"` },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.warn("[LLMValidation] Empty response, defaulting to confirmed");
      return { confirmed: true, confidence: 0.5, reason: "LLM returned empty response" };
    }

    const parsed = JSON.parse(content);
    console.log(`[LLMValidation] Result: confirmed=${parsed.confirmed}, reason="${parsed.reason}"`);

    // Validate suggestedIntent if provided
    if (!parsed.confirmed && parsed.suggestedIntent && !isValidIntent(parsed.suggestedIntent)) {
      console.warn(`[LLMValidation] Invalid suggested intent: ${parsed.suggestedIntent}, defaulting to confirmed`);
      return { confirmed: true, confidence: 0.5, reason: "LLM suggested invalid intent" };
    }

    return {
      confirmed: parsed.confirmed ?? true,
      suggestedIntent: parsed.suggestedIntent,
      suggestedContract: parsed.suggestedContract,
      confidence: parsed.confidence ?? 0.7,
      reason: parsed.reason ?? "No reason provided",
    };
  } catch (error) {
    console.error("[LLMValidation] Error:", error);
    // Fail-open: if validation fails, trust the deterministic classifier
    return { confirmed: true, confidence: 0.5, reason: "LLM validation error, defaulting to confirmed" };
  }
}

export type ThreadContext = {
  messages: Array<{
    text: string;
    isBot: boolean;
  }>;
};

export async function interpretAmbiguousQuery(
  question: string,
  failureReason: string,
  threadContext?: ThreadContext
): Promise<ClarifyWithInterpretation> {
  try {
    // Build messages array with thread context if available
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: AMBIGUOUS_QUERY_INTERPRETATION_PROMPT },
    ];
    
    // Include thread history for context (skip the current message, it's added last)
    if (threadContext?.messages && threadContext.messages.length > 1) {
      const historyMessages = threadContext.messages.slice(0, -1); // Exclude current message
      for (const msg of historyMessages) {
        messages.push({
          role: msg.isBot ? "assistant" : "user",
          content: msg.text,
        });
      }
      console.log(`[LLMInterpretation] Including ${historyMessages.length} messages from thread history`);
    }
    
    // Add current question
    messages.push({ role: "user", content: question });
    
    const response = await openai.chat.completions.create({
      model: MODEL_ASSIGNMENTS.LLM_INTERPRETATION,
      messages,
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
      proposedContract?: string;           // Legacy: single contract
      proposedContracts?: string[];        // New: contract array
      confidence: number;
      interpretation: string;
      questionForm?: string;
      canPartialAnswer?: boolean;
      partialAnswer?: string;
      alternatives?: Array<{
        intent: string;
        contract?: string;                 // Legacy: single contract
        contracts?: string[];              // New: contract array
        description: string;
        hint?: string;
      }>;
    };

    const proposedIntent: IntentString = isValidIntent(parsed.proposedIntent) 
      ? parsed.proposedIntent 
      : "GENERAL_HELP";
    
    // Handle both legacy single contract and new contract array format
    const rawContracts = parsed.proposedContracts || 
      (parsed.proposedContract ? [parsed.proposedContract] : []);
    const proposedContracts: ContractString[] = rawContracts
      .filter(c => isValidContract(c))
      .map(c => c as ContractString);
    if (proposedContracts.length === 0) {
      proposedContracts.push(getDefaultContractForIntent(proposedIntent));
    }
    
    const confidence = Math.max(0, Math.min(1, parsed.confidence ?? 0.5));
    const interpretation = parsed.interpretation || "you have a question I'd like to help with";
    const questionForm = parsed.questionForm || `Are you asking about ${interpretation}?`;
    const canPartialAnswer = parsed.canPartialAnswer ?? false;
    const partialAnswer = parsed.partialAnswer || undefined;

    const alternatives: LLMInterpretationAlternative[] = (parsed.alternatives || [])
      .slice(0, 3) // Allow up to 3 alternatives for better UX
      .map(alt => {
        // Handle both legacy single contract and new contract array format
        const altRawContracts = alt.contracts || (alt.contract ? [alt.contract] : []);
        const altContracts: ContractString[] = altRawContracts
          .filter(c => isValidContract(c))
          .map(c => c as ContractString);
        if (altContracts.length === 0) {
          altContracts.push("GENERAL_RESPONSE");
        }
        return {
          intent: (isValidIntent(alt.intent) ? alt.intent : "GENERAL_HELP") as IntentString,
          contracts: altContracts,
          description: alt.description,
          hint: alt.hint || undefined,
        };
      })
      .filter(alt => alt.intent !== proposedIntent || JSON.stringify(alt.contracts) !== JSON.stringify(proposedContracts));

    const llmInterpretation: LLMInterpretation = {
      proposedIntent,
      confidence,
      interpretation,
      alternatives: alternatives.length > 0 ? alternatives : undefined,
      canPartialAnswer,
      partialAnswer,
      questionForm,
    };

    const message = generateSmartClarifyMessage(llmInterpretation, alternatives);

    console.log(`[LLMInterpretation] Interpretation: intent=${proposedIntent}, contracts=[${proposedContracts.join(" → ")}], confidence=${confidence}, reason=${failureReason}`);

    return {
      outcome: "CLARIFY",
      proposedInterpretation: {
        intent: proposedIntent,
        contracts: proposedContracts,
        summary: interpretation,
      },
      alternatives: alternatives.length > 0 ? alternatives : undefined,
      message,
      metadata: {
        proposedIntent,
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
      contracts: ["GENERAL_RESPONSE"],
      summary: "you have a question I'd like to help with",
    },
    message: generateFallbackClarifyMessage(),
    metadata: {
      proposedIntent: "GENERAL_HELP",
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
