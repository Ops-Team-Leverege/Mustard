/**
 * Meeting Resolver Module
 * 
 * Handles meeting lookup and scope resolution for Open Assistant.
 * No execution, routing, or formatting logic - purely focused on
 * finding and resolving meetings from user queries.
 */

import { 
  type SingleMeetingContext,
  type MeetingSearchResult as SharedMeetingSearchResult,
  wantsAllCustomers
} from "../meeting";
import type { IntentClassification } from "./types";

// Re-export from shared module for backward compatibility
export type MeetingSearchResult = SharedMeetingSearchResult;

export type ChunkSearchResult = {
  transcriptId: string;
  companyName: string;
  meetingDate: Date | null;
  speakerName: string | null;
  content: string;
};

/**
 * Find relevant meetings based on company/person names in the query.
 * Uses fuzzy matching on company names and contact names.
 * Special case: "all customers" returns all available transcripts.
 */
export async function findRelevantMeetings(
  userMessage: string,
  classification: IntentClassification
): Promise<MeetingSearchResult> {
  const { storage } = await import("../storage");
  
  // Check for "all customers" scope - return all available transcripts
  if (wantsAllCustomers(userMessage)) {
    console.log(`[MeetingResolver] "All customers" detected - fetching all available transcripts`);
    const allMeetings = await fetchAllRecentTranscripts();
    const topic = extractTopic(userMessage);
    return {
      meetings: allMeetings,
      searchedFor: "all customers",
      topic,
    };
  }
  
  const searchTerms = extractSearchTerms(userMessage);
  const topic = extractTopic(userMessage);
  console.log(`[MeetingResolver] Searching for meetings with terms: ${searchTerms.join(", ")}${topic ? `, topic: "${topic}"` : ''}`);
  
  if (searchTerms.length === 0) {
    console.log(`[MeetingResolver] No search terms extracted, trying fallback word search`);
    const fallbackMeetings = await fallbackMeetingSearch(userMessage);
    return { 
      meetings: fallbackMeetings, 
      searchedFor: "(fallback search)",
      topic,
    };
  }

  const companyMatches = await searchCompanies(searchTerms);
  
  if (companyMatches.length === 0) {
    const contactMatches = await searchContacts(searchTerms);
    if (contactMatches.length > 0) {
      return {
        meetings: contactMatches,
        searchedFor: searchTerms.join(", "),
        topic,
      };
    }
    
    console.log(`[MeetingResolver] No company/contact matches, trying fallback search`);
    const fallbackMeetings = await fallbackMeetingSearch(userMessage);
    return { 
      meetings: fallbackMeetings, 
      searchedFor: searchTerms.join(", ") + " (+ fallback)",
      topic,
    };
  }

  // Limit per company to prevent unbounded loads for large customers
  // Downstream processing (e.g., searchAcrossMeetings) may further reduce this
  const { MEETING_LIMITS } = await import("../config/constants");
  const MAX_MEETINGS_PER_COMPANY = MEETING_LIMITS.MAX_MEETINGS_PER_COMPANY;
  
  const meetings: SingleMeetingContext[] = [];
  for (const company of companyMatches) {
    // Fetch recent transcripts for the company (bounded to prevent perf issues)
    const transcriptRows = await storage.rawQuery(`
      SELECT t.id, t.meeting_date, c.name as company_name, c.id as company_id
      FROM transcripts t
      JOIN companies c ON t.company_id = c.id
      WHERE t.company_id = $1
      ORDER BY COALESCE(t.meeting_date, t.created_at) DESC
      LIMIT $2
    `, [company.id, MAX_MEETINGS_PER_COMPANY]);

    if (transcriptRows && transcriptRows.length > 0) {
      for (const row of transcriptRows) {
        meetings.push({
          meetingId: row.id as string,
          companyId: row.company_id as string,
          companyName: row.company_name as string,
          meetingDate: row.meeting_date ? new Date(row.meeting_date as string) : null,
        });
      }
    }
  }
  
  console.log(`[MeetingResolver] Found ${meetings.length} total meetings for ${companyMatches.length} companies`);

  return {
    meetings,
    searchedFor: searchTerms.join(", "),
    topic,
  };
}

