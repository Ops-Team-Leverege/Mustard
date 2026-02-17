import { storage } from "../../storage";

export type OrchestratorActionItem = {
  action: string;
  owner: string;
  type: string;
  deadline: string | null;
  evidence: string;
  confidence: number;
  isPrimary: boolean;
};

export const UNCERTAINTY_RESPONSE = `I don't see this explicitly mentioned in the meeting.
If you say "yes", I'll share a brief meeting summary.`;

export const STOP_WORDS = new Set([
  "what", "when", "where", "which", "that", "this", "from", "with", "about",
  "were", "have", "been", "does", "will", "would", "could", "should", "there",
  "their", "they", "your", "just", "some", "into", "more", "also", "than",
  "only", "other", "then", "after", "before", "being", "very", "like", "over",
  "friday", "monday", "tuesday", "wednesday", "thursday", "saturday", "sunday",
  "issue", "issues", "problem", "problems", "experienced", "happening",
  "last", "latest", "recent", "previous", "yesterday", "today", "earlier",
  "call", "calls", "meeting", "meetings", "sync", "syncs", "demo", "demos",
]);

export function extractKeywords(query: string): { keywords: string[]; properNouns: string[] } {
  const words = query.split(/\s+/);

  const properNouns = words
    .filter((w, i) => i > 0 && /^[A-Z][a-z]+$/.test(w))
    .map(w => w.toLowerCase());

  const properNounSet = new Set(properNouns);

  const keywords = query.toLowerCase()
    .split(/\s+/)
    .map(w => w.replace(/[^a-z]/g, ''))
    .filter(w => w.length > 3 && !STOP_WORDS.has(w) && !properNounSet.has(w));

  return { keywords, properNouns };
}

export async function lookupQAPairs(
  meetingId: string,
  userQuestion?: string
): Promise<Array<{
  questionText: string;
  askedByName: string | null;
  status: string;
  answerEvidence: string | null;
}>> {
  const qaPairs = await storage.getQAPairsByTranscriptId(meetingId);

  const mapped = qaPairs.map(qa => ({
    questionText: qa.question,
    askedByName: qa.asker || null,
    status: "ANSWERED" as const,
    answerEvidence: qa.answer,
  }));

  if (!userQuestion) {
    return mapped;
  }

  const { keywords, properNouns } = extractKeywords(userQuestion);

  if (properNouns.length > 0 && keywords.length > 0) {
    const bothMatches = mapped.filter(cq => {
      const text = cq.questionText.toLowerCase();
      const hasProperNoun = properNouns.some(noun => text.includes(noun));
      const hasKeyword = keywords.some(kw => text.includes(kw));
      return hasProperNoun && hasKeyword;
    });

    if (bothMatches.length > 0) {
      return bothMatches;
    }
  }

  if (keywords.length > 0) {
    const keywordMatches = mapped.filter(cq => {
      const text = cq.questionText.toLowerCase();
      return keywords.some(kw => text.includes(kw));
    });

    if (keywordMatches.length > 0) {
      return keywordMatches;
    }
  }

  if (properNouns.length > 0) {
    const properNounMatches = mapped.filter(cq => {
      const text = cq.questionText.toLowerCase();
      return properNouns.some(noun => text.includes(noun));
    });

    if (properNounMatches.length > 0) {
      return properNounMatches;
    }
  }

  return [];
}

export async function getMeetingAttendees(
  meetingId: string
): Promise<{ leverageTeam: string[]; customerNames: string[] }> {
  const transcript = await storage.getTranscriptById(meetingId);
  if (!transcript) {
    return { leverageTeam: [], customerNames: [] };
  }

  const leverageTeam = transcript.leverageTeam
    ? transcript.leverageTeam.split(",").map(s => s.trim()).filter(Boolean)
    : [];
  const customerNames = transcript.customerNames
    ? transcript.customerNames.split(",").map(s => s.trim()).filter(Boolean)
    : [];

  return { leverageTeam, customerNames };
}

export async function getMeetingActionItems(
  meetingId: string
): Promise<OrchestratorActionItem[]> {
  console.log(`[SingleMeeting] Reading action items for meeting ${meetingId} from database (READ-ONLY, no LLM)`);

  const dbItems = await storage.getMeetingActionItemsByTranscript(meetingId);

  return dbItems.map(item => ({
    action: item.actionText,
    owner: item.ownerName,
    type: item.actionType,
    deadline: item.deadline,
    evidence: item.evidenceQuote,
    confidence: item.confidence,
    isPrimary: item.isPrimary,
  }));
}

export async function searchActionItemsForRelevantIssues(
  meetingId: string,
  query: string
): Promise<OrchestratorActionItem[]> {
  const actionItems = await getMeetingActionItems(meetingId);

  if (actionItems.length === 0) {
    return [];
  }

  const { keywords, properNouns } = extractKeywords(query);

  if (properNouns.length > 0) {
    const properNounMatches = actionItems.filter(item => {
      const searchText = `${item.action} ${item.evidence} ${item.owner}`.toLowerCase();
      return properNouns.some(noun => searchText.includes(noun));
    });

    if (properNounMatches.length > 0) {
      return properNounMatches;
    }
  }

  if (keywords.length === 0) {
    return [];
  }

  const matches = actionItems.filter(item => {
    const searchText = `${item.action} ${item.evidence} ${item.owner}`.toLowerCase();
    return keywords.some(kw => searchText.includes(kw));
  });

  return matches;
}

export async function searchTranscriptSnippets(
  meetingId: string,
  query: string,
  limit: number = 3
): Promise<Array<{
  speakerName: string;
  content: string;
  chunkIndex: number;
  matchType?: "both" | "keyword" | "proper_noun";
}>> {
  const chunks = await storage.getChunksForTranscript(meetingId, 1000);

  const { keywords, properNouns } = extractKeywords(query);

  if (properNouns.length > 0 && keywords.length > 0) {
    const bothMatches = chunks.filter(chunk => {
      const content = chunk.content.toLowerCase();
      const hasProperNoun = properNouns.some(noun => content.includes(noun));
      const hasKeyword = keywords.some(kw => content.includes(kw));
      return hasProperNoun && hasKeyword;
    });

    if (bothMatches.length > 0) {
      console.log(`[SearchTranscript] Found ${bothMatches.length} chunks matching both proper nouns AND keywords`);
      return bothMatches.slice(0, limit).map(chunk => ({
        speakerName: chunk.speakerName || "Unknown",
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        matchType: "both" as const,
      }));
    }
  }

  if (keywords.length > 0) {
    const keywordMatches = chunks.filter(chunk => {
      const content = chunk.content.toLowerCase();
      return keywords.some(kw => content.includes(kw));
    });

    if (keywordMatches.length > 0) {
      console.log(`[SearchTranscript] Found ${keywordMatches.length} chunks matching keywords only`);
      return keywordMatches.slice(0, limit).map(chunk => ({
        speakerName: chunk.speakerName || "Unknown",
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        matchType: "keyword" as const,
      }));
    }
  }

  if (properNouns.length > 0) {
    const properNounMatches = chunks.filter(chunk => {
      const content = chunk.content.toLowerCase();
      return properNouns.some(noun => content.includes(noun));
    });

    if (properNounMatches.length > 0) {
      console.log(`[SearchTranscript] Found ${properNounMatches.length} chunks matching proper nouns only`);
      return properNounMatches.slice(0, limit).map(chunk => ({
        speakerName: chunk.speakerName || "Unknown",
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        matchType: "proper_noun" as const,
      }));
    }
  }

  return [];
}
