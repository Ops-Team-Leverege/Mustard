/**
 * Semantic Artifact Search
 * 
 * Purpose:
 * Searches over deterministic meeting artifacts (customer_questions, meeting_action_items,
 * meeting_summaries) using semantic similarity.
 * 
 * Key Principles:
 * - Only invoked AFTER intent indicates meeting relevance
 * - Operates over existing tables only - never re-derives from transcripts
 * - Does not generate new artifacts
 * - Uses semantic matching to group/filter by topic
 */

import { storage } from "../storage";
import { OpenAI } from "openai";
import type { CustomerQuestion, MeetingActionItem, Product } from "@shared/schema";
import { MODEL_ASSIGNMENTS } from "../config/models";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export type SemanticMatch<T> = {
  item: T;
  relevanceScore: number;
  matchReason: string;
};

export type ArtifactSearchResult = {
  customerQuestions: SemanticMatch<CustomerQuestion>[];
  actionItems: SemanticMatch<MeetingActionItem>[];
  summaryRelevant: boolean;
  summaryMatch?: {
    content: string;
    matchReason: string;
  };
  searchTopic: string;
  totalMatches: number;
};

/**
 * Search meeting artifacts semantically for a given topic/query.
 * 
 * @param transcriptId - The meeting/transcript to search within
 * @param query - The user's question or topic to search for
 * @param limit - Maximum number of results per artifact type (default: 10)
 */
export async function searchArtifactsSemanticly(
  transcriptId: string,
  query: string,
  limit: number = 10
): Promise<ArtifactSearchResult> {
  const transcript = await storage.getTranscriptById(transcriptId);
  if (!transcript) {
    return emptyResult(query);
  }

  const [customerQuestions, actionItems] = await Promise.all([
    storage.getCustomerQuestionsByTranscript(transcriptId),
    storage.getMeetingActionItemsByTranscript(transcriptId),
  ]);

  const searchTopic = extractSearchTopic(query);
  
  const [questionMatches, actionMatches] = await Promise.all([
    rankByRelevance(customerQuestions, searchTopic, "customer_question"),
    rankByRelevance(actionItems, searchTopic, "action_item"),
  ]);

  const summaryContent = transcript.mainMeetingTakeaways;
  let summaryMatch: ArtifactSearchResult["summaryMatch"];
  
  if (summaryContent) {
    const summaryRelevance = await checkSummaryRelevance(summaryContent, searchTopic);
    if (summaryRelevance.isRelevant) {
      summaryMatch = {
        content: summaryContent,
        matchReason: summaryRelevance.reason,
      };
    }
  }

  return {
    customerQuestions: questionMatches.slice(0, limit),
    actionItems: actionMatches.slice(0, limit),
    summaryRelevant: Boolean(summaryMatch),
    summaryMatch,
    searchTopic,
    totalMatches: questionMatches.length + actionMatches.length + (summaryMatch ? 1 : 0),
  };
}

/**
 * Search artifacts across multiple meetings for a company.
 */
export async function searchArtifactsAcrossMeetings(
  companyId: string,
  query: string,
  product: Product = "PitCrew",
  limit: number = 10
): Promise<ArtifactSearchResult[]> {
  const transcripts = await storage.getTranscriptsByCompany(product, companyId);
  
  const results = await Promise.all(
    transcripts.map(t => searchArtifactsSemanticly(t.id, query, limit))
  );

  return results.filter(r => r.totalMatches > 0);
}

/**
 * Extract the core search topic from a user query.
 */
function extractSearchTopic(query: string): string {
  const cleanQuery = query
    .replace(/\bwhat\s+(did|were|are|was)\b/gi, "")
    .replace(/\bthe\s+customer\s+(ask|asked|say|said)\s+about\b/gi, "")
    .replace(/\bquestions?\s+about\b/gi, "")
    .replace(/\baction\s+items?\s+(?:about|for|on)\b/gi, "")
    .replace(/\bin\s+the\s+(meeting|call|transcript)\b/gi, "")
    .replace(/[?.,!]/g, "")
    .trim();
  
  return cleanQuery || query;
}

/**
 * Rank items by semantic relevance to the topic.
 */
