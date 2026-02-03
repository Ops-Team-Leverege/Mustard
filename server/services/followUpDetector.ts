/**
 * Follow-Up Detection Service
 * 
 * Detects when a user message is a refinement of a previous request
 * (e.g., "make it shorter", "try again", "too long").
 * 
 * Design:
 * - Configurable pattern rules (not hardcoded)
 * - Extensible intent inference from bot responses
 * - Separated from intent classification for testability
 */

export interface ThreadContextForFollowUp {
  messages: Array<{
    text: string;
    isBot: boolean;
  }>;
}

export interface FollowUpResult {
  isFollowUp: true;
  inferredIntentKey: string;
  reason: string;
  previousBotSnippet: string;
  confidence: number;
}

interface PatternRule {
  pattern: RegExp;
  description: string;
}

interface IntentInferenceRule {
  markers: string[];
  intentKey: string;
  description: string;
}

const defaultPatternRules: PatternRule[] = [
  { pattern: /^(make\s+it|can\s+you\s+make\s+it)\s+(shorter|longer|more\s+concise|simpler|clearer)/i, description: "make it X" },
  { pattern: /^(too\s+)?(long|short|verbose|wordy|brief)/i, description: "too X / X feedback" },
  { pattern: /^(better|good|nice),?\s+but\s+(too|a\s+bit|still)/i, description: "good but X" },
  { pattern: /^try\s+(again|once\s+more)/i, description: "try again" },
  { pattern: /^(more|less)\s+(concise|detailed|verbose|brief)/i, description: "more/less X" },
  { pattern: /^(shorten|expand|simplify|clarify)\s+(it|this|that)/i, description: "action it" },
  { pattern: /^(that'?s?|this\s+is)\s+(too|not)/i, description: "that's too X" },
  { pattern: /^not\s+quite/i, description: "not quite" },
  { pattern: /^(tweak|adjust|refine|revise)\s+(it|this|that)/i, description: "tweak it" },
  { pattern: /^can\s+you\s+(redo|rewrite|revise)/i, description: "can you redo" },
  // Modification requests - asking to add/include/change something in the previous output
  { pattern: /^can\s+you\s+(include|add|also\s+show|also\s+include|put\s+in)/i, description: "can you include X" },
  { pattern: /^(include|add)\s+(the|their|customer|company)/i, description: "include the X" },
  { pattern: /^(also|and)\s+(include|add|show)/i, description: "also include X" },
  { pattern: /^(what\s+about|how\s+about)\s+(adding|including)/i, description: "what about adding X" },
  { pattern: /^(could\s+you|would\s+you)\s+(add|include)/i, description: "could you add X" },
];

const defaultIntentInferenceRules: IntentInferenceRule[] = [
  { 
    markers: ["feature description", "description:", "**net safety", "research report", "researching"], 
    intentKey: "EXTERNAL_RESEARCH", 
    description: "External research / feature description" 
  },
  { 
    markers: ["meeting", "they said", "action items", "next steps", "discussed", "mentioned"], 
    intentKey: "SINGLE_MEETING", 
    description: "Meeting-related task" 
  },
  { 
    markers: ["pitcrew pricing", "pitcrew feature", "integration", "product knowledge", "pitcrew can", "our approach"], 
    intentKey: "PRODUCT_KNOWLEDGE", 
    description: "Product knowledge task" 
  },
  {
    markers: ["across", "meetings", "companies", "calls", "themes", "pattern analysis", "summary of recent", "customer themes"],
    intentKey: "MULTI_MEETING",
    description: "Multi-meeting analysis"
  },
  {
    markers: ["document", "contract", "spec", "pdf", "file", "attachment", "deck", "presentation"],
    intentKey: "DOCUMENT_SEARCH",
    description: "Document search task"
  },
  {
    markers: ["draft", "email", "write", "compose", "help you", "assist"],
    intentKey: "GENERAL_HELP",
    description: "General assistance task"
  },
];

let patternRules = [...defaultPatternRules];
let intentInferenceRules = [...defaultIntentInferenceRules];

/**
 * Register additional follow-up patterns at runtime.
 */
export function registerFollowUpPatterns(rules: PatternRule[]): void {
  patternRules.push(...rules);
}

/**
 * Register additional intent inference rules at runtime.
 */
export function registerIntentInferenceRules(rules: IntentInferenceRule[]): void {
  intentInferenceRules.push(...rules);
}

/**
 * Reset to default rules (useful for testing).
 */
export function resetToDefaults(): void {
  patternRules = [...defaultPatternRules];
  intentInferenceRules = [...defaultIntentInferenceRules];
}

/**
 * Get currently registered pattern count (for testing/monitoring).
 */
export function getPatternCount(): number {
  return patternRules.length;
}

/**
 * Detect if a message is a follow-up refinement.
 * Returns null if not a follow-up.
 */
export function detectFollowUp(
  message: string,
  threadContext?: ThreadContextForFollowUp
): FollowUpResult | null {
  if (!threadContext?.messages || threadContext.messages.length < 2) {
    return null;
  }

  const lower = message.toLowerCase().trim();

  const matchedPattern = patternRules.find(rule => rule.pattern.test(lower));
  if (!matchedPattern) {
    return null;
  }

  const lastBotMessage = threadContext.messages
    .slice()
    .reverse()
    .find(m => m.isBot);

  if (!lastBotMessage) {
    return null;
  }

  const botText = lastBotMessage.text.toLowerCase();

  let inferredIntentKey = "GENERAL_HELP";
  let inferredDescription = "General follow-up";

  for (const rule of intentInferenceRules) {
    if (rule.markers.some(marker => botText.includes(marker))) {
      inferredIntentKey = rule.intentKey;
      inferredDescription = rule.description;
      break;
    }
  }

  console.log(`[FollowUpDetector] Detected: "${matchedPattern.description}" → ${inferredIntentKey}`);

  return {
    isFollowUp: true,
    inferredIntentKey,
    reason: `Follow-up (${matchedPattern.description}) to ${inferredDescription}`,
    previousBotSnippet: botText.slice(0, 100),
    confidence: 0.85,
  };
}
