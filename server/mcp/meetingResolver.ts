/**
 * Deterministic Meeting Resolution (Step 0)
 * 
 * Purpose:
 * Resolve the target meeting BEFORE intent classification.
 * This runs without LLMs and uses only deterministic logic.
 * 
 * Resolution Order (Strict):
 * 1. Thread context (highest priority) - always wins
 * 2. Explicit meeting reference (meeting ID, transcript link)
 * 3. Explicit temporal language (new threads only)
 * 
 * Invariants:
 * - Single meeting answers only
 * - No LLM calls
 * - No cross-meeting aggregation
 * - Ambiguous queries must ask for clarification
 */

import { storage } from "../storage";

export type MeetingResolutionResult =
  | { resolved: true; meetingId: string; companyId: string; companyName: string; meetingDate?: Date | null }
  | { resolved: false; needsClarification: true; message: string; options?: Array<{ meetingId: string; date: Date; companyName: string }> }
  | { resolved: false; needsClarification: false; reason: string };

export type MeetingResolverThreadContext = {
  meetingId?: string | null;
  companyId?: string | null;
};

/**
 * Temporal language patterns for meeting resolution.
 */
const TEMPORAL_PATTERNS = {
  lastMeeting: /\b(last|latest|most recent)\s+(meeting|call|transcript)\b/i,
  dateReference: /\bmeeting\s+(?:on|from)\s+(\w+\s+\d{1,2}(?:,?\s*\d{4})?|\d{1,2}(?:\/|-)\d{1,2}(?:(?:\/|-)\d{2,4})?)\b/i,
  lastWeek: /\b(meeting|call|transcript)\s+last\s+week\b/i,
  lastMonth: /\b(meeting|call|transcript)\s+last\s+month\b/i,
};

/**
 * Extract company name from message if mentioned.
 * Returns null if no company explicitly mentioned.
 */
export async function extractCompanyFromMessage(message: string): Promise<{ companyId: string; companyName: string } | null> {
  const companies = await storage.rawQuery(
    `SELECT id, name FROM companies ORDER BY name`,
    []
  );
  
  if (!companies || companies.length === 0) {
    return null;
  }
  
  const messageLower = message.toLowerCase();
  
  for (const company of companies) {
    const companyName = (company.name as string).toLowerCase();
    if (messageLower.includes(companyName)) {
      return { companyId: company.id as string, companyName: company.name as string };
    }
  }
  
  return null;
}

/**
 * Parse date from various formats.
 */
function parseDateReference(dateStr: string): Date | null {
  const now = new Date();
  const currentYear = now.getFullYear();
  
  // Try common date formats
  const formats = [
    // "Aug 7" or "August 7"
    /^(\w+)\s+(\d{1,2})$/,
    // "Aug 7, 2025" or "August 7 2025"
    /^(\w+)\s+(\d{1,2}),?\s*(\d{4})$/,
    // "8/7" or "8-7"
    /^(\d{1,2})[\/\-](\d{1,2})$/,
    // "8/7/2025" or "8-7-25"
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/,
  ];
  
  const monthNames: Record<string, number> = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4,
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, september: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11,
  };
  
  // Try "Aug 7" format
  const match1 = dateStr.match(/^(\w+)\s+(\d{1,2})(?:,?\s*(\d{4}))?$/i);
  if (match1) {
    const monthStr = match1[1].toLowerCase();
    const day = parseInt(match1[2], 10);
    const year = match1[3] ? parseInt(match1[3], 10) : currentYear;
    
    if (monthNames[monthStr] !== undefined) {
      return new Date(year, monthNames[monthStr], day);
    }
  }
  
  // Try "8/7" or "8/7/2025" format (M/D/Y)
  const match2 = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
  if (match2) {
    const month = parseInt(match2[1], 10) - 1;
    const day = parseInt(match2[2], 10);
    let year = match2[3] ? parseInt(match2[3], 10) : currentYear;
    if (year < 100) year += 2000;
    
    return new Date(year, month, day);
  }
  
  return null;
}

/**
 * Get date range for "last week" (7 days ago to now).
 */
function getLastWeekRange(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 7);
  start.setHours(0, 0, 0, 0);
  
  return { start, end: now };
}

/**
 * Get date range for "last month" (30 days ago to now).
 */
function getLastMonthRange(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 30);
  start.setHours(0, 0, 0, 0);
  
  return { start, end: now };
}

/**
 * Query meetings within a date range for a specific company.
 */
async function getMeetingsInDateRange(
  companyId: string,
  startDate: Date,
  endDate: Date
): Promise<Array<{ id: string; meetingDate: Date; name: string | null }>> {
  const results = await storage.rawQuery(
    `SELECT id, COALESCE(meeting_date, created_at) as meeting_date, name
     FROM transcripts
     WHERE company_id = $1
       AND COALESCE(meeting_date, created_at) >= $2
       AND COALESCE(meeting_date, created_at) <= $3
     ORDER BY COALESCE(meeting_date, created_at) DESC`,
    [companyId, startDate, endDate]
  );
  
  return (results || []).map(r => ({
    id: r.id as string,
    meetingDate: new Date(r.meeting_date as string),
    name: r.name as string | null,
  }));
}

