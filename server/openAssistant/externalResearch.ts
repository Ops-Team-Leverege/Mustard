/**
 * External Research Handler
 * 
 * Purpose:
 * Handles requests for public information about companies/topics using Gemini AI.
 * 
 * Implementation:
 * - Uses Gemini API for web-grounded research
 * - Returns structured research with sources and extraction date
 * - Designed for document output (sales prep, company research)
 * 
 * Key Principle:
 * Always include sources and extraction date for accountability
 */

import { GoogleGenAI } from "@google/genai";
import { OpenAI } from "openai";
import { MODEL_ASSIGNMENTS } from "../config/models";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[ExternalResearch] GEMINI_API_KEY not found in environment");
    return null;
  }
  console.log("[ExternalResearch] Gemini client initialized successfully");
  return new GoogleGenAI({ apiKey });
}

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
  extractionDate: string;
  companyName?: string;
};

/**
 * Format the current date for research attribution.
 */
function getExtractionDate(): string {
  return new Date().toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/New_York',
    timeZoneName: 'short'
  });
}

/**
 * Perform external research using Gemini.
 */
export async function performExternalResearch(
  query: string,
  companyName?: string | null,
  topic?: string | null
): Promise<ResearchResult> {
  const extractionDate = getExtractionDate();
  console.log(`[ExternalResearch] Research request: query="${query}", company="${companyName}", topic="${topic}"`);
  
  const gemini = getGeminiClient();
  
  if (!gemini) {
    console.log(`[ExternalResearch] Gemini not available, falling back to general knowledge`);
    return provideGeneralKnowledge(query, companyName, topic, extractionDate);
  }
  
  try {
    const researchPrompt = buildResearchPrompt(query, companyName, topic);
    
    const response = await gemini.models.generateContent({
      model: "gemini-2.5-flash",
      contents: researchPrompt,
    });
    
    const content = response.text;
    if (!content) {
      console.log(`[ExternalResearch] Empty response from Gemini`);
      return provideGeneralKnowledge(query, companyName, topic, extractionDate);
    }
    
    const citations = extractCitations(content);
    
    return {
      answer: formatResearchDocument(companyName || "Company", content, extractionDate),
      citations,
      searchQueries: [query],
      confidence: citations.length > 0 ? "medium" : "low",
      extractionDate,
      companyName: companyName || undefined,
      disclaimer: "Research based on publicly available information via Gemini AI. Please verify critical details before use.",
    };
  } catch (error) {
    console.error("[ExternalResearch] Gemini API error:", error);
    return provideGeneralKnowledge(query, companyName, topic, extractionDate);
  }
}

/**
 * Build the research prompt for Gemini.
 */
function buildResearchPrompt(
  query: string,
  companyName?: string | null,
  topic?: string | null
): string {
  const company = companyName || "the company mentioned";
  
  return `You are a business research analyst. Research ${company} based on this request: "${query}"

Please provide a comprehensive research report with:

1. **Company Overview**
   - Brief description and industry position
   - Key facts about the business

2. **Recent Strategic Priorities**
   - Key initiatives and focus areas (cite timeframes when possible)
   - Public statements from leadership

3. **Earnings & Financial Highlights** (if publicly traded)
   - Recent earnings call highlights
   - Key metrics or guidance mentioned
   - Note the quarter/year of any financial information

4. **Challenges & Pain Points**
   - Publicly discussed challenges
   - Industry headwinds affecting them

5. **Technology & Operational Focus**
   - Technology investments
   - Operational improvement areas

6. **Relevant Industry Context**
   - Industry trends
   - Competitive dynamics

IMPORTANT REQUIREMENTS:
- Include specific dates, quarters, or timeframes for all factual claims
- At the end, include a "## Sources" section listing:
  - Type of source (earnings call, press release, SEC filing, news article, etc.)
  - Approximate date or timeframe of the information
  - Any specific publications or sources referenced
- If you're uncertain about recency or accuracy, clearly state that
- Never fabricate specific numbers or quotes - indicate uncertainty when applicable`;
}

/**
 * Provide general knowledge when Gemini is not available.
 */
async function provideGeneralKnowledge(
  query: string,
  companyName?: string | null,
  topic?: string | null,
  extractionDate?: string
): Promise<ResearchResult> {
  console.log(`[ExternalResearch] Providing general knowledge (Gemini not available)`);
  
  const response = await openai.chat.completions.create({
    model: MODEL_ASSIGNMENTS.EXTERNAL_RESEARCH,
    messages: [
      {
        role: "system",
        content: `You are a helpful assistant providing general knowledge about companies and business topics.

IMPORTANT RULES:
- Provide helpful general information based on your training data
- Be clear about limitations: your knowledge has a cutoff date and may be outdated
- NEVER fabricate specific citations, URLs, or sources
- Include timeframes for factual claims when known
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
  const date = extractionDate || getExtractionDate();

  return {
    answer: formatResearchDocument(companyName || "Research", answer, date),
    citations: [],
    searchQueries: [query],
    confidence: "low",
    extractionDate: date,
    companyName: companyName || undefined,
    disclaimer: "This response is based on general knowledge, not real-time web search. Information may be outdated. Please verify important details from official sources.",
  };
}

/**
 * Extract citations/sources from the research content.
 */
function extractCitations(content: string): Citation[] {
  const citations: Citation[] = [];
  
  const sourcesMatch = content.match(/##?\s*Sources?\s*\n([\s\S]*?)(?:\n\n##|\n\n\*\*|$)/i);
  if (sourcesMatch) {
    const sourcesText = sourcesMatch[1];
    const lines = sourcesText.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      const cleaned = line.replace(/^[-•*]\s*/, '').trim();
      if (cleaned && cleaned.length > 5) {
        citations.push({
          source: cleaned,
          url: "",
          date: extractDateFromText(cleaned),
          snippet: cleaned,
        });
      }
    }
  }
  
  if (citations.length === 0) {
    citations.push({
      source: "Gemini AI research synthesis",
      url: "",
      date: null,
      snippet: "Information synthesized from publicly available sources",
    });
  }
  
  return citations;
}

/**
 * Try to extract a date reference from text.
 */
function extractDateFromText(text: string): string | null {
  const datePatterns = [
    /\b(Q[1-4]\s*20\d{2})\b/i,
    /\b(20\d{2})\b/,
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2}\b/i,
    /\b(\d{1,2}\/\d{1,2}\/20\d{2})\b/,
  ];
  
  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1];
    }
  }
  
  return null;
}

/**
 * Format the research into a structured document.
 */
function formatResearchDocument(
  title: string,
  content: string,
  extractionDate: string
): string {
  return `# ${title} Research Report

**Research Date:** ${extractionDate}

---

${content}

---

## Research Metadata

**Generated:** ${extractionDate}
**Research Method:** AI-assisted research using publicly available information

*Note: This research is based on publicly available information. Please verify critical details before use in customer-facing materials.*`;
}

/**
 * Format citations for display in Slack or other output.
 */
export function formatCitationsForDisplay(citations: Citation[]): string {
  if (citations.length === 0) return "";
  
  return "\n\n*Sources:*\n" + citations.map((c, i) => {
    const dateStr = c.date ? ` (${c.date})` : "";
    const urlStr = c.url ? `: ${c.url}` : "";
    return `[${i + 1}] ${c.source}${dateStr}${urlStr}`;
  }).join("\n");
}
