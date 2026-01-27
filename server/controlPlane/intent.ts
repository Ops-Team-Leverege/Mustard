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
 * Layer: Control Plane (Intent Classification)
 */

import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export enum Intent {
  SINGLE_MEETING = "SINGLE_MEETING",
  MULTI_MEETING = "MULTI_MEETING",
  PRODUCT_KNOWLEDGE = "PRODUCT_KNOWLEDGE",
  DOCUMENT_SEARCH = "DOCUMENT_SEARCH",
  GENERAL_HELP = "GENERAL_HELP",
  REFUSE = "REFUSE",
  CLARIFY = "CLARIFY",
}

export type IntentDetectionMethod = "keyword" | "pattern" | "entity" | "llm" | "default";

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
};

export type IntentClassificationResult = {
  intent: Intent;
  intentDetectionMethod: IntentDetectionMethod;
  confidence: number;
  reason?: string;
  needsSplit?: boolean;
  splitOptions?: string[];
  decisionMetadata?: IntentDecisionMetadata;  // HARDENING: Structured observability
};

// ============================================================================
// KEYWORD PATTERNS - Simple string matching (low cost, high precision)
// ============================================================================

const SINGLE_MEETING_KEYWORDS = [
  "yesterday",
  "today",
  "last meeting",
  "this meeting",
  "the meeting",
  "the call",
  "last call",
  "this call",
  "from the meeting",
  "in the meeting",
  "discussed in",
  "action items",
  "next steps",
  "commitments",
  "attendees",
  "who was on",
  "who attended",
  "customer questions",
  "what did they ask",
  "what questions",
  "meeting with",
  "call with",
  "demo with",
  "on monday",
  "on tuesday",
  "on wednesday",
  "on thursday",
  "on friday",
  "last week",
  "this week",
  "summarize the meeting",
  "summary of the meeting",
  "meeting summary",
  "walkthrough",
];

const MULTI_MEETING_KEYWORDS = [
  "across meetings",
  "across all meetings",
  "all meetings",
  "trend",
  "over time",
  "historically",
  "patterns",
  "how many times",
  "frequently",
  "common questions",
  "recurring",
  "aggregate",
  "summary of all",
  "compare meetings",
  "find all",
  "search for",
  "which meetings",
  "every meeting",
  "any meetings",
  "meetings that mention",
  "who asked about",
  "everyone who",
];

const PRODUCT_KNOWLEDGE_KEYWORDS = [
  // Direct product questions
  "what is pitcrew",
  "what does pitcrew do",
  "what's pitcrew",
  "pitcrew features",
  "product features",
  "capabilities",
  "what can pitcrew",
  "does pitcrew support",
  "does pitcrew integrate",
  "does pitcrew connect",
  "does pitcrew work with",
  "can pitcrew",
  // Pricing variations
  "pitcrew pricing",
  "pitcrew priced",
  "pitcrew cost",
  "how is pitcrew priced",
  "how much is pitcrew",
  "how much does pitcrew",
  "price of pitcrew",
  "pricing for pitcrew",
  // Tier keywords
  "pro tier",
  "advanced tier",
  "enterprise tier",
  // Value/features
  "value proposition",
  "how does pitcrew",
  "pitcrew integrations",
  "pitcrew work",
  "pitcrew help",
  "about pitcrew",
  "pitcrew's",
  "tell me about pitcrew",
  "explain pitcrew",
  // Product feature names
  "live tv dashboard",
  "bladeassure",
  "queue analytics",
  "tire tracking",
  "bay tracking",
  "vehicle tracking",
  "camera integration",
  "vision ai",
  // Content creation
  "update our pricing",
  "pricing faq",
  "safety features",
  "deployment options",
  // Integration questions
  "pos system",
  "pos integration",
  "integrate with pos",
  "dms integration",
  "dealer management",
];

const DOCUMENT_SEARCH_KEYWORDS = [
  "in the documents",
  "documentation",
  "spec",
  "specification",
  "wiki",
  "knowledge base",
  "reference doc",
  "find the contract",
  "contract we signed",
  "proposal",
  "agreement",
];

const GENERAL_HELP_KEYWORDS = [
  "what can you do",
  "commands",
  "usage",
  "hello",
  "hi there",
  "hey there",
  "thanks",
  "thank you",
  "good morning",
  "good afternoon",
  "draft an email",
  "draft email",
  "write an email",
  "write email",
  "draft a message",
  "draft message",
  "help me write",
  "help me draft",
];

// ============================================================================
// REGEX PATTERNS - More precise matching for common sentence structures
// ============================================================================