/**
 * Fetch all recent transcripts for "all customers" scope.
 * Returns a bounded set of recent transcripts across all companies.
 */
async function fetchAllRecentTranscripts(): Promise<SingleMeetingContext[]> {
  const { storage } = await import("../storage");
  const { MEETING_LIMITS } = await import("../config/constants");
  
  const MAX_TOTAL_TRANSCRIPTS = MEETING_LIMITS.MAX_TOTAL_TRANSCRIPTS;
  
  const rows = await storage.rawQuery(`
    SELECT DISTINCT t.id as meeting_id, t.meeting_date, t.created_at, 
           c.id as company_id, c.name as company_name,
           COALESCE(t.meeting_date, t.created_at) as sort_date
    FROM transcripts t
    JOIN companies c ON t.company_id = c.id
    ORDER BY sort_date DESC
    LIMIT $1
  `, [MAX_TOTAL_TRANSCRIPTS]);
  
  if (!rows || rows.length === 0) {
    console.log(`[MeetingResolver] No transcripts found in database`);
    return [];
  }
  
  const meetings: SingleMeetingContext[] = rows.map((row: any) => ({
    meetingId: row.meeting_id as string,
    companyId: row.company_id as string,
    companyName: row.company_name as string,
    meetingDate: row.meeting_date ? new Date(row.meeting_date as string) : null,
  }));
  
  console.log(`[MeetingResolver] Fetched ${meetings.length} transcripts for "all customers" scope`);
  return meetings;
}

/**
 * Fallback search: extract significant words and search companies directly.
 * Used when extractSearchTerms fails to find proper nouns/acronyms.
 */
async function fallbackMeetingSearch(message: string): Promise<SingleMeetingContext[]> {
  const { storage } = await import("../storage");
  
  const stopWords = new Set([
    "the", "and", "for", "are", "but", "not", "you", "all", "can", "had", 
    "her", "was", "one", "our", "out", "day", "get", "has", "him", "his",
    "how", "its", "let", "may", "new", "now", "old", "see", "way", "who",
    "did", "does", "what", "when", "where", "which", "while", "with", "about",
    "said", "they", "this", "that", "from", "have", "been", "some", "could",
    "would", "should", "their", "there", "these", "those", "being", "other",
  ]);
  
  const words = message
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 3 && !stopWords.has(w.toLowerCase()));
  
  console.log(`[MeetingResolver] Fallback search words: ${words.join(", ")}`);
  
  const meetings: SingleMeetingContext[] = [];
  const seenCompanyIds = new Set<string>();
  
  for (const word of words.slice(0, 5)) {
    const rows = await storage.rawQuery(`
      SELECT DISTINCT t.id as meeting_id, t.meeting_date, t.created_at, c.id as company_id, c.name as company_name,
             COALESCE(t.meeting_date, t.created_at) as sort_date
      FROM transcripts t
      JOIN companies c ON t.company_id = c.id
      WHERE c.name ILIKE $1
      ORDER BY sort_date DESC
      LIMIT 2
    `, [`%${word}%`]);
    
    if (rows) {
      for (const row of rows) {
        if (!seenCompanyIds.has(row.company_id as string)) {
          seenCompanyIds.add(row.company_id as string);
          meetings.push({
            meetingId: row.meeting_id as string,
            companyId: row.company_id as string,
            companyName: row.company_name as string,
            meetingDate: row.meeting_date ? new Date(row.meeting_date as string) : null,
          });
        }
      }
    }
  }
  
  return meetings;
}

/**
 * Extract company/person names from user message.
 * Handles:
 * - Proper nouns (Tyler Wiggins, Les Schwab)
 * - All-caps acronyms (ACE, IT, ROI)
 * - Mixed case (iPhone, PitCrew)
 * - Quoted strings
 */
