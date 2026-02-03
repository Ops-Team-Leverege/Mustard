/**
 * Intent Classification System (v2)
 * 
 * Purpose:
 * Canonical intent enum that determines what data scopes are allowed.
 * Intent is immutable once classified - cannot be changed later in pipeline.
 * 
 * Core Invariant (Non-Negotiable):
 * One user request → one intent → one scope → one or more contracts executed in sequence
 * 
 * Classification Strategy:
 * 1. Pattern-based fast-paths for common patterns (no LLM cost)
 * 2. Named entity detection (company names, contact names)
 * 3. Split detection for multi-intent requests (CLARIFY)
 * 4. REFUSE detection for out-of-scope requests
 * 5. LLM fallback for ambiguous queries
 * 
 * Layer: Decision Layer (Intent Router)
 */

import { OpenAI } from "openai";
import { MODEL_ASSIGNMENTS } from "../config/models";
import { INTENT_CLASSIFICATION_PROMPT } from "../config/prompts";
import { 
  interpretAmbiguousQuery,
  validateLowConfidenceIntent,
  type ClarifyWithInterpretation,
  type LLMInterpretationAlternative,
  type IntentString,
  type ContractString,
  type IntentValidationResult,
} from "./llmInterpretation";
import { storage } from "../storage";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export enum Intent {
  SINGLE_MEETING = "SINGLE_MEETING",
  MULTI_MEETING = "MULTI_MEETING",
  PRODUCT_KNOWLEDGE = "PRODUCT_KNOWLEDGE",
  DOCUMENT_SEARCH = "DOCUMENT_SEARCH",
  EXTERNAL_RESEARCH = "EXTERNAL_RESEARCH",
  GENERAL_HELP = "GENERAL_HELP",
  REFUSE = "REFUSE",
  CLARIFY = "CLARIFY",
}

export type IntentDetectionMethod = "keyword" | "pattern" | "entity" | "entity_acronym" | "llm" | "llm_validated" | "default" | "follow_up_detection" | "product_signal" | "situation_advice";

/**
 * Structured decision metadata for observability.
 * Logs should explain WHY a decision was made, not just what was chosen.
 */
export type IntentDecisionMetadata = {
  matchedSignals?: string[];           // Keywords, patterns that matched
  rejectedIntents?: Array<{            // Intents considered but rejected
    intent: Intent;
    reason: string;
  }>;
  classificationError?: string;        // Error if classification failed
  singleIntentViolation?: boolean;     // True if multiple intents matched
  llmInterpretation?: {                // LLM interpretation for clarification
    proposedIntent: IntentString;
    proposedContracts: ContractString[];  // Ordered array for contract chain
    confidence: number;
    failureReason: string;
    interpretationSource: "llm_fallback" | "ambiguity_resolution";
  };
  llmValidation?: {                    // LLM validation for low-confidence matches
    confirmed: boolean;
    suggestedIntent?: string;
    reason: string;
  };
  originalIntent?: Intent;             // Original intent before LLM override
  originalReason?: string;             // Original reason before LLM override
  isFollowUp?: boolean;                // True if this is a follow-up/refinement message
  previousBotResponseSnippet?: string; // Snippet of previous bot response for context
};

/**
 * Proposed interpretation for CLARIFY responses.
 * Enables intelligent clarification without automatic execution.
 * Uses string types to avoid circular dependencies.
 * 
 * For multi-step requests, contracts is an ordered array representing
 * the execution chain (e.g., ["EXTERNAL_RESEARCH", "SALES_DOCS_PREP"]).
 */
export type ProposedInterpretation = {
  intent: IntentString;
  contracts: ContractString[];  // Ordered array for contract chain
  summary: string;
};

export type IntentClassificationResult = {
  intent: Intent;
  intentDetectionMethod: IntentDetectionMethod;
  confidence: number;
  reason?: string;
  needsSplit?: boolean;
  splitOptions?: string[];
  decisionMetadata?: IntentDecisionMetadata;  // HARDENING: Structured observability
  proposedInterpretation?: ProposedInterpretation;  // For CLARIFY: what we think they want
  alternatives?: LLMInterpretationAlternative[];    // For CLARIFY: other possible interpretations
  clarifyMessage?: string;                          // Natural language clarification message
};

