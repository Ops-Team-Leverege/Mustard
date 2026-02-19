import { storage } from "../../storage";
import { generateText } from "../../llm/client";

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
  limit: number = 5
): Promise<Array<{
  speakerName: string;
  content: string;
  chunkIndex: number;
  matchType?: "both" | "keyword" | "proper_noun" | "semantic";
}>> {
  const chunks = await storage.getChunksForTranscript(meetingId, 1000);

  if (chunks.length === 0) {
    return [];
  }

  const { keywords, properNouns } = extractKeywords(query);

  const keywordCandidates = chunks.filter(chunk => {
    const content = chunk.content.toLowerCase();
    const hasProperNoun = properNouns.length > 0 && properNouns.some(noun => content.includes(noun));
    const hasKeyword = keywords.length > 0 && keywords.some(kw => content.includes(kw));
    return hasProperNoun || hasKeyword;
  });

  console.log(`[SearchTranscript] Keyword pre-filter: ${keywordCandidates.length}/${chunks.length} chunks matched`);

  let candidatePool: typeof chunks;
  if (keywordCandidates.length > 0) {
    candidatePool = keywordCandidates.slice(0, 30);
  } else {
    console.log(`[SearchTranscript] No keyword matches — sending sample of all chunks for semantic search`);
    const step = Math.max(1, Math.floor(chunks.length / 30));
    candidatePool = chunks.filter((_, i) => i % step === 0).slice(0, 30);
  }

  try {
    const numberedChunks = candidatePool.map((chunk, i) => 
      `[${i}] [${chunk.speakerName || "Unknown"}]: ${chunk.content.substring(0, 300)}`
    ).join("\n\n");

    const llmResponse = await generateText({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a transcript search assistant. Given a user's question and numbered transcript chunks, identify which chunks are RELEVANT to answering the question.

RULES:
1. Look for semantic relevance, not just keyword matches. "monitors" is relevant to a question about "TVs". "screens" is relevant to "displays".
2. Include chunks that contain the actual answer, supporting context, or directly related discussion.
3. Exclude chunks that merely mention the same topic but don't help answer the specific question.
4. Return ONLY a JSON array of the relevant chunk indices, ordered by relevance (most relevant first).
5. If NO chunks are relevant, return an empty array [].

Return valid JSON only: [0, 5, 12] or []`
        },
        {
          role: "user",
          content: `Question: ${query}\n\nTranscript chunks:\n${numberedChunks}`
        }
      ],
      temperature: 0,
      responseFormat: "json",
    });

    const relevantIndices: number[] = JSON.parse(llmResponse.text);
    console.log(`[SearchTranscript] LLM selected ${relevantIndices.length} relevant chunks from ${candidatePool.length} candidates`);

    if (relevantIndices.length > 0) {
      const results = relevantIndices
        .filter(i => i >= 0 && i < candidatePool.length)
        .slice(0, limit)
        .map(i => {
          const chunk = candidatePool[i];
          return {
            speakerName: chunk.speakerName || "Unknown",
            content: chunk.content,
            chunkIndex: chunk.chunkIndex,
            matchType: "semantic" as const,
          };
        });

      if (results.length > 0) {
        return results;
      }
    }
  } catch (err) {
    console.error(`[SearchTranscript] LLM chunk selection failed, falling back to keyword matches:`, err);
  }

  if (keywordCandidates.length > 0) {
    console.log(`[SearchTranscript] Falling back to keyword matches (${keywordCandidates.length} chunks)`);

    const bothMatches = keywordCandidates.filter(chunk => {
      const content = chunk.content.toLowerCase();
      const hasProperNoun = properNouns.length > 0 && properNouns.some(noun => content.includes(noun));
      const hasKeyword = keywords.length > 0 && keywords.some(kw => content.includes(kw));
      return hasProperNoun && hasKeyword;
    });

    const bestMatches = bothMatches.length > 0 ? bothMatches : keywordCandidates;
    const matchType = bothMatches.length > 0 ? "both" : (keywords.length > 0 ? "keyword" : "proper_noun");

    return bestMatches.slice(0, limit).map(chunk => ({
      speakerName: chunk.speakerName || "Unknown",
      content: chunk.content,
      chunkIndex: chunk.chunkIndex,
      matchType: matchType as "both" | "keyword" | "proper_noun",
    }));
  }

  return [];
}