/**
 * Query meetings on a specific date for a company.
 */
async function getMeetingsOnDate(
  companyId: string,
  targetDate: Date
): Promise<Array<{ id: string; meetingDate: Date; name: string | null }>> {
  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);
  
  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);
  
  return getMeetingsInDateRange(companyId, startOfDay, endOfDay);
}

/**
 * Get the most recent meeting for a company.
 */
async function getMostRecentMeeting(
  companyId: string
): Promise<{ id: string; meetingDate: Date; name: string | null } | null> {
  const results = await storage.rawQuery(
    `SELECT id, COALESCE(meeting_date, created_at) as meeting_date, name
     FROM transcripts
     WHERE company_id = $1
     ORDER BY COALESCE(meeting_date, created_at) DESC
     LIMIT 1`,
    [companyId]
  );
  
  if (!results || results.length === 0) {
    return null;
  }
  
  const r = results[0];
  return {
    id: r.id as string,
    meetingDate: new Date(r.meeting_date as string),
    name: r.name as string | null,
  };
}

/**
 * Check if multiple meetings share the same most recent date.
 */
async function getMeetingsOnMostRecentDate(
  companyId: string
): Promise<Array<{ id: string; meetingDate: Date; name: string | null }>> {
  const mostRecent = await getMostRecentMeeting(companyId);
  if (!mostRecent) {
    return [];
  }
  
  // Check for other meetings on the same date
  return getMeetingsOnDate(companyId, mostRecent.meetingDate);
}

/**
 * Format date for display.
 */
function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Main meeting resolution function.
 * 
 * Resolution Order:
 * 1. Thread context (highest priority)
 * 2. Explicit meeting ID/link in message
 * 3. Temporal language (last meeting, meeting on date, etc.)
 * 
 * Returns either a resolved meeting or a clarification request.
 */