// ============================================================================
// KEYWORD PATTERNS - Minimal fast-paths for absolute certainties only
// Most classification is handled by LLM for semantic understanding
// ============================================================================

// Simple greetings that don't need LLM
const SIMPLE_GREETINGS = [
  "hello",
  "hi",
  "hi there",
  "hey",
  "hey there",
  "good morning",
  "good afternoon",
  "good evening",
  "thanks",
  "thank you",
  "thanks!",
  "thank you!",
];

// ============================================================================
// REGEX PATTERNS - Only for absolute certainties (REFUSE, MULTI_INTENT)
// All other classification is handled by LLM for semantic understanding
// ============================================================================

const REFUSE_PATTERNS = [
  /\bweather\s+(in|like|forecast)\b/i,
  /\bstock\s+(price|market|ticker)\b/i,
  /\bhome\s+address\b/i,
  /\bpersonal\s+(address|phone|email)\b/i,
  /\bhow\s+much\s+(revenue|money|profit)\s+will\b/i,
  /\bwhat('s| is)\s+the\s+time\b/i,
  /\b(tell\s+me\s+a\s+)?joke\b/i,
  /\bwrite\s+(me\s+)?a?\s*(poem|story|song)\b/i,
];

const MULTI_INTENT_PATTERNS = [
  /\b(summarize|summary)\b.*\b(and|then)\b.*\b(pricing|check|email|compare)\b/i,
  /\b(answer|respond)\b.*\b(and|then)\b.*\b(email|summarize|pricing)\b/i,
  /\bcompare\b.*\b(and|then)\b.*\b(email|summarize)\b/i,
];

// ============================================================================
// KNOWN ENTITIES - Trigger SINGLE_MEETING or MULTI_MEETING based on context
// ============================================================================

// Fallback hardcoded list (used if DB query fails)
const FALLBACK_COMPANIES = [
  "les schwab",
  "ace hardware",
  "jiffy lube",
  "discount tire",
  "valvoline",
  "walmart",
  "fullspeed",
  "canadian tire",
];

// Dynamic company cache - loaded from database
let cachedCompanyNames: string[] = [];
let companyCacheLastRefresh = 0;
const COMPANY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getKnownCompanies(): Promise<string[]> {
  const now = Date.now();
  
  // Return cache if still valid
  if (cachedCompanyNames.length > 0 && (now - companyCacheLastRefresh) < COMPANY_CACHE_TTL_MS) {
    return cachedCompanyNames;
  }
  
  try {
    const companies = await storage.getCompanies("PitCrew");
    cachedCompanyNames = companies.map(c => c.name.toLowerCase());
    companyCacheLastRefresh = now;
    console.log(`[Intent] Loaded ${cachedCompanyNames.length} companies from database`);
    return cachedCompanyNames;
  } catch (error) {
    console.warn(`[Intent] Failed to load companies from DB, using fallback:`, error);
    return FALLBACK_COMPANIES;
  }
}

const KNOWN_CONTACTS = [
  "tyler wiggins",
  "tyler",
  "randy hentschke",
  "randy",
  "robert colongo",
  "robert",
  "will sovern",
  "eric conn",
  "john smith",
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function matchesKeywords(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some(kw => lower.includes(kw));
}

function matchesPatterns(text: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(text));
}

type CompanyMatchResult = {
  company: string;
  matchType: "full" | "acronym";  // full = authoritative, acronym = needs LLM validation
};

async function containsKnownCompany(text: string): Promise<CompanyMatchResult | null> {
  const lower = text.toLowerCase();
  const companies = await getKnownCompanies();
  
  // First pass: check for full company name match (AUTHORITATIVE - no validation needed)
  for (const company of companies) {
    if (lower.includes(company)) {
      return { company, matchType: "full" };
    }
  }
  
  // Second pass: check for first word match ONLY for acronyms (e.g., "TPI" matches "TPI Composites")
  // Acronym detection: all uppercase, 2-5 characters (covers TPI, ACE, CJ, OK, etc.)
  // These matches NEED LLM validation to confirm semantic intent
  for (const company of companies) {
    const firstWord = company.split(/\s+/)[0];
    const isAcronym = /^[A-Z]{2,5}$/.test(firstWord) || /^[A-Z][A-Za-z]'?s?$/.test(firstWord);
    
    if (isAcronym) {
      // Use word boundary to avoid partial matches
      const wordBoundaryRegex = new RegExp(`\\b${firstWord}\\b`, 'i');
      if (wordBoundaryRegex.test(lower)) {
        return { company, matchType: "acronym" };
      }
    }
  }
  
  return null;
}

function containsKnownContact(text: string): string | null {
  const lower = text.toLowerCase();
  for (const contact of KNOWN_CONTACTS) {
    if (lower.includes(contact)) {
      return contact;
    }
  }
  return null;
}

function detectMultiIntent(text: string): { needsSplit: boolean; splitOptions?: string[] } {
  for (const pattern of MULTI_INTENT_PATTERNS) {
    if (pattern.test(text)) {
      return {
        needsSplit: true,
        splitOptions: ["meeting content", "other request"],
      };
    }
  }
  return { needsSplit: false };
}

// ============================================================================
// FOLLOW-UP MESSAGE DETECTION
// ============================================================================

import { detectFollowUp } from '../services/followUpDetector';

/**
 * Detect if the current message is a follow-up/refinement of a previous request.
 * Uses the configurable followUpDetector service for pattern matching.
 */
function detectFollowUpMessage(
  question: string,
  threadContext?: ThreadContext
): IntentClassificationResult | null {
  const result = detectFollowUp(question, threadContext);
  if (!result) return null;

  // Map the service result to an IntentClassificationResult
  // All actionable intents should be here for follow-up handling
  const intentMap: Record<string, Intent> = {
    "EXTERNAL_RESEARCH": Intent.EXTERNAL_RESEARCH,
    "SINGLE_MEETING": Intent.SINGLE_MEETING,
    "MULTI_MEETING": Intent.MULTI_MEETING,
    "PRODUCT_KNOWLEDGE": Intent.PRODUCT_KNOWLEDGE,
    "DOCUMENT_SEARCH": Intent.DOCUMENT_SEARCH,
    "GENERAL_HELP": Intent.GENERAL_HELP,
  };

  const intent = intentMap[result.inferredIntentKey] || Intent.GENERAL_HELP;
  
  console.log(`[IntentClassifier] Follow-up detected: "${question}" → ${intent} (${result.reason})`);
  
  return {
    intent,
    intentDetectionMethod: "follow_up_detection",
    confidence: result.confidence,
    reason: result.reason,
    decisionMetadata: {
      isFollowUp: true,
      previousBotResponseSnippet: result.previousBotSnippet,
    },
  };
}

// ============================================================================
// CLASSIFICATION LOGIC
// ============================================================================

async function classifyByKeyword(
  question: string,
  threadContext?: ThreadContext
): Promise<IntentClassificationResult | null> {
  const lower = question.toLowerCase();

  // NOTE: Follow-up detection removed from fast-path. 
  // The LLM classifier sees thread context and handles follow-ups semantically.
  // Pattern-based follow-up detection was "keyword creep" - LLM should understand intent.

  // HARDENING: Check for REFUSE first (highest priority)
  if (matchesPatterns(question, REFUSE_PATTERNS)) {
    return {
      intent: Intent.REFUSE,
      intentDetectionMethod: "pattern",
      confidence: 0.95,
      reason: "Question is out of scope for this assistant",
    };
  }

  // HARDENING: Check for explicit multi-intent patterns
  const multiIntentCheck = detectMultiIntent(question);
  if (multiIntentCheck.needsSplit) {
    return {
      intent: Intent.CLARIFY,
      intentDetectionMethod: "pattern",
      confidence: 0.9,
      reason: "Request requires multiple intents - ask user to split",
      needsSplit: true,
      splitOptions: multiIntentCheck.splitOptions,
    };
  }

  // ============================================================================
  // FAST-PATH: Simple greetings (no LLM needed)
  // ============================================================================
  const trimmedLower = lower.trim();
  if (SIMPLE_GREETINGS.includes(trimmedLower) || SIMPLE_GREETINGS.some(g => trimmedLower === g)) {
    console.log(`[IntentClassifier] Fast-path: Simple greeting detected`);
    return {
      intent: Intent.GENERAL_HELP,
      intentDetectionMethod: "keyword",
      confidence: 1.0,
      reason: "Simple greeting - no LLM needed",
    };
  }

  // ============================================================================
  // LLM handles nuanced classification - no fast-paths for SINGLE_MEETING or PRODUCT_KNOWLEDGE
  // The LLM is better at understanding semantic intent than brittle regex patterns
  // ============================================================================

  // PRODUCT_KNOWLEDGE fast-path: Strategic advice requests should go directly to PRODUCT_KNOWLEDGE
  // These phrases indicate the user wants strategic advice using PitCrew's products
  // Also catches "our roadmap" (internal product roadmap) vs "their roadmap" (external)
  const productKnowledgeSignals = /\b(based\s+on\s+pitcrew|pitcrew['']?s?\s+value|our\s+value\s+prop|how\s+(should\s+we|can\s+we|do\s+we)\s+(approach|help|handle)|help\s+me\s+think\s+through|think\s+through\s+how|our\s+(q[1-4]\s+)?roadmap|what['']?s\s+on\s+our\s+roadmap|features?\s+coming\s+next|our\s+recommended\s+approach|what['']?s\s+our\s+(recommended\s+)?approach)\b/i;
  if (productKnowledgeSignals.test(question)) {
    console.log(`[Intent] Detected PRODUCT_KNOWLEDGE signal - fast-path to PRODUCT_KNOWLEDGE (strategic advice request)`);
    return {
      intent: Intent.PRODUCT_KNOWLEDGE,
      intentDetectionMethod: "product_signal",
      confidence: 0.92,
      reason: "Strategic advice request detected (based on PitCrew / help me think through)",
    };
  }

  // Entity detection: Only triggers if no action-based pattern matched first
  const companyMatch = await containsKnownCompany(question);
  const contact = containsKnownContact(question);
  
  if (companyMatch || contact) {
    const entityName = companyMatch?.company || contact;
    // "entity" = full match (authoritative), "entity_acronym" = acronym match (needs LLM validation)
    const detectionMethod: IntentDetectionMethod = companyMatch?.matchType === "acronym" ? "entity_acronym" : "entity";
    // Lower confidence for acronym matches since they need validation
    const confidence = companyMatch?.matchType === "acronym" ? 0.70 : 0.85;
    
    // Don't trigger multi-meeting for strategic advice requests
    // "across all their stores" is about customer behavior, not "search across all meetings"
    const hasMultiMeetingSignal = /\b(all|every|across|find|which|any)\b/i.test(question);
    const isDescribingSituation = /\b(pattern\s+we['']?re\s+seeing|emerging\s+pattern|customers?\s+want|they\s+want)\b/i.test(question);
    
    // If describing a situation with a strategic advice request, go to PRODUCT_KNOWLEDGE
    if (isDescribingSituation) {
      // Check if it's asking for strategic advice (how to approach, what to do)
      const wantsAdvice = /\b(how\s+(can|should|do)\s+we|help\s+me|what\s+should|approach\s+this)\b/i.test(question);
      if (wantsAdvice) {
        console.log(`[Intent] Situation description + advice request - fast-path to PRODUCT_KNOWLEDGE`);
        return {
          intent: Intent.PRODUCT_KNOWLEDGE,
          intentDetectionMethod: "situation_advice",
          confidence: 0.90,
          reason: "Describing customer situation and asking for strategic advice",
        };
      }
    }
    
    if (hasMultiMeetingSignal) {
      return {
        intent: Intent.MULTI_MEETING,
        intentDetectionMethod: detectionMethod,
        confidence,
        reason: `Contains known entity "${entityName}" with multi-meeting signal`,
      };
    }
    
    return {
      intent: Intent.SINGLE_MEETING,
      intentDetectionMethod: detectionMethod,
      confidence,
      reason: `Contains known entity "${entityName}" - likely asking about meeting`,
    };
  }

  return null;
}

async function classifyByLLM(
  question: string,
  threadContext?: ThreadContext
): Promise<IntentClassificationResult> {
  try {
    // Build messages array with thread context for semantic follow-up detection
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: INTENT_CLASSIFICATION_PROMPT },
    ];
    
    // Include thread history so LLM can understand follow-ups semantically
    if (threadContext?.messages && threadContext.messages.length > 1) {
      const historyMessages = threadContext.messages.slice(0, -1); // Exclude current message
      for (const msg of historyMessages) {
        messages.push({
          role: msg.isBot ? "assistant" : "user",
          content: msg.text,
        });
      }
      console.log(`[IntentClassifier] LLM classification with ${historyMessages.length} messages of thread context`);
    }
    
    // Add current question
    messages.push({ role: "user", content: question });
    
    const response = await openai.chat.completions.create({
      model: MODEL_ASSIGNMENTS.INTENT_CLASSIFICATION,
      messages,
      temperature: 0,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      // HARDENING: Empty LLM response must not default to GENERAL_HELP
      console.warn("[IntentClassifier] LLM returned empty response, returning CLARIFY");
      return {
        intent: Intent.CLARIFY,
        intentDetectionMethod: "default",
        confidence: 0,
        reason: "Classification failed: LLM returned empty response. Please rephrase your question.",
      };
    }

    const parsed = JSON.parse(content);
    const intentStr = parsed.intent as string;
    
    if (intentStr in Intent) {
      return {
        intent: Intent[intentStr as keyof typeof Intent],
        intentDetectionMethod: "llm",
        confidence: parsed.confidence || 0.8,
        reason: parsed.reason,
      };
    }

    // HARDENING: Classification failures must not default to GENERAL_HELP
    // Return CLARIFY with confidence 0 and diagnostic reason
    console.warn("[IntentClassifier] LLM returned invalid intent, returning CLARIFY");
    return {
      intent: Intent.CLARIFY,
      intentDetectionMethod: "default",
      confidence: 0,
      reason: "Classification failed: LLM returned invalid intent enum. Please rephrase your question.",
    };
  } catch (error) {
    // HARDENING: API errors, timeouts, invalid JSON must not default to GENERAL_HELP
    console.error("[IntentClassifier] LLM error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return {
      intent: Intent.CLARIFY,
      intentDetectionMethod: "default",
      confidence: 0,
      reason: `Classification failed: ${errorMessage}. Please try again or rephrase your question.`,
    };
  }
}