export function extractSearchTerms(message: string): string[] {
  const terms: string[] = [];
  
  const commonWords = new Set([
    "what", "who", "where", "when", "why", "how", "the", "this", "that", 
    "can", "could", "would", "should", "did", "does", "do", "is", "are", 
    "was", "were", "has", "have", "had", "will", "shall", "may", "might", 
    "must", "find", "show", "tell", "give", "help", "get", "let", "make", 
    "want", "need", "like", "think", "know", "say", "said", "about", "from",
    "with", "for", "and", "or", "but", "not", "all", "any", "some", "their",
    "they", "them", "our", "we", "you", "your", "its", "his", "her", "him",
    "she", "he", "it", "be", "been", "being", "am", "an", "a", "to", "of",
    "in", "on", "at", "by", "up", "out", "if", "so", "no", "yes", "my",
    "roi", "tv", "api", "it",
  ]);
  
  const properNounPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
  let match;
  while ((match = properNounPattern.exec(message)) !== null) {
    const term = match[1];
    if (!commonWords.has(term.toLowerCase())) {
      terms.push(term);
    }
  }

  const acronymPattern = /\b([A-Z]{2,10})\b/g;
  while ((match = acronymPattern.exec(message)) !== null) {
    const term = match[1];
    if (!commonWords.has(term.toLowerCase())) {
      terms.push(term);
    }
  }

  const multiWordPattern = /\b([A-Z][a-z]+(?:\s+[A-Z]?[a-z]+)+)\b/g;
  while ((match = multiWordPattern.exec(message)) !== null) {
    const term = match[1];
    if (!commonWords.has(term.toLowerCase()) && term.split(" ").length <= 4) {
      terms.push(term);
    }
  }

  const quotedPattern = /"([^"]+)"/g;
  while ((match = quotedPattern.exec(message)) !== null) {
    terms.push(match[1]);
  }

  return Array.from(new Set(terms));
}

/**
 * Extract topic from user message for content filtering.
 * Handles patterns like:
 * - "about cameras" → "cameras"
 * - "regarding pricing" → "pricing"
 * - "related to security" → "security"
 * - "discuss cameras" → "cameras"
 */
export function extractTopic(message: string): string | undefined {
  const msg = message.toLowerCase();
  
  // Patterns to extract topic after specific phrases
  const topicPatterns = [
    /\babout\s+([a-z]+(?:\s+[a-z]+)?)/i,
    /\bregarding\s+([a-z]+(?:\s+[a-z]+)?)/i,
    /\brelated\s+to\s+([a-z]+(?:\s+[a-z]+)?)/i,
    /\bconcerning\s+([a-z]+(?:\s+[a-z]+)?)/i,
    /\bdiscuss(?:ed|ing)?\s+([a-z]+(?:\s+[a-z]+)?)/i,
    /\btalk(?:ed|ing)?\s+about\s+([a-z]+(?:\s+[a-z]+)?)/i,
    /\btalk(?:ed|ing)?\s+(?:\w+\s+)?about\s+([a-z]+(?:\s+[a-z]+)?)/i,
    /\bmentioned\s+([a-z]+(?:\s+[a-z]+)?)/i,
    /\bask(?:ed|ing)?\s+about\s+([a-z]+(?:\s+[a-z]+)?)/i,
  ];
  
  // Words to filter out - common non-topic words
  const nonTopicWords = new Set([
    "the", "this", "that", "them", "they", "their", "it", "its", 
    "any", "all", "some", "many", "few", "what", "which", "who",
    "meetings", "meeting", "calls", "call", "conversation", "conversations",
    "recent", "latest", "last", "previous", "answer", "response",
  ]);
  
  for (const pattern of topicPatterns) {
    const match = msg.match(pattern);
    if (match && match[1]) {
      const topic = match[1].trim();
      // Filter out non-topic words
      if (!nonTopicWords.has(topic) && topic.length >= 3) {
        console.log(`[MeetingResolver] Extracted topic: "${topic}" from pattern: ${pattern.source}`);
        return topic;
      }
    }
  }
  
  return undefined;
}