export async function resolveMeetingFromSlackMessage(
  message: string,
  threadContext?: MeetingResolverThreadContext
): Promise<MeetingResolutionResult> {
  console.log(`[MeetingResolver] Resolving meeting from message: "${message.substring(0, 50)}..."`);
  
  // 1. Thread context always wins
  if (threadContext?.meetingId && threadContext?.companyId) {
    console.log(`[MeetingResolver] Using thread context: meetingId=${threadContext.meetingId}`);
    
    // Look up company name and meeting date
    const companyRows = await storage.rawQuery(
      `SELECT name FROM companies WHERE id = $1`,
      [threadContext.companyId]
    );
    const companyName = companyRows?.[0]?.name as string || "Unknown Company";
    
    // Get meeting date from transcript
    const transcriptRows = await storage.rawQuery(
      `SELECT COALESCE(meeting_date, created_at) as meeting_date FROM transcripts WHERE id = $1`,
      [threadContext.meetingId]
    );
    const meetingDate = transcriptRows?.[0]?.meeting_date ? new Date(transcriptRows[0].meeting_date as string) : null;
    
    return {
      resolved: true,
      meetingId: threadContext.meetingId,
      companyId: threadContext.companyId,
      companyName,
      meetingDate,
    };
  }
  
  // 2. Check for explicit meeting ID or transcript link
  // Pattern: meeting ID like "abc123" or transcript URL
  const meetingIdMatch = message.match(/\bmeeting[:\s]+([a-f0-9-]{36})\b/i);
  if (meetingIdMatch) {
    const meetingId = meetingIdMatch[1];
    const transcript = await storage.getTranscriptById(meetingId);
    
    if (transcript && transcript.companyId) {
      const companyRows = await storage.rawQuery(
        `SELECT name FROM companies WHERE id = $1`,
        [transcript.companyId]
      );
      const companyName = companyRows?.[0]?.name as string || "Unknown Company";
      
      return {
        resolved: true,
        meetingId,
        companyId: transcript.companyId,
        companyName,
      };
    }
  }
  
  // 3. Temporal language resolution (requires company context)
  const companyContext = await extractCompanyFromMessage(message);
  
  if (!companyContext) {
    // Check if any temporal language is present
    const hasTemporalRef = Object.values(TEMPORAL_PATTERNS).some(p => p.test(message));
    
    if (hasTemporalRef) {
      return {
        resolved: false,
        needsClarification: true,
        message: "Which company are you asking about? Please mention the company name so I can find the right meeting.",
      };
    }
    
    // No temporal language and no context - can't resolve
    return {
      resolved: false,
      needsClarification: false,
      reason: "no_meeting_context",
    };
  }
  
  const { companyId, companyName } = companyContext;
  
  // 3a. "Last / Latest / Most Recent meeting"
  if (TEMPORAL_PATTERNS.lastMeeting.test(message)) {
    console.log(`[MeetingResolver] Detected "last meeting" pattern for ${companyName}`);
    
    const meetings = await getMeetingsOnMostRecentDate(companyId);
    
    if (meetings.length === 0) {
      return {
        resolved: false,
        needsClarification: true,
        message: `I don't see any meetings with ${companyName} on record.`,
      };
    }
    
    if (meetings.length === 1) {
      return {
        resolved: true,
        meetingId: meetings[0].id,
        companyId,
        companyName,
        meetingDate: meetings[0].meetingDate,
      };
    }
    
    // Multiple meetings on same date
    return {
      resolved: false,
      needsClarification: true,
      message: `I see multiple ${companyName} meetings on ${formatDate(meetings[0].meetingDate)}:\n${meetings.map((m, i) => `• ${m.name || `Meeting ${i + 1}`}`).join("\n")}\nWhich one should I use?`,
      options: meetings.map(m => ({
        meetingId: m.id,
        date: m.meetingDate,
        companyName,
      })),
    };
  }
  
  // 3b. "Meeting on <date>"
  const dateMatch = message.match(TEMPORAL_PATTERNS.dateReference);
  if (dateMatch) {
    const dateStr = dateMatch[1];
    const targetDate = parseDateReference(dateStr);
    
    if (!targetDate) {
      return {
        resolved: false,
        needsClarification: true,
        message: `I couldn't parse the date "${dateStr}". Could you rephrase it? (e.g., "meeting on Aug 7" or "meeting on 8/7")`,
      };
    }
    
    console.log(`[MeetingResolver] Detected date reference: ${formatDate(targetDate)} for ${companyName}`);
    
    const meetings = await getMeetingsOnDate(companyId, targetDate);
    
    if (meetings.length === 0) {
      return {
        resolved: false,
        needsClarification: true,
        message: `I don't see any ${companyName} meetings on ${formatDate(targetDate)}.`,
      };
    }
    
    if (meetings.length === 1) {
      return {
        resolved: true,
        meetingId: meetings[0].id,
        companyId,
        companyName,
        meetingDate: meetings[0].meetingDate,
      };
    }
    
    // Multiple meetings on that date
    return {
      resolved: false,
      needsClarification: true,
      message: `I see multiple ${companyName} meetings on ${formatDate(targetDate)}:\n${meetings.map((m, i) => `• ${m.name || `Meeting ${i + 1}`}`).join("\n")}\nWhich one should I use?`,
      options: meetings.map(m => ({
        meetingId: m.id,
        date: m.meetingDate,
        companyName,
      })),
    };
  }
  
  // 3c. "Meeting last week"
  if (TEMPORAL_PATTERNS.lastWeek.test(message)) {
    console.log(`[MeetingResolver] Detected "last week" pattern for ${companyName}`);
    
    const { start, end } = getLastWeekRange();
    const meetings = await getMeetingsInDateRange(companyId, start, end);
    
    if (meetings.length === 0) {
      return {
        resolved: false,
        needsClarification: true,
        message: `I don't see any ${companyName} meetings from last week.`,
      };
    }
    
    if (meetings.length === 1) {
      return {
        resolved: true,
        meetingId: meetings[0].id,
        companyId,
        companyName,
        meetingDate: meetings[0].meetingDate,
      };
    }
    
    // Multiple meetings last week
    return {
      resolved: false,
      needsClarification: true,
      message: `I see ${meetings.length} ${companyName} meetings from last week:\n${meetings.map(m => `• ${formatDate(m.meetingDate)}${m.name ? ` - ${m.name}` : ""}`).join("\n")}\nWhich one should I use?`,
      options: meetings.map(m => ({
        meetingId: m.id,
        date: m.meetingDate,
        companyName,
      })),
    };
  }
  
  // 3d. "Meeting last month"
  if (TEMPORAL_PATTERNS.lastMonth.test(message)) {
    console.log(`[MeetingResolver] Detected "last month" pattern for ${companyName}`);
    
    const { start, end } = getLastMonthRange();
    const meetings = await getMeetingsInDateRange(companyId, start, end);
    
    if (meetings.length === 0) {
      return {
        resolved: false,
        needsClarification: true,
        message: `I don't see any ${companyName} meetings from last month.`,
      };
    }
    
    if (meetings.length === 1) {
      return {
        resolved: true,
        meetingId: meetings[0].id,
        companyId,
        companyName,
        meetingDate: meetings[0].meetingDate,
      };
    }
    
    // Multiple meetings last month
    return {
      resolved: false,
      needsClarification: true,
      message: `I see ${meetings.length} ${companyName} meetings from the last month:\n${meetings.map(m => `• ${formatDate(m.meetingDate)}${m.name ? ` - ${m.name}` : ""}`).join("\n")}\nWhich one should I use?`,
      options: meetings.map(m => ({
        meetingId: m.id,
        date: m.meetingDate,
        companyName,
      })),
    };
  }
  
  // No temporal language but company was mentioned - can't determine which meeting
  return {
    resolved: false,
    needsClarification: false,
    reason: "company_mentioned_but_no_meeting_specified",
  };
}

/**
 * Check if message contains explicit temporal meeting reference.
 * Used to determine if we should attempt meeting resolution.
 */
export function hasTemporalMeetingReference(message: string): boolean {
  return Object.values(TEMPORAL_PATTERNS).some(p => p.test(message));
}