// Low-confidence threshold for LLM validation
const LOW_CONFIDENCE_THRESHOLD = 0.88;

// Detection methods that are considered "weak" and need LLM validation
// "entity" (full company name match) is AUTHORITATIVE - no validation needed
// "entity_acronym" (first-word acronym match) is WEAK - needs LLM to confirm semantic intent
const WEAK_DETECTION_METHODS: IntentDetectionMethod[] = ["keyword", "entity_acronym"];

function needsLLMValidation(result: IntentClassificationResult): boolean {
  // High-confidence pattern matches don't need validation
  if (result.intentDetectionMethod === "pattern" && result.confidence >= 0.9) {
    return false;
  }
  
  // Full entity detection (known customers from database) doesn't need validation
  // When someone mentions a known customer like "Les Schwab", trust it's about meetings
  if (result.intentDetectionMethod === "entity") {
    return false;
  }
  
  // Product signal and situation_advice are high-confidence fast-paths
  if (result.intentDetectionMethod === "product_signal" || result.intentDetectionMethod === "situation_advice") {
    return false;
  }
  
  // CLARIFY and REFUSE intents don't need validation
  if (result.intent === Intent.CLARIFY || result.intent === Intent.REFUSE) {
    return false;
  }
  
  // Weak detection methods need validation (includes entity_acronym matches)
  if (WEAK_DETECTION_METHODS.includes(result.intentDetectionMethod)) {
    console.log(`[IntentClassifier] Weak detection method "${result.intentDetectionMethod}" - will validate with LLM`);
    return true;
  }
  
  // Low confidence matches need validation
  if (result.confidence < LOW_CONFIDENCE_THRESHOLD) {
    return true;
  }
  
  return false;
}