/**
 * Search companies by fuzzy name matching.
 */
async function searchCompanies(searchTerms: string[]): Promise<Array<{ id: string; name: string }>> {
  const { storage } = await import("../storage");
  const results: Array<{ id: string; name: string }> = [];

  for (const term of searchTerms) {
    const rows = await storage.rawQuery(`
      SELECT id, name FROM companies 
      WHERE name ILIKE $1 OR name ILIKE $2
      LIMIT 5
    `, [`%${term}%`, `${term}%`]);

    if (rows) {
      for (const row of rows) {
        if (!results.find(r => r.id === row.id)) {
          results.push({ id: row.id as string, name: row.name as string });
        }
      }
    }
  }

  return results;
}

/**
 * Search contacts/attendees and return their meetings.
 */
async function searchContacts(searchTerms: string[]): Promise<SingleMeetingContext[]> {
  const { storage } = await import("../storage");
  const meetings: SingleMeetingContext[] = [];

  for (const term of searchTerms) {
    const rows = await storage.rawQuery(`
      SELECT DISTINCT t.id as meeting_id, t.meeting_date, t.created_at, c.id as company_id, c.name as company_name,
             COALESCE(t.meeting_date, t.created_at) as sort_date
      FROM transcripts t
      JOIN companies c ON t.company_id = c.id
      LEFT JOIN contacts ct ON ct.company_id = c.id
      WHERE ct.name ILIKE $1
      ORDER BY sort_date DESC
      LIMIT 3
    `, [`%${term}%`]);

    if (rows) {
      for (const row of rows) {
        if (!meetings.find(m => m.meetingId === row.meeting_id)) {
          meetings.push({
            meetingId: row.meeting_id as string,
            companyId: row.company_id as string,
            companyName: row.company_name as string,
            meetingDate: row.meeting_date ? new Date(row.meeting_date as string) : null,
          });
        }
      }
    }
  }

  return meetings;
}

/**
 * Fast chunk-based search for a specific topic across meetings.
 * Uses SQL keyword search on transcript_chunks - much faster than LLM calls.
 * Returns relevant excerpts grouped by meeting.
 */
async function searchChunksForTopic(
  meetings: SingleMeetingContext[],
  topic: string
): Promise<Map<string, ChunkSearchResult[]>> {
  const { storage } = await import("../storage");
  
  const meetingIds = meetings.map(m => m.meetingId);
  if (meetingIds.length === 0) return new Map();
  
  // Use parameterized query for safety
  const placeholders = meetingIds.map((_, i) => `$${i + 1}`).join(", ");
  const topicParam = `$${meetingIds.length + 1}`;
  
  const query = `
    SELECT 
      tc.transcript_id,
      c.name as company_name,
      tc.meeting_date,
      tc.speaker_name,
      tc.content
    FROM transcript_chunks tc
    JOIN companies c ON tc.company_id = c.id
    WHERE tc.transcript_id IN (${placeholders})
      AND LOWER(tc.content) LIKE '%' || LOWER(${topicParam}) || '%'
    ORDER BY tc.transcript_id, tc.chunk_index
    LIMIT 20
  `;
  
  const rows = await storage.rawQuery(query, [...meetingIds, topic]);
  
  const results = new Map<string, ChunkSearchResult[]>();
  if (rows) {
    for (const row of rows) {
      const transcriptId = row.transcript_id as string;
      if (!results.has(transcriptId)) {
        results.set(transcriptId, []);
      }
      results.get(transcriptId)!.push({
        transcriptId,
        companyName: row.company_name as string,
        meetingDate: row.meeting_date ? new Date(row.meeting_date as string) : null,
        speakerName: row.speaker_name as string | null,
        content: row.content as string,
      });
    }
  }
  
  console.log(`[MeetingResolver] Chunk search for "${topic}": found ${rows?.length || 0} chunks across ${results.size} meetings`);
  return results;
}

