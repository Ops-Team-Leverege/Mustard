/**
 * External Research Handler
 * 
 * Purpose:
 * Handles requests for public information about companies/topics.
 * 
 * Current Implementation:
 * - Web search capability is not yet integrated
 * - Returns honest "not available" response when real research is needed
 * - Can provide general knowledge via GPT-5 (with clear disclaimer)
 * 
 * Future:
 * - Integrate web search API for real citations (source, URL, date, snippet)
 * - Clearly separated from meeting data paths
 * 
 * Key Principle:
 * Never fabricate citations - be honest about capabilities
 */

import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const WEB_SEARCH_AVAILABLE = false;

export type Citation = {
  source: string;
  url: string;
  date: string | null;
  snippet: string;
};

export type ResearchResult = {
  answer: string;
  citations: Citation[];
  searchQueries: string[];
  confidence: "high" | "medium" | "low";
  disclaimer?: string;
};

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  date?: string;
};

/**
 * Perform external research.
 * 
 * Current behavior: Web search is not yet available, so we provide
 * general knowledge with a clear disclaimer about limitations.
 */
export async function performExternalResearch(
  query: string,
  companyName?: string | null,
  topic?: string | null
): Promise<ResearchResult> {
  console.log(`[ExternalResearch] Research request: query="${query}", company="${companyName}", topic="${topic}"`);
  
  if (!WEB_SEARCH_AVAILABLE) {
    return provideGeneralKnowledge(query, companyName, topic);
  }
  
  const searchQueries = generateSearchQueries(query, companyName, topic);
  
  const allResults: WebSearchResult[] = [];
  for (const searchQuery of searchQueries) {
    try {
      const results = await executeWebSearch(searchQuery);
      allResults.push(...results);
    } catch (err) {
      console.error(`[ExternalResearch] Search failed for "${searchQuery}":`, err);
    }
  }

  if (allResults.length === 0) {
    return provideGeneralKnowledge(query, companyName, topic);
  }

  const deduped = deduplicateResults(allResults);
  const synthesized = await synthesizeResearch(query, deduped);
  
  return {
    ...synthesized,
    searchQueries,
  };
}

/**
 * Provide general knowledge when web search is not available.
 * Clearly disclaims that this is not cited research.
 */
async function provideGeneralKnowledge(
  query: string,
  companyName?: string | null,
  topic?: string | null
): Promise<ResearchResult> {
  console.log(`[ExternalResearch] Providing general knowledge (web search not available)`);
  
  const response = await openai.chat.completions.create({
    model: "gpt-5",
    messages: [
      {
        role: "system",
        content: `You are a helpful assistant providing general knowledge. The user asked a research question but web search is not currently available.

IMPORTANT RULES:
- Provide helpful general information based on your training data
- Be clear about limitations: your knowledge has a cutoff date and may be outdated
- NEVER fabricate specific citations, URLs, or sources
- If you're not confident about specific facts, say so
- Recommend the user verify important information from official sources`,
      },
      {
        role: "user",
        content: query,
      },
    ],
  });

  const answer = response.choices[0]?.message?.content || "I'm not able to provide information on this topic right now.";

  return {
    answer,
    citations: [],
    searchQueries: [],
    confidence: "low",
    disclaimer: "This response is based on general knowledge, not real-time web search. Please verify important information from official sources.",
  };
}

/**
 * Generate search queries based on the user's question and extracted entities.
 */
function generateSearchQueries(
  query: string,
  companyName?: string | null,
  topic?: string | null
): string[] {
  const queries: string[] = [];
  
  if (companyName && topic) {
    queries.push(`${companyName} ${topic}`);
    queries.push(`${companyName} latest news`);
  } else if (companyName) {
    queries.push(`${companyName} company overview`);
    queries.push(`${companyName} recent news`);
  } else if (topic) {
    queries.push(topic);
  } else {
    queries.push(query);
  }

  return queries.slice(0, 3);
}

/**
 * Web search is not yet integrated.
 * Returns empty results - caller should handle gracefully.
 */
async function executeWebSearch(query: string): Promise<WebSearchResult[]> {
  console.log(`[ExternalResearch] Web search requested: "${query}" (not available)`);
  return [];
}

/**
 * Remove duplicate results based on URL.
 */
function deduplicateResults(results: WebSearchResult[]): WebSearchResult[] {
  const seen = new Set<string>();
  return results.filter(r => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
}

/**
 * Synthesize research results into a coherent answer with citations.
 */
async function synthesizeResearch(
  originalQuery: string,
  results: WebSearchResult[]
): Promise<Omit<ResearchResult, "searchQueries">> {
  const resultsContext = results.map((r, i) => 
    `[${i + 1}] ${r.title}\nURL: ${r.url}\nDate: ${r.date || "Unknown"}\nContent: ${r.snippet}`
  ).join("\n\n");

  const response = await openai.chat.completions.create({
    model: "gpt-5",
    messages: [
      {
        role: "system",
        content: `You are a research synthesizer. Your job is to:
1. Answer the user's question using ONLY the provided search results
2. Cite your sources using [1], [2], etc. inline
3. Be explicit about what is known vs. unknown
4. If the results don't adequately answer the question, say so

Return a JSON object with:
{
  "answer": "Your synthesized answer with [1] inline citations",
  "citations": [
    {
      "source": "Publication name",
      "url": "https://...",
      "date": "2024-01-15 or null",
      "snippet": "Key evidence quoted from source"
    }
  ],
  "confidence": "high|medium|low",
  "disclaimer": "Optional note about limitations"
}

RULES:
- Never make claims not supported by the sources
- Always include inline citations [1], [2] in your answer
- If sources conflict, acknowledge the discrepancy
- If information is outdated or incomplete, note it in the disclaimer`,
      },
      {
        role: "user",
        content: `Question: ${originalQuery}\n\nSearch Results:\n${resultsContext}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    return {
      answer: "I found some information but wasn't able to synthesize it properly. Please try rephrasing your question.",
      citations: [],
      confidence: "low",
    };
  }

  try {
    const parsed = JSON.parse(content);
    return {
      answer: parsed.answer || "No answer generated",
      citations: (parsed.citations || []).map((c: any) => ({
        source: c.source || "Unknown",
        url: c.url || "",
        date: c.date || null,
        snippet: c.snippet || "",
      })),
      confidence: validateConfidence(parsed.confidence),
      disclaimer: parsed.disclaimer,
    };
  } catch (err) {
    console.error("[ExternalResearch] Failed to parse synthesis:", err);
    return {
      answer: "Research synthesis failed. Please try again.",
      citations: [],
      confidence: "low",
    };
  }
}

function validateConfidence(confidence: unknown): "high" | "medium" | "low" {
  const valid = ["high", "medium", "low"];
  return valid.includes(confidence as string) ? (confidence as "high" | "medium" | "low") : "medium";
}

/**
 * Format citations for display in Slack or other output.
 */
export function formatCitationsForDisplay(citations: Citation[]): string {
  if (citations.length === 0) return "";
  
  return "\n\n*Sources:*\n" + citations.map((c, i) => {
    const dateStr = c.date ? ` (${c.date})` : "";
    return `[${i + 1}] ${c.source}${dateStr}: ${c.url}`;
  }).join("\n");
}