export type ThreadContext = {
  messages: Array<{
    text: string;
    isBot: boolean;
  }>;
};

export async function classifyIntent(
  question: string,
  threadContext?: ThreadContext
): Promise<IntentClassificationResult> {
  const keywordResult = await classifyByKeyword(question, threadContext);
  
  if (keywordResult) {
    // Check if this is already a CLARIFY due to ambiguity
    const isAmbiguousClarify = keywordResult.intent === Intent.CLARIFY && 
                               keywordResult.decisionMetadata?.singleIntentViolation;
    
    if (isAmbiguousClarify) {
      // Use LLM interpretation to provide helpful clarification
      console.log(`[IntentClassifier] Ambiguous match detected, using LLM interpretation for clarification`);
      return classifyWithInterpretation(question, "multi_intent_ambiguity", keywordResult, threadContext);
    }
    
    // Check if this low-confidence match needs LLM validation
    if (needsLLMValidation(keywordResult)) {
      console.log(`[IntentClassifier] Low-confidence match (${keywordResult.intentDetectionMethod}, conf=${keywordResult.confidence}), validating with LLM...`);
      
      const validation = await validateLowConfidenceIntent(
        question,
        keywordResult.intent as IntentString,
        keywordResult.reason || "No reason provided",
        keywordResult.decisionMetadata?.matchedSignals || []
      );
      
      if (validation.confirmed) {
        console.log(`[IntentClassifier] LLM confirmed: ${keywordResult.intent}`);
        return {
          ...keywordResult,
          decisionMetadata: {
            ...keywordResult.decisionMetadata,
            llmValidation: { confirmed: true, reason: validation.reason },
          },
        };
      } else if (validation.suggestedIntent) {
        // LLM suggests a different intent - use it
        console.log(`[IntentClassifier] LLM override: ${keywordResult.intent} -> ${validation.suggestedIntent}`);
        const newIntent = Intent[validation.suggestedIntent as keyof typeof Intent];
        return {
          intent: newIntent,
          intentDetectionMethod: "llm_validated",
          confidence: validation.confidence,
          reason: validation.reason,
          decisionMetadata: {
            originalIntent: keywordResult.intent,
            originalReason: keywordResult.reason,
            llmValidation: {
              confirmed: false,
              suggestedIntent: validation.suggestedIntent,
              reason: validation.reason,
            },
          },
        };
      }
    }
    
    console.log(`[IntentClassifier] Keyword match: ${keywordResult.intent}`);
    return keywordResult;
  }

  // No keyword match - use LLM interpretation for intelligent clarification
  console.log(`[IntentClassifier] No keyword match, using LLM interpretation for clarification`);
  return classifyWithInterpretation(question, "no_intent_match", null, threadContext);
}