async function rankByRelevance<T extends CustomerQuestion | MeetingActionItem>(
  items: T[],
  topic: string,
  itemType: "customer_question" | "action_item"
): Promise<SemanticMatch<T>[]> {
  if (items.length === 0) return [];

  const itemTexts = items.map(item => {
    if (itemType === "customer_question") {
      return (item as CustomerQuestion).questionText;
    } else {
      return (item as MeetingActionItem).actionText;
    }
  });

  const response = await openai.chat.completions.create({
    model: MODEL_ASSIGNMENTS.ARTIFACT_SEARCH,
    messages: [
      {
        role: "system",
        content: `You are a semantic matching assistant. Given a search topic and a list of items, rate each item's relevance to the topic on a scale of 0-100.

Return a JSON object with:
{
  "rankings": [
    { "index": 0, "score": 85, "reason": "Directly mentions pricing" },
    { "index": 1, "score": 20, "reason": "Unrelated to topic" },
    ...
  ]
}

RULES:
- Score 80-100: Directly about the topic
- Score 50-79: Related but not directly about the topic
- Score 20-49: Tangentially related
- Score 0-19: Not related
- Be strict - only give high scores for clear matches`,
      },
      {
        role: "user",
        content: `Topic: "${topic}"\n\nItems:\n${itemTexts.map((t, i) => `[${i}] ${t}`).join("\n")}`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) return [];

  try {
    const parsed = JSON.parse(content);
    const rankings = parsed.rankings || [];
    
    return rankings
      .filter((r: any) => r.score >= 50)
      .sort((a: any, b: any) => b.score - a.score)
      .map((r: any) => ({
        item: items[r.index],
        relevanceScore: r.score / 100,
        matchReason: r.reason || "Matched topic",
      }));
  } catch (err) {
    console.error("[SemanticArtifactSearch] Failed to parse rankings:", err);
    return [];
  }
}

/**
 * Check if a meeting summary is relevant to the search topic.
 */
async function checkSummaryRelevance(
  summaryContent: string,
  topic: string
): Promise<{ isRelevant: boolean; reason: string }> {
  const response = await openai.chat.completions.create({
    model: MODEL_ASSIGNMENTS.ARTIFACT_SEARCH,
    messages: [
      {
        role: "system",
        content: `Determine if the following meeting summary contains information relevant to the search topic.

Return JSON: { "isRelevant": true/false, "reason": "Brief explanation" }`,
      },
      {
        role: "user",
        content: `Topic: "${topic}"\n\nSummary:\n${summaryContent}`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) return { isRelevant: false, reason: "Could not evaluate" };

  try {
    const parsed = JSON.parse(content);
    return {
      isRelevant: Boolean(parsed.isRelevant),
      reason: parsed.reason || "No reason provided",
    };
  } catch {
    return { isRelevant: false, reason: "Parse error" };
  }
}

function emptyResult(topic: string): ArtifactSearchResult {
  return {
    customerQuestions: [],
    actionItems: [],
    summaryRelevant: false,
    searchTopic: topic,
    totalMatches: 0,
  };
}

/**
 * Format artifact search results for display.
 */
export function formatArtifactResults(result: ArtifactSearchResult): string {
  const parts: string[] = [];

  if (result.customerQuestions.length > 0) {
    parts.push("*Customer Questions:*");
    result.customerQuestions.forEach((m, i) => {
      const q = m.item;
      const status = q.status === "ANSWERED" ? "answered" : q.status.toLowerCase();
      parts.push(`${i + 1}. "${q.questionText}" (${status})`);
    });
  }

  if (result.actionItems.length > 0) {
    if (parts.length > 0) parts.push("");
    parts.push("*Action Items:*");
    result.actionItems.forEach((m, i) => {
      const a = m.item;
      parts.push(`${i + 1}. ${a.actionText} (Owner: ${a.ownerName})`);
    });
  }

  if (result.summaryMatch) {
    if (parts.length > 0) parts.push("");
    parts.push("*From Meeting Summary:*");
    parts.push(result.summaryMatch.content.substring(0, 500) + (result.summaryMatch.content.length > 500 ? "..." : ""));
  }

  if (parts.length === 0) {
    return `No matching artifacts found for "${result.searchTopic}".`;
  }

  return parts.join("\n");
}
