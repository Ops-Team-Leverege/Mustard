/**
 * External Research Handler
 * 
 * Purpose:
 * Fetches public information about companies/topics using real web search
 * and synthesizes results with explicit citations.
 * 
 * Key Principles:
 * - Uses Perplexity API for real web search with citations
 * - Uses GPT-5 for research synthesis (reasoning-grade model required)
 * - Returns structured citations (source, URL, date, snippet)
 * - Clearly separated from meeting data paths
 * - Priority is explicit citations, not perfect coverage
 */

import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;

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
 * Perform external research using web search and synthesize with citations.
 */
export async function performExternalResearch(
  query: string,
  companyName?: string | null,
  topic?: string | null
): Promise<ResearchResult> {
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
    return {
      answer: "I wasn't able to find relevant public information on this topic. Would you like me to try a different approach?",
      citations: [],
      searchQueries,
      confidence: "low",
      disclaimer: "No search results found.",
    };
  }

  const deduped = deduplicateResults(allResults);
  const synthesized = await synthesizeResearch(query, deduped);
  
  return {
    ...synthesized,
    searchQueries,
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
 * Perplexity API response type
 */
type PerplexityResponse = {
  id: string;
  model: string;
  citations?: string[];
  choices: {
    index: number;
    finish_reason: string;
    message: {
      role: string;
      content: string;
    };
  }[];
};

/**
 * Execute a web search query using Perplexity API.
 * Returns real citations from web sources.
 */
async function executeWebSearch(query: string): Promise<WebSearchResult[]> {
  console.log(`[ExternalResearch] Executing web search: "${query}"`);
  
  if (!PERPLEXITY_API_KEY) {
    console.warn("[ExternalResearch] PERPLEXITY_API_KEY not configured - external research disabled");
    return [];
  }
  
  try {
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.1-sonar-small-128k-online",
        messages: [
          {
            role: "system",
            content: "You are a research assistant. Provide factual, well-sourced information. Be precise and concise.",
          },
          {
            role: "user",
            content: query,
          },
        ],
        temperature: 0.2,
        return_related_questions: false,
        search_recency_filter: "month",
        stream: false,
      }),
    });

    if (!response.ok) {
      console.error(`[ExternalResearch] Perplexity API error: ${response.status} ${response.statusText}`);
      return [];
    }

    const data: PerplexityResponse = await response.json();
    const content = data.choices[0]?.message?.content || "";
    const citations = data.citations || [];
    
    return citations.map((url, i) => ({
      title: extractDomainFromUrl(url),
      url,
      snippet: i === 0 ? content.substring(0, 300) : "",
      date: undefined,
    }));
  } catch (err) {
    console.error("[ExternalResearch] Web search failed:", err);
    return [];
  }
}

/**
 * Extract domain name from URL for display.
 */
function extractDomainFromUrl(url: string): string {
  try {
    const domain = new URL(url).hostname.replace("www.", "");
    return domain.charAt(0).toUpperCase() + domain.slice(1);
  } catch {
    return "Web Source";
  }
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
