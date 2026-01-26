/**
 * Intent Classification System
 * 
 * Purpose:
 * Canonical intent enum that determines what data scopes are allowed.
 * Intent is immutable once classified - cannot be changed later in pipeline.
 * 
 * Classification Strategy:
 * 1. Keyword fast-paths for common patterns (no LLM cost)
 * 2. LLM fallback for ambiguous queries
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
}

export type IntentDetectionMethod = "keyword" | "llm" | "default";

export type IntentClassificationResult = {
  intent: Intent;
  intentDetectionMethod: IntentDetectionMethod;
  confidence: number;
  reason?: string;
};

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
];

const MULTI_MEETING_KEYWORDS = [
  "across meetings",
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
];

const PRODUCT_KNOWLEDGE_KEYWORDS = [
  "what is pitcrew",
  "what does pitcrew do",
  "pitcrew features",
  "product features",
  "capabilities",
  "what can pitcrew",
  "does pitcrew support",
  "pitcrew pricing",
  "pro tier",
  "advanced tier",
  "enterprise tier",
  "value proposition",
  "how does pitcrew",
  "pitcrew integrations",
];

const DOCUMENT_SEARCH_KEYWORDS = [
  "in the documents",
  "documentation",
  "spec",
  "specification",
  "wiki",
  "knowledge base",
  "reference doc",
];

const GENERAL_HELP_KEYWORDS = [
  "help",
  "how do i",
  "what can you do",
  "commands",
  "usage",
  "hello",
  "hi",
  "hey",
  "thanks",
  "thank you",
];

function matchesKeywords(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some(kw => lower.includes(kw));
}

function classifyByKeyword(question: string): IntentClassificationResult | null {
  const lower = question.toLowerCase();

  if (matchesKeywords(lower, SINGLE_MEETING_KEYWORDS)) {
    return {
      intent: Intent.SINGLE_MEETING,
      intentDetectionMethod: "keyword",
      confidence: 0.9,
      reason: "Matched single-meeting keyword pattern",
    };
  }

  if (matchesKeywords(lower, MULTI_MEETING_KEYWORDS)) {
    return {
      intent: Intent.MULTI_MEETING,
      intentDetectionMethod: "keyword",
      confidence: 0.9,
      reason: "Matched multi-meeting keyword pattern",
    };
  }

  if (matchesKeywords(lower, PRODUCT_KNOWLEDGE_KEYWORDS)) {
    return {
      intent: Intent.PRODUCT_KNOWLEDGE,
      intentDetectionMethod: "keyword",
      confidence: 0.9,
      reason: "Matched product knowledge keyword pattern",
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

  if (matchesKeywords(lower, GENERAL_HELP_KEYWORDS)) {
    return {
      intent: Intent.GENERAL_HELP,
      intentDetectionMethod: "keyword",
      confidence: 0.85,
      reason: "Matched general help keyword pattern",
    };
  }

  return null;
}

async function classifyByLLM(question: string): Promise<IntentClassificationResult> {
  const systemPrompt = `You are an intent classifier for a sales/product assistant.

Classify the user's question into exactly one of these intents:
- SINGLE_MEETING: Questions about a specific meeting (action items, attendees, what was discussed, customer questions from a particular call)
- MULTI_MEETING: Questions spanning multiple meetings (trends, patterns, aggregate data, comparisons)
- PRODUCT_KNOWLEDGE: Questions about PitCrew product features, capabilities, pricing tiers
- DOCUMENT_SEARCH: Questions about reference documentation or specs
- GENERAL_HELP: Greetings, meta questions about the assistant, or unclear requests

Priority order (when ambiguous):
1. SINGLE_MEETING (if any temporal reference or meeting context)
2. PRODUCT_KNOWLEDGE (if asking about product capabilities)
3. MULTI_MEETING (if explicitly asking for cross-meeting data)
4. DOCUMENT_SEARCH (if asking about docs)
5. GENERAL_HELP (fallback)

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
      return {
        intent: Intent.GENERAL_HELP,
        intentDetectionMethod: "default",
        confidence: 0.5,
        reason: "LLM returned empty response",
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

    return {
      intent: Intent.GENERAL_HELP,
      intentDetectionMethod: "default",
      confidence: 0.5,
      reason: "LLM returned invalid intent",
    };
  } catch (error) {
    console.error("[IntentClassifier] LLM error:", error);
    return {
      intent: Intent.GENERAL_HELP,
      intentDetectionMethod: "default",
      confidence: 0.5,
      reason: "LLM classification failed",
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
