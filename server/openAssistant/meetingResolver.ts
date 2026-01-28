/**
 * Meeting Resolver Module
 * 
 * Handles meeting lookup and scope resolution for Open Assistant.
 * No execution, routing, or formatting logic - purely focused on
 * finding and resolving meetings from user queries.
 */

import { type SingleMeetingContext } from "../mcp/singleMeetingOrchestrator";
import type { IntentClassification } from "./types";

export type MeetingSearchResult = {
  meetings: SingleMeetingContext[];
  searchedFor: string;
};

/**
 * Find relevant meetings based on company/person names in the query.
 * Uses fuzzy matching on company names and contact names.
 */
export async function findRelevantMeetings(
  userMessage: string,
  classification: IntentClassification
): Promise<MeetingSearchResult> {
  const { storage } = await import("../storage");
  
  const searchTerms = extractSearchTerms(userMessage);
  console.log(`[MeetingResolver] Searching for meetings with terms: ${searchTerms.join(", ")}`);
  
  if (searchTerms.length === 0) {
    console.log(`[MeetingResolver] No search terms extracted, trying fallback word search`);
    const fallbackMeetings = await fallbackMeetingSearch(userMessage);
    return { 
      meetings: fallbackMeetings, 
      searchedFor: "(fallback search)" 
    };
  }

  const companyMatches = await searchCompanies(searchTerms);
  
  if (companyMatches.length === 0) {
    const contactMatches = await searchContacts(searchTerms);
    if (contactMatches.length > 0) {
      return {
        meetings: contactMatches,
        searchedFor: searchTerms.join(", "),
      };
    }
    
    console.log(`[MeetingResolver] No company/contact matches, trying fallback search`);
    const fallbackMeetings = await fallbackMeetingSearch(userMessage);
    return { 
      meetings: fallbackMeetings, 
      searchedFor: searchTerms.join(", ") + " (+ fallback)" 
    };
  }

  // Limit per company to prevent unbounded loads for large customers
  // Downstream processing (e.g., searchAcrossMeetings) may further reduce this
  const MAX_MEETINGS_PER_COMPANY = 25;
  
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
  };
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
      SELECT DISTINCT t.id as meeting_id, t.meeting_date, c.id as company_id, c.name as company_name
      FROM transcripts t
      JOIN companies c ON t.company_id = c.id
      WHERE c.name ILIKE $1
      ORDER BY COALESCE(t.meeting_date, t.created_at) DESC
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
      SELECT DISTINCT t.id as meeting_id, t.meeting_date, c.id as company_id, c.name as company_name
      FROM transcripts t
      JOIN companies c ON t.company_id = c.id
      LEFT JOIN contacts ct ON ct.company_id = c.id
      WHERE ct.name ILIKE $1
      ORDER BY COALESCE(t.meeting_date, t.created_at) DESC
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
 * Search across multiple meetings for relevant information.
 */
export async function searchAcrossMeetings(
  userMessage: string,
  meetings: SingleMeetingContext[]
): Promise<string> {
  const { handleSingleMeetingQuestion } = await import("../mcp/singleMeetingOrchestrator");
  
  console.log(`[MeetingResolver] Searching across ${meetings.length} meetings`);
  
  const allResults: Array<{
    companyName: string;
    meetingDate: string;
    answer: string;
  }> = [];

  for (const meeting of meetings.slice(0, 5)) {
    try {
      const result = await handleSingleMeetingQuestion(meeting, userMessage, false);
      if (result.dataSource !== "not_found") {
        allResults.push({
          companyName: meeting.companyName,
          meetingDate: meeting.meetingDate?.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) || "Unknown date",
          answer: result.answer,
        });
      }
    } catch (err) {
      console.error(`[MeetingResolver] Error searching meeting ${meeting.meetingId}:`, err);
    }
  }

  if (allResults.length === 0) {
    return `I searched across ${meetings.length} meeting(s) with ${meetings.map(m => m.companyName).join(", ")}, but couldn't find information related to your question.`;
  }

  const formattedResults = allResults.map(r => 
    `**${r.companyName}** (${r.meetingDate}):\n${r.answer}`
  ).join("\n\n---\n\n");

  return `Here's what I found across ${allResults.length} meeting(s):\n\n${formattedResults}`;
}