/**
 * Use LLM interpretation to propose what the user might want.
 * Always returns CLARIFY - never executes automatically.
 * 
 * This is the ONLY path that uses LLM for interpretation.
 * The LLM may:
 * - Interpret what the user likely wants
 * - Propose a candidate intent and contract
 * - Suggest clarification options
 * 
 * The LLM may NOT:
 * - Execute
 * - Decide
 * - Override Decision Layer rules
 */
async function classifyWithInterpretation(
  question: string,
  failureReason: string,
  originalResult: IntentClassificationResult | null,
  threadContext?: ThreadContext
): Promise<IntentClassificationResult> {
  try {
    const interpretation = await interpretAmbiguousQuery(question, failureReason, threadContext);
    
    const proposedIntent = interpretation.proposedInterpretation.intent;
    const confidence = interpretation.metadata.confidence;
    
    console.log(`[IntentClassifier] LLM interpretation: intent=${proposedIntent}, confidence=${confidence}`);
    
    // HIGH CONFIDENCE PATH: Use LLM's proposed intent when confident
    // Threshold 0.6 chosen to allow reasonable certainty while not being too strict
    const CONFIDENCE_THRESHOLD = 0.6;
    
    if (confidence >= CONFIDENCE_THRESHOLD && proposedIntent !== "CLARIFY") {
      // Map string intent to Intent enum
      const intentMap: Record<string, Intent> = {
        "SINGLE_MEETING": Intent.SINGLE_MEETING,
        "MULTI_MEETING": Intent.MULTI_MEETING,
        "PRODUCT_KNOWLEDGE": Intent.PRODUCT_KNOWLEDGE,
        "EXTERNAL_RESEARCH": Intent.EXTERNAL_RESEARCH,
        "DOCUMENT_SEARCH": Intent.DOCUMENT_SEARCH,
        "GENERAL_HELP": Intent.GENERAL_HELP,
        "REFUSE": Intent.REFUSE,
        "CLARIFY": Intent.CLARIFY,
      };
      
      const resolvedIntent = intentMap[proposedIntent] || Intent.GENERAL_HELP;
      
      console.log(`[IntentClassifier] Using LLM's proposed intent: ${resolvedIntent} (confidence ${confidence} >= ${CONFIDENCE_THRESHOLD})`);
      
      return {
        intent: resolvedIntent,
        intentDetectionMethod: "llm",
        confidence: confidence,
        reason: interpretation.proposedInterpretation.summary,
        proposedInterpretation: interpretation.proposedInterpretation,
        alternatives: interpretation.alternatives,
        decisionMetadata: {
          matchedSignals: originalResult?.decisionMetadata?.matchedSignals,
          rejectedIntents: originalResult?.decisionMetadata?.rejectedIntents,
          singleIntentViolation: originalResult?.decisionMetadata?.singleIntentViolation,
          llmInterpretation: interpretation.metadata,
        },
      };
    }
    
    // LOW CONFIDENCE PATH: Ask for clarification but provide interpretation
    console.log(`[IntentClassifier] Requesting clarification (confidence ${confidence} < ${CONFIDENCE_THRESHOLD})`);
    
    return {
      intent: Intent.CLARIFY,
      intentDetectionMethod: "llm",
      confidence: confidence,
      reason: interpretation.message,
      proposedInterpretation: interpretation.proposedInterpretation,
      alternatives: interpretation.alternatives,
      clarifyMessage: interpretation.message,
      decisionMetadata: {
        matchedSignals: originalResult?.decisionMetadata?.matchedSignals,
        rejectedIntents: originalResult?.decisionMetadata?.rejectedIntents,
        singleIntentViolation: originalResult?.decisionMetadata?.singleIntentViolation,
        llmInterpretation: interpretation.metadata,
      },
    };
  } catch (error) {
    console.error("[IntentClassifier] LLM interpretation error:", error);
    
    // Fallback to basic CLARIFY without interpretation
    return {
      intent: Intent.CLARIFY,
      intentDetectionMethod: "default",
      confidence: 0,
      reason: "I'd like to help, but I want to make sure I understand. Could you tell me a bit more about what you're looking for?",
      clarifyMessage: "I'd like to help, but I want to make sure I understand. Could you tell me a bit more about what you're looking for?",
      decisionMetadata: {
        classificationError: error instanceof Error ? error.message : "Unknown error",
      },
    };
  }
}