/**
 * Search across multiple meetings for relevant information.
 * When topic is provided, uses fast chunk-based search instead of LLM calls.
 */
export async function searchAcrossMeetings(
  userMessage: string,
  meetings: SingleMeetingContext[],
  topic?: string
): Promise<string> {
  const { handleSingleMeetingQuestion } = await import("../mcp/singleMeetingOrchestrator");
  
  console.log(`[MeetingResolver] Searching across ${meetings.length} meetings${topic ? ` for topic: "${topic}"` : ''}`);
  
  // FAST PATH: When topic is provided, use chunk-based keyword search (no LLM calls)
  if (topic) {
    const chunkResults = await searchChunksForTopic(meetings, topic);
    
    if (chunkResults.size === 0) {
      const companyNames = Array.from(new Set(meetings.map(m => m.companyName))).join(", ");
      return `I searched across ${meetings.length} ${companyNames} meeting(s) but couldn't find any discussion about "${topic}".`;
    }
    
    // Format chunk results grouped by meeting
    const formattedResults: string[] = [];
    const entries = Array.from(chunkResults.entries());
    for (const [transcriptId, chunks] of entries) {
      const firstChunk = chunks[0];
      const meetingDate = firstChunk.meetingDate?.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) || "Unknown date";
      
      // Format each chunk with speaker attribution
      const excerpts = chunks.slice(0, 3).map((chunk: ChunkSearchResult) => {
        const speaker = chunk.speakerName ? `**${chunk.speakerName}**: ` : '';
        // Trim content to reasonable length and highlight topic
        const content = chunk.content.length > 300 
          ? chunk.content.substring(0, 300) + "..."
          : chunk.content;
        return `${speaker}_"${content}"_`;
      }).join("\n\n");
      
      formattedResults.push(`**${firstChunk.companyName}** (${meetingDate}):\n${excerpts}`);
    }
    
    return `Here's what I found about "${topic}" across ${chunkResults.size} meeting(s):\n\n${formattedResults.join("\n\n---\n\n")}`;
  }
  
  // SLOW PATH: No topic - use standard handler (may involve LLM)
  // OPTIMIZATION: Process meetings in parallel for faster response
  const meetingsToSearch = meetings.slice(0, 5);
  console.log(`[MeetingResolver] Processing ${meetingsToSearch.length} meetings in parallel...`);
  const startTime = Date.now();
  
  const results = await Promise.all(
    meetingsToSearch.map(async (meeting) => {
      try {
        const result = await handleSingleMeetingQuestion(meeting, userMessage, false);
        if (result.dataSource !== "not_found") {
          return {
            companyName: meeting.companyName,
            meetingDate: meeting.meetingDate?.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) || "Unknown date",
            answer: result.answer,
          };
        }
        return null;
      } catch (err) {
        console.error(`[MeetingResolver] Error searching meeting ${meeting.meetingId}:`, err);
        return null;
      }
    })
  );
  
  const allResults = results.filter((r): r is NonNullable<typeof r> => r !== null);
  console.log(`[MeetingResolver] Parallel search completed in ${Date.now() - startTime}ms (${allResults.length}/${meetingsToSearch.length} had results)`);

  if (allResults.length === 0) {
    return `I searched across ${meetings.length} meeting(s) with ${meetings.map(m => m.companyName).join(", ")}, but couldn't find information related to your question.`;
  }

  const formattedResults = allResults.map(r => 
    `**${r.companyName}** (${r.meetingDate}):\n${r.answer}`
  ).join("\n\n---\n\n");

  const topicNote = topic ? ` related to "${topic}"` : '';
  return `Here's what I found${topicNote} across ${allResults.length} meeting(s):\n\n${formattedResults}`;
}
