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

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export type IntentString = 
  | "SINGLE_MEETING" 
  | "MULTI_MEETING" 
  | "PRODUCT_KNOWLEDGE" 
  | "EXTERNAL_RESEARCH"
  | "DOCUMENT_SEARCH" 
  | "GENERAL_HELP" 
  | "REFUSE" 
  | "CLARIFY";

export type ContractString = 
  | "MEETING_SUMMARY" | "NEXT_STEPS" | "ATTENDEES" | "CUSTOMER_QUESTIONS" | "EXTRACTIVE_FACT" | "AGGREGATIVE_LIST"
  | "PATTERN_ANALYSIS" | "COMPARISON" | "TREND_SUMMARY" | "CROSS_MEETING_QUESTIONS"
  | "PRODUCT_EXPLANATION" | "FEATURE_VERIFICATION" | "FAQ_ANSWER"
  | "EXTERNAL_RESEARCH" | "SALES_DOCS_PREP"
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
  "EXTERNAL_RESEARCH": ["EXTERNAL_RESEARCH", "SALES_DOCS_PREP", "VALUE_PROPOSITION"],
  "DOCUMENT_SEARCH": ["DOCUMENT_ANSWER"],
  "GENERAL_HELP": ["GENERAL_RESPONSE", "DRAFT_RESPONSE", "DRAFT_EMAIL", "VALUE_PROPOSITION"],
  "REFUSE": ["REFUSE"],
  "CLARIFY": ["CLARIFY"],
};

const VALID_INTENTS: IntentString[] = ["SINGLE_MEETING", "MULTI_MEETING", "PRODUCT_KNOWLEDGE", "EXTERNAL_RESEARCH", "DOCUMENT_SEARCH", "GENERAL_HELP", "REFUSE", "CLARIFY"];

const VALID_CONTRACTS: ContractString[] = [
  "MEETING_SUMMARY", "NEXT_STEPS", "ATTENDEES", "CUSTOMER_QUESTIONS", "EXTRACTIVE_FACT", "AGGREGATIVE_LIST",
  "PATTERN_ANALYSIS", "COMPARISON", "TREND_SUMMARY", "CROSS_MEETING_QUESTIONS",
  "PRODUCT_EXPLANATION", "FEATURE_VERIFICATION", "FAQ_ANSWER",
  "EXTERNAL_RESEARCH", "SALES_DOCS_PREP",
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
  return `I want to help but I'm not sure what you're looking for. Are you asking about:

• A customer meeting (which company?)
• PitCrew product info (which feature?)
• Help with a task (what kind?)

Give me a hint and I'll get you sorted!`;
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
  const systemPrompt = `You are validating an intent classification. A deterministic classifier matched a user question, but the match was low-confidence.

CONTEXT: PitCrew sells vision AI to automotive service businesses. Users ask about customer meetings, product features, and need help with tasks.

THE DETERMINISTIC CLASSIFIER CHOSE:
Intent: ${deterministicIntent}
Reason: ${deterministicReason}
Signals: ${matchedSignals.join(", ")}

YOUR JOB: Determine if this classification is semantically correct.

VALID INTENTS:
- SINGLE_MEETING: Questions about what happened in a specific meeting (what did X say, summary, next steps)
- MULTI_MEETING: Questions across multiple meetings (search all calls, find patterns, compare)
- PRODUCT_KNOWLEDGE: Questions about PitCrew product features, pricing, capabilities
- EXTERNAL_RESEARCH: Research on external companies (earnings calls, news, priorities, public info)
- DOCUMENT_SEARCH: Looking for specific documents
- GENERAL_HELP: Drafting emails, general assistance
- REFUSE: Out-of-scope requests (weather, jokes, personal info)

KEY DISTINCTIONS:
- "search all calls" or "recent calls" → MULTI_MEETING (not SINGLE_MEETING or GENERAL_HELP)
- "what did X say" → SINGLE_MEETING
- "how does PitCrew work" → PRODUCT_KNOWLEDGE
- "research Costco" or "their earnings calls" → EXTERNAL_RESEARCH
- "draft an email" → GENERAL_HELP

Respond with JSON:
{
  "confirmed": true/false,
  "suggestedIntent": "INTENT_NAME" (only if confirmed=false),
  "suggestedContract": "CONTRACT_NAME" (only if confirmed=false),
  "confidence": 0.0-1.0,
  "reason": "brief explanation"
}

If confirmed=true, suggestedIntent/suggestedContract can be omitted.`;

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
- EXTERNAL_RESEARCH: Research on external companies (earnings calls, news, priorities, public info)
- DOCUMENT_SEARCH: Looking for specific documents
- GENERAL_HELP: Drafting, writing, general assistance
- REFUSE: Clearly out-of-scope requests

VALID CONTRACTS per intent:
- SINGLE_MEETING: MEETING_SUMMARY, NEXT_STEPS, ATTENDEES, CUSTOMER_QUESTIONS, EXTRACTIVE_FACT, AGGREGATIVE_LIST
- MULTI_MEETING: PATTERN_ANALYSIS, COMPARISON, TREND_SUMMARY, CROSS_MEETING_QUESTIONS
- PRODUCT_KNOWLEDGE: PRODUCT_EXPLANATION, FEATURE_VERIFICATION, FAQ_ANSWER
- EXTERNAL_RESEARCH: EXTERNAL_RESEARCH, SALES_DOCS_PREP, VALUE_PROPOSITION
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
- "research [company]" or "earnings calls" or "their priorities" → EXTERNAL_RESEARCH
- "slide deck for [external company]" or "pitch deck" → EXTERNAL_RESEARCH with SALES_DOCS_PREP contract
- "find their strategic priorities" or "public statements" → EXTERNAL_RESEARCH

CRITICAL FOLLOW-UP PATTERN:
When the conversation history shows a list of customer questions was just provided, and the user asks something like "help me answer those questions" or "can you answer those" or "draft responses":
- This is asking for PRODUCT_KNOWLEDGE answers to the questions in the thread
- Use PRODUCT_KNOWLEDGE intent with FAQ_ANSWER contract
- The user wants you to use product knowledge to provide answers to the open/unanswered questions
- NOT just re-list the same questions again
- Reference the specific questions from thread context and provide answers

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
}

User: "Research Costco and create a slide deck for their leadership team"
Response: {
  "proposedIntent": "EXTERNAL_RESEARCH",
  "proposedContract": "SALES_DOCS_PREP",
  "confidence": 0.9,
  "interpretation": "research Costco's public priorities and create a sales pitch deck",
  "questionForm": "You want me to research Costco's strategic priorities and create a slide deck to pitch PitCrew to their leadership?",
  "canPartialAnswer": false,
  "partialAnswer": "",
  "alternatives": []
}

User: "Do research on that customer including recent earnings calls"
Response: {
  "proposedIntent": "EXTERNAL_RESEARCH",
  "proposedContract": "EXTERNAL_RESEARCH",
  "confidence": 0.85,
  "interpretation": "research external company using public sources like earnings calls",
  "questionForm": "You want me to research this company's recent earnings calls and public statements?",
  "canPartialAnswer": false,
  "partialAnswer": "",
  "alternatives": [
    {
      "intent": "MULTI_MEETING",
      "contract": "PATTERN_ANALYSIS",
      "description": "Search our meeting notes about this company instead",
      "hint": ""
    }
  ]
}`;

  try {
    // Build messages array with thread context if available
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
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