const SINGLE_MEETING_PATTERNS = [
  /\bwhat\s+did\s+[\w\s]+\s+say\b/i,
  /\bwhat\s+did\s+[\w\s]+\s+mention\b/i,
  /\bwhat\s+did\s+[\w\s]+\s+ask\b/i,
  /\bwhat\s+did\s+[\w\s]+\s+suggest\b/i,
  /\bwhat\s+did\s+[\w\s]+\s+agree\b/i,
  /\bwhat\s+concerns?\s+did\b/i,
  /\bwhat\s+feedback\s+did\b/i,
  /\bwhat\s+questions?\s+did\b/i,
  /\bdid\s+they\s+(say|mention|ask|suggest|agree)\b/i,
  /\bdid\s+[\w]+\s+(say|mention|ask|suggest|agree)\b/i,
  /\bin\s+the\s+[\w\s]+\s+(meeting|call|demo)\b/i,
  /\bfrom\s+the\s+[\w\s]+\s+(meeting|call|demo)\b/i,
  /\bthe\s+[\w\s]+\s+(meeting|call|demo)\s+with\b/i,
  /\bsummarize\s+(the|this|our|my)\s+(meeting|call|demo)\b/i,
  /\bwhat\s+were\s+the\s+(next\s+steps|action\s+items|takeaways)\b/i,
  /\bwho\s+was\s+(on|in|at)\s+(the|this)\s+(call|meeting)\b/i,
  /\bhelp\s+me\s+answer\s+(the|their)\s+questions?\b/i,
  /\banswer\s+(the|their)\s+questions?\s+from\b/i,
];

const MULTI_MEETING_PATTERNS = [
  /\bacross\s+(all\s+)?meetings\b/i,
  /\bfind\s+all\s+(the\s+)?(questions?|mentions?|times?)\b/i,
  /\bwhich\s+meetings?\s+(mention|discuss|have|include)\b/i,
  /\beveryone\s+who\s+(asked|mentioned|said)\b/i,
  /\bwhat\s+meetings?\s+(mention|discuss|have|include)\b/i,
  /\bcompare\s+what\s+[\w\s]+\s+said\b/i,
  /\bcompare\s+[\w\s]+\s+and\s+[\w\s]+\s+meetings?\b/i,
];

