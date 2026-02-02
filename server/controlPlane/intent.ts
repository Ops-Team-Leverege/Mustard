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
import { MODEL_ASSIGNMENTS } from "../config/models";
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

export type IntentDetectionMethod = "keyword" | "pattern" | "entity" | "llm" | "llm_validated" | "default" | "follow_up_detection";

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
    proposedContract: ContractString;
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
 */
export type ProposedInterpretation = {
  intent: IntentString;
  contract: ContractString;
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
  "all calls",
  "all recent calls",
  "recent calls",
  "all recent meetings",
  "recent meetings",
  "trend",
  "over time",
  "historically",
  "patterns",
  "how many times",
  "common questions",
  "recurring",
  "aggregate",
  "summary of all",
  "compare meetings",
  "find all",
  "search for",
  "search all",
  "search across",
  "which meetings",
  "which calls",
  "every meeting",
  "every call",
  "any meetings",
  "any calls",
  "meetings that mention",
  "calls that mention",
  "who asked about",
  "everyone who",
];

const PRODUCT_KNOWLEDGE_KEYWORDS = [
  // FAQ and content updates (prioritize over meeting patterns)
  "frequently asked questions",
  "faq",
  "faqs",
  "update the faq",
  "update our faq",
  "update copy",
  "updating copy",
  "website copy",
  "value props",
  "value propositions",
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

const EXTERNAL_RESEARCH_KEYWORDS = [
  // Company research
  "do research on",
  "research on",
  "research that customer",
  "recent earnings",
  "earnings call",
  "public statements",
  "their priorities",
  "their strategic",
  "competitor research",
  "company research",
  "find out their",
  "find out about",
  "look up",
  // Presentation creation
  "slide deck for",
  "sales deck for",
  "pitch deck for",
  "presentation for",
  // Topic/concept research (not just companies)
  "do research to understand",
  "research to understand",
  "understand more about",
  "learn more about",
  "industry trends",
  "industry practices",
  "industry standards",
  "best practices for",
  "market research",
  "how do they",
  "why do they",
  "what is the purpose of",
  "what are the benefits of",
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
  /\bsearch\s+all\s+(recent\s+)?(calls?|meetings?)\b/i,
  /\b(all|recent)\s+(calls?|meetings?)\b.*\b(mention|about|discuss)\b/i,
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

const EXTERNAL_RESEARCH_PATTERNS = [
  // Company-specific research
  /\bdo\s+research\s+on\s+(that\s+)?(customer|company|prospect)\b/i,
  /\bresearch\s+(on\s+)?[\w\s]+\s+(to\s+find|including|and)\b/i,
  /\b(recent\s+)?earnings\s+(calls?|reports?)\b/i,
  /\bpublic\s+statements?\b/i,
  /\b(their|company'?s?)\s+(priorities|strategy|strategic)\b/i,
  /\bcreating\s+a\s+(slide|sales|pitch)\s+deck\s+for\b/i,
  /\bslide\s+deck\s+for\s+[\w\s]+\s+to\s+sell\b/i,
  /\bselling?\s+(to|their)\s+(leadership|team|executive)\b/i,
  /\bresearch\s+(the\s+)?(company|website|site|business)\b/i,
  /\b(competitor|competitive)\s+(analysis|research|comparison)\b/i,
  /\banalyze\s+(their|the)\s+(company|business|offerings?)\b/i,
  /\bwhat\s+(does|do)\s+[\w\s]+\s+(company\s+)?(do|offer|sell)\b/i,
  /\b(their|the\s+company'?s?)\s+(website|site|business|offerings?)\b/i,
  // Topic/concept research (not just companies)
  /\bdo\s+research\s+to\s+understand\b/i,
  /\bresearch\s+to\s+understand\s+more\b/i,
  /\bunderstand\s+more\s+about\s+[\w\s]+\s+(and|why|how)\b/i,
  /\bwhy\s+(do|are)\s+[\w\s]+\s+(use|used|important|needed)\b/i,
  /\bhow\s+(do|does|are)\s+[\w\s]+\s+(shops?|stores?|businesses?)\s+(use|handle|manage)\b/i,
  /\bwhat\s+(is|are)\s+(the\s+)?(purpose|benefit|reason)\s+of\b/i,
  /\bindustry\s+(practices?|standards?|trends?|norms?)\b/i,
  /\b(best|common)\s+practices?\s+(for|in|at)\b/i,
  // Research + Write pattern (critical for feature descriptions)
  /\bresearch[\w\s]+then\s+write\b/i,
  /\bdo\s+research[\w\s]+write\s+(a|the)\s+(description|feature)\b/i,
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

async function containsKnownCompany(text: string): Promise<string | null> {
  const lower = text.toLowerCase();
  const companies = await getKnownCompanies();
  for (const company of companies) {
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
  const intentMap: Record<string, Intent> = {
    "EXTERNAL_RESEARCH": Intent.EXTERNAL_RESEARCH,
    "SINGLE_MEETING": Intent.SINGLE_MEETING,
    "PRODUCT_KNOWLEDGE": Intent.PRODUCT_KNOWLEDGE,
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

  // EARLY CHECK: Detect follow-up/refinement messages that need thread context
  // These are short messages that refine a previous request
  const followUpResult = detectFollowUpMessage(question, threadContext);
  if (followUpResult) {
    console.log(`[IntentClassifier] Follow-up message detected: "${followUpResult.reason}"`);
    return followUpResult;
  }

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

  // HARDENING: Single-Intent Invariant Enforcement with Decision-Time Reasoning
  // Count how many distinct intent categories match to detect ambiguity
  // Also track which patterns matched for observability
  const matchingIntents: Intent[] = [];
  const matchedSignals: string[] = [];
  const rejectedIntents: Array<{ intent: Intent; reason: string }> = [];
  
  // Check MULTI_MEETING patterns
  const multiMeetingPatternMatch = matchesPatterns(question, MULTI_MEETING_PATTERNS);
  const multiMeetingKeywordMatch = matchesKeywords(lower, MULTI_MEETING_KEYWORDS);
  if (multiMeetingPatternMatch || multiMeetingKeywordMatch) {
    matchingIntents.push(Intent.MULTI_MEETING);
    matchedSignals.push(multiMeetingPatternMatch ? "multi_meeting_pattern" : "multi_meeting_keyword");
  }
  
  // Check SINGLE_MEETING patterns
  const singleMeetingPatternMatch = matchesPatterns(question, SINGLE_MEETING_PATTERNS);
  const singleMeetingKeywordMatch = matchesKeywords(lower, SINGLE_MEETING_KEYWORDS);
  if (singleMeetingPatternMatch || singleMeetingKeywordMatch) {
    matchingIntents.push(Intent.SINGLE_MEETING);
    matchedSignals.push(singleMeetingPatternMatch ? "single_meeting_pattern" : "single_meeting_keyword");
  }
  
  // Check PRODUCT_KNOWLEDGE patterns
  const productPatternMatch = matchesPatterns(question, PRODUCT_KNOWLEDGE_PATTERNS);
  const productKeywordMatch = matchesKeywords(lower, PRODUCT_KNOWLEDGE_KEYWORDS);
  if (productPatternMatch || productKeywordMatch) {
    matchingIntents.push(Intent.PRODUCT_KNOWLEDGE);
    matchedSignals.push(productPatternMatch ? "product_pattern" : "product_keyword");
  }
  
  // Check EXTERNAL_RESEARCH patterns (URL detection, website analysis)
  const externalResearchPatternMatch = matchesPatterns(question, EXTERNAL_RESEARCH_PATTERNS);
  const externalResearchKeywordMatch = matchesKeywords(lower, EXTERNAL_RESEARCH_KEYWORDS);
  if (externalResearchPatternMatch || externalResearchKeywordMatch) {
    matchingIntents.push(Intent.EXTERNAL_RESEARCH);
    matchedSignals.push(externalResearchPatternMatch ? "external_research_pattern" : "external_research_keyword");
  }
  
  // HARDENING: If multiple mutually exclusive intents match → CLARIFY (single-intent invariant)
  // MULTI_MEETING and SINGLE_MEETING are mutually exclusive
  // PRODUCT_KNOWLEDGE with MEETING intents is ambiguous
  // EXCEPTION: EXTERNAL_RESEARCH + PRODUCT_KNOWLEDGE → EXTERNAL_RESEARCH wins (chains product knowledge automatically)
  if (matchingIntents.length > 1) {
    // Special case: EXTERNAL_RESEARCH + PRODUCT_KNOWLEDGE → EXTERNAL_RESEARCH wins
    // This is because EXTERNAL_RESEARCH automatically chains product knowledge for comparison
    if (matchingIntents.length === 2 && 
        matchingIntents.includes(Intent.EXTERNAL_RESEARCH) && 
        matchingIntents.includes(Intent.PRODUCT_KNOWLEDGE)) {
      console.log(`[IntentClassifier] EXTERNAL_RESEARCH + PRODUCT_KNOWLEDGE → EXTERNAL_RESEARCH wins (auto-chains product knowledge)`);
      return {
        intent: Intent.EXTERNAL_RESEARCH,
        intentDetectionMethod: "pattern",
        confidence: 0.9,
        reason: "EXTERNAL_RESEARCH with URL/website analysis (will chain product knowledge for comparison)",
        decisionMetadata: {
          matchedSignals,
          rejectedIntents: [{ intent: Intent.PRODUCT_KNOWLEDGE, reason: "subsumed by EXTERNAL_RESEARCH chain" }],
        },
      };
    }
    
    console.log(`[IntentClassifier] HARDENING: Single-intent invariant violation detected. Matched: ${matchingIntents.join(", ")}, Signals: ${matchedSignals.join(", ")}`);
    return {
      intent: Intent.CLARIFY,
      intentDetectionMethod: "pattern",
      confidence: 0,
      reason: `Multiple intents matched (${matchingIntents.join(", ")}) - clarification needed`,
      decisionMetadata: {
        singleIntentViolation: true,
        matchedSignals,
        rejectedIntents: matchingIntents.map(i => ({ intent: i, reason: "ambiguous: multiple intents matched" })),
      },
    };
  }
  
  // If exactly one intent matched, log rejected intents for observability
  if (matchingIntents.length === 1) {
    const selectedIntent = matchingIntents[0];
    
    // Track which intents were NOT matched (rejected)
    if (selectedIntent !== Intent.MULTI_MEETING && !multiMeetingPatternMatch && !multiMeetingKeywordMatch) {
      rejectedIntents.push({ intent: Intent.MULTI_MEETING, reason: "no multi-meeting patterns/keywords matched" });
    }
    if (selectedIntent !== Intent.SINGLE_MEETING && !singleMeetingPatternMatch && !singleMeetingKeywordMatch) {
      rejectedIntents.push({ intent: Intent.SINGLE_MEETING, reason: "no single-meeting patterns/keywords matched" });
    }
    if (selectedIntent !== Intent.PRODUCT_KNOWLEDGE && !productPatternMatch && !productKeywordMatch) {
      rejectedIntents.push({ intent: Intent.PRODUCT_KNOWLEDGE, reason: "no product-knowledge patterns/keywords matched" });
    }
    if (selectedIntent !== Intent.EXTERNAL_RESEARCH && !externalResearchPatternMatch && !externalResearchKeywordMatch) {
      rejectedIntents.push({ intent: Intent.EXTERNAL_RESEARCH, reason: "no external-research patterns/keywords matched" });
    }
    
    console.log(`[IntentClassifier] Decision: ${selectedIntent} (signals: ${matchedSignals.join(", ")})`);
    return {
      intent: selectedIntent,
      intentDetectionMethod: "pattern",
      confidence: 0.9,
      reason: `Matched ${selectedIntent} pattern`,
      decisionMetadata: {
        matchedSignals,
        rejectedIntents,
      },
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
  const company = await containsKnownCompany(question);
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
- EXTERNAL_RESEARCH: Requests requiring PUBLIC/WEB information - either about external companies (earnings calls, news, priorities) OR about topics/concepts/industry practices that need web research (e.g., "research oil change shop safety practices", "understand more about tire shop workflows"). The PRIMARY focus is researching something EXTERNAL to our meeting data and product knowledge.
- GENERAL_HELP: Greetings, meta questions, general assistance requests
- REFUSE: Out-of-scope (weather, stock prices, personal info, jokes)
- CLARIFY: Request is genuinely ambiguous about what the user wants

CRITICAL RULES:
1. If ANY person name appears (Tyler, Randy, Robert, etc.) → likely SINGLE_MEETING
2. If ANY company name appears in context of "our meeting with X" → likely SINGLE_MEETING
3. "What did X say/mention/ask" → SINGLE_MEETING
4. "Find all" or "across meetings" → MULTI_MEETING
5. "How does PitCrew work" or "pricing" → PRODUCT_KNOWLEDGE
6. "Research X company" or "earnings calls" or "their priorities" → EXTERNAL_RESEARCH
7. "Slide deck for X" or "pitch deck for X" with external company → EXTERNAL_RESEARCH
8. "Research [topic] to understand" or "learn about [industry practice]" → EXTERNAL_RESEARCH
9. Focus on the PRIMARY ask - what information source is needed? Past meetings? External research? Product docs?
10. PRODUCT_KNOWLEDGE is always available as a follow-up. If request combines EXTERNAL_RESEARCH + "connect to PitCrew offerings" → classify as EXTERNAL_RESEARCH (product info will be added automatically)
11. When in doubt between SINGLE_MEETING and GENERAL_HELP → choose SINGLE_MEETING

EXAMPLES:
- "What did Les Schwab say about the dashboard?" → SINGLE_MEETING
- "What did Tyler Wiggins mention about pricing?" → SINGLE_MEETING  
- "Find all meetings that mention Walmart" → MULTI_MEETING
- "What is PitCrew pricing?" → PRODUCT_KNOWLEDGE
- "Does PitCrew integrate with POS?" → PRODUCT_KNOWLEDGE
- "Research Costco and their priorities" → EXTERNAL_RESEARCH
- "Create a slide deck for Costco leadership" → EXTERNAL_RESEARCH
- "Research Costco, find priorities, create slides for them" → EXTERNAL_RESEARCH (primary: external research)
- "Find their recent earnings calls" → EXTERNAL_RESEARCH
- "Research oil change shops and safety nets to understand why they're important" → EXTERNAL_RESEARCH (topic research, not company)
- "Do research to understand tire shop workflows, then write a feature description" → EXTERNAL_RESEARCH (research + write)
- "Learn more about automotive bay design and best practices" → EXTERNAL_RESEARCH (industry practices)
- "What's the weather?" → REFUSE

Respond with JSON: {"intent": "INTENT_NAME", "confidence": 0.0-1.0, "reason": "brief explanation"}`;

  try {
    const response = await openai.chat.completions.create({
      model: MODEL_ASSIGNMENTS.INTENT_CLASSIFICATION,
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

// Low-confidence threshold for LLM validation
const LOW_CONFIDENCE_THRESHOLD = 0.88;

// Detection methods that are considered "weak" and need validation
const WEAK_DETECTION_METHODS = ["keyword", "entity"];

function needsLLMValidation(result: IntentClassificationResult): boolean {
  // High-confidence pattern matches don't need validation
  if (result.intentDetectionMethod === "pattern" && result.confidence >= 0.9) {
    return false;
  }
  
  // CLARIFY and REFUSE intents don't need validation
  if (result.intent === Intent.CLARIFY || result.intent === Intent.REFUSE) {
    return false;
  }
  
  // Weak detection methods need validation
  if (WEAK_DETECTION_METHODS.includes(result.intentDetectionMethod)) {
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
 * - Override Control Plane rules
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