const PRODUCT_KNOWLEDGE_PATTERNS = [
  /\bhow\s+does\s+pitcrew\s+work\b/i,
  /\bwhat\s+is\s+pitcrew('s)?\b/i,
  /\bdoes\s+(it|pitcrew)\s+(support|integrate|work\s+with|connect)\b/i,
  /\bcan\s+pitcrew\s+(do|handle|support|integrate)\b/i,
  /\bpitcrew('s)?\s+(pricing|cost|features?|capabilities?)\b/i,
  /\b(pro|advanced|enterprise)\s+tier\b/i,
  /\bupdat(e|ing)\s+(our|the|my)\s+(pricing|faq|copy|website)\b/i,
  /\bwrite\s+(a\s+section|copy)\s+about\s+pitcrew\b/i,
  /\b(help\s+me\s+)?write\s+about\s+(pitcrew|our\s+product)\b/i,
];

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

const KNOWN_COMPANIES = [
  "les schwab",
  "les shwab",
  "ace hardware",
  "ace",
  "jiffy lube",
  "discount tire",
  "valvoline",
  "walmart",
  "fullspeed",
  "fullspeed automotive",
  "tpi",
  "midas",
  "firestone",
  "goodyear",
  "pepboys",
  "pep boys",
  "take 5",
  "take five",
  "express oil",
  "meineke",
  "mavis",
  "big o tires",
  "belle tire",
  "monro",
  "ntb",
  "amazon",
];

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

function containsKnownCompany(text: string): string | null {
  const lower = text.toLowerCase();
  for (const company of KNOWN_COMPANIES) {
    if (lower.includes(company)) {
      return company;
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
// CLASSIFICATION LOGIC
// ============================================================================

function classifyByKeyword(question: string): IntentClassificationResult | null {
  const lower = question.toLowerCase();

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

  // HARDENING: Single-Intent Invariant Enforcement
  // Count how many distinct intent categories match to detect ambiguity
  const matchingIntents: Intent[] = [];
  
  if (matchesPatterns(question, MULTI_MEETING_PATTERNS) || matchesKeywords(lower, MULTI_MEETING_KEYWORDS)) {
    matchingIntents.push(Intent.MULTI_MEETING);
  }
  if (matchesPatterns(question, SINGLE_MEETING_PATTERNS) || matchesKeywords(lower, SINGLE_MEETING_KEYWORDS)) {
    matchingIntents.push(Intent.SINGLE_MEETING);
  }
  if (matchesPatterns(question, PRODUCT_KNOWLEDGE_PATTERNS) || matchesKeywords(lower, PRODUCT_KNOWLEDGE_KEYWORDS)) {
    matchingIntents.push(Intent.PRODUCT_KNOWLEDGE);
  }
  
  // HARDENING: If multiple mutually exclusive intents match → CLARIFY (single-intent invariant)
  // MULTI_MEETING and SINGLE_MEETING are mutually exclusive
  // PRODUCT_KNOWLEDGE with MEETING intents is ambiguous
  if (matchingIntents.length > 1) {
    console.log(`[IntentClassifier] HARDENING: Single-intent invariant violation detected. Matched: ${matchingIntents.join(", ")}`);
    return {
      intent: Intent.CLARIFY,
      intentDetectionMethod: "pattern",
      confidence: 0,
      reason: `Multiple intents matched (${matchingIntents.join(", ")}) - clarification needed`,
      decisionMetadata: {
        singleIntentViolation: true,
        matchedSignals: matchingIntents.map(i => i.toString()),
      },
    };
  }
  
  // If exactly one intent matched, return it
  if (matchingIntents.length === 1) {
    return {
      intent: matchingIntents[0],
      intentDetectionMethod: "pattern",
      confidence: 0.9,
      reason: `Matched ${matchingIntents[0]} pattern`,
    };
  }

  // IMPORTANT: Check for action-based GENERAL_HELP patterns BEFORE entity detection
  // This ensures "Draft an email to Tyler" routes to drafting, not meeting lookup
  if (matchesKeywords(lower, GENERAL_HELP_KEYWORDS)) {
    return {
      intent: Intent.GENERAL_HELP,
      intentDetectionMethod: "keyword",
      confidence: 0.85,
      reason: "Matched general help keyword pattern (action takes priority)",
    };
  }

  if (matchesKeywords(lower, DOCUMENT_SEARCH_KEYWORDS)) {
    return {
      intent: Intent.DOCUMENT_SEARCH,
      intentDetectionMethod: "keyword",
      confidence: 0.9,
      reason: "Matched document search keyword pattern",
    };
  }

  // Entity detection: Only triggers if no action-based pattern matched first
  const company = containsKnownCompany(question);
  const contact = containsKnownContact(question);
  
  if (company || contact) {
    const entityName = company || contact;
    const hasMultiMeetingSignal = /\b(all|every|across|find|which|any)\b/i.test(question);
    
    if (hasMultiMeetingSignal) {
      return {
        intent: Intent.MULTI_MEETING,
        intentDetectionMethod: "entity",
        confidence: 0.85,
        reason: `Contains known entity "${entityName}" with multi-meeting signal`,
      };
    }
    
    return {
      intent: Intent.SINGLE_MEETING,
      intentDetectionMethod: "entity",
      confidence: 0.85,
      reason: `Contains known entity "${entityName}" - likely asking about meeting`,
    };
  }

  return null;
}

async function classifyByLLM(question: string): Promise<IntentClassificationResult> {
  const systemPrompt = `You are an intent classifier for PitCrew's internal sales assistant.

CONTEXT: PitCrew sells vision AI to automotive service businesses. Users ask about:
- Customer meetings (Les Schwab, ACE, Jiffy Lube, etc.)
- Contact interactions (Tyler Wiggins, Randy, Robert, etc.)
- Product features and pricing
- Document searches

Classify into exactly ONE intent:
- SINGLE_MEETING: Questions about what happened in a meeting, what someone said/asked/mentioned
- MULTI_MEETING: Questions across multiple meetings (trends, aggregates, comparisons)
- PRODUCT_KNOWLEDGE: Questions about PitCrew product features, pricing, integrations
- DOCUMENT_SEARCH: Questions about documentation, contracts, specs
- GENERAL_HELP: Greetings, meta questions, general assistance requests
- REFUSE: Out-of-scope (weather, stock prices, personal info, jokes)
- CLARIFY: Request combines multiple intents that need to be split

CRITICAL RULES:
1. If ANY person name appears (Tyler, Randy, Robert, etc.) → likely SINGLE_MEETING
2. If ANY company name appears (Les Schwab, ACE, Walmart, etc.) → likely SINGLE_MEETING
3. "What did X say/mention/ask" → SINGLE_MEETING
4. "Find all" or "across meetings" → MULTI_MEETING
5. "How does PitCrew work" or "pricing" → PRODUCT_KNOWLEDGE
6. When in doubt between SINGLE_MEETING and GENERAL_HELP → choose SINGLE_MEETING

EXAMPLES:
- "What did Les Schwab say about the dashboard?" → SINGLE_MEETING
- "What did Tyler Wiggins mention about pricing?" → SINGLE_MEETING  
- "Find all meetings that mention Walmart" → MULTI_MEETING
- "What is PitCrew pricing?" → PRODUCT_KNOWLEDGE
- "Does PitCrew integrate with POS?" → PRODUCT_KNOWLEDGE
- "What's the weather?" → REFUSE
- "Summarize the meeting and email it" → CLARIFY (needs split)

Respond with JSON: {"intent": "INTENT_NAME", "confidence": 0.0-1.0, "reason": "brief explanation"}`;

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

export async function classifyIntent(question: string): Promise<IntentClassificationResult> {
  const keywordResult = classifyByKeyword(question);
  
  if (keywordResult) {
    console.log(`[IntentClassifier] Keyword match: ${keywordResult.intent}`);
    return keywordResult;
  }

  console.log(`[IntentClassifier] No keyword match, using LLM fallback`);
  return classifyByLLM(question);
}
