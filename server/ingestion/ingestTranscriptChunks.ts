/**
 * Transcript ingestion pipeline.
 *
 * Responsibilities:
 * - Parse raw transcript text into speaker-turn chunks
 * - Assign speaker roles conservatively (leverege | customer | unknown)
 * - Insert transcript chunks idempotently into the database
 *
 * This file MUST NOT:
 * - Call LLMs
 * - Perform summarization or analysis
 * - Guess speaker identities
 *
 * Layer: Ingestion (deterministic, write-only)
 */


// server/ingestion/ingestTranscriptChunks.ts
import { storage } from "../storage";

// Adjust this type to match your transcripts table shape.
type TranscriptRow = {
  id: string;
  companyId: string;
  content: string; // raw transcript text
  meetingDate: Date; // or string -> convert to Date
  leverageTeam?: string | null; // comma-separated names (if you have it)
  customerNames?: string | null; // comma-separated names (if you have it)
};

type ChunkInsert = {
  transcriptId: string;
  companyId: string;
  content: string;
  chunkIndex: number;
  speakerName: string | null;
  speakerRole: "customer" | "leverege" | "unknown" | null;
  meetingDate: Date | null;
  startTimestamp: string | null;
  // embedding intentionally omitted for now
};

function normalizeName(s: string) {
  return s.trim().toLowerCase();
}

function assignSpeakerRole(
  speakerName: string,
  leverageTeam?: string | null,
  customerNames?: string | null
): "customer" | "leverege" | "unknown" {
  const speaker = normalizeName(speakerName);

  const leverege = (leverageTeam ?? "")
    .split(",")
    .map(normalizeName)
    .filter(Boolean);

  const customers = (customerNames ?? "")
    .split(",")
    .map(normalizeName)
    .filter(Boolean);

  const matches = (list: string[]) =>
    list.some((n) => n && (speaker.includes(n) || n.includes(speaker)));

  if (matches(leverege)) return "leverege";
  if (matches(customers)) return "customer";
  return "unknown";
}

type ParsedTurn = {
  speakerName: string;
  content: string;
  startTimestamp: string | null;
};

// Very pragmatic parser for your format:
// Speaker Name: text...
// 00:03:06
// Speaker Name: next...
export function parseTranscriptTurns(raw: string): ParsedTurn[] {
  const lines = raw.split("\n");
  const timestampRe = /^(\d{2}:\d{2}:\d{2})\s*$/;
  const speakerRe = /^([A-Za-z][A-Za-z\s'’.·\-\.]+):\s*(.*)$/;

  let currentTs: string | null = null;
  let currentSpeaker: string | null = null;
  let currentContent: string[] = [];
  const turns: ParsedTurn[] = [];

  const flush = () => {
    if (currentSpeaker && currentContent.length) {
      turns.push({
        speakerName: currentSpeaker,
        content: currentContent.join(" ").trim(),
        startTimestamp: currentTs,
      });
    }
    currentSpeaker = null;
    currentContent = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const tsMatch = line.match(timestampRe);
    if (tsMatch) {
      currentTs = tsMatch[1];
      continue;
    }

    const spMatch = line.match(speakerRe);
    if (spMatch) {
      flush();
      currentSpeaker = spMatch[1].trim();
      const first = spMatch[2]?.trim();
      if (first) currentContent.push(first);
      continue;
    }

    // continuation line
    if (currentSpeaker) currentContent.push(line);
  }

  flush();
  return turns;
}

/**
 * Minimal ingestion:
 * - fetch transcripts (you'll wire this to your storage)
 * - parse speaker turns
 * - insert rows into transcript_chunks
 *
 * NOTE: this assumes you add ONE storage method:
 *   storage.insertTranscriptChunks(chunks: ChunkInsert[])
 * and ONE fetch method:
 *   storage.listTranscriptsForChunking(...)
 */
export async function ingestTranscriptChunks(options?: {
  transcriptId?: string;
  companyId?: string;
  limit?: number;
  dryRun?: boolean;
}) {
  const { transcriptId, companyId, limit = 200, dryRun = false } = options ?? {};

  // You may already have something similar; if not, add it to storage.
  const transcripts: TranscriptRow[] = await storage.listTranscriptsForChunking({
    transcriptId,
    companyId,
    limit,
  });

  let transcriptsProcessed = 0;
  let chunksPrepared = 0;

  for (const t of transcripts) {
    transcriptsProcessed++;

    const turns = parseTranscriptTurns(t.content);
    const chunks: ChunkInsert[] = turns.map((turn, i) => ({
      transcriptId: t.id,
      companyId: t.companyId,
      content: turn.content,
      chunkIndex: i,
      speakerName: turn.speakerName,
      speakerRole: assignSpeakerRole(
        turn.speakerName,
        t.leverageTeam ?? null,
        t.customerNames ?? null
      ),
      meetingDate: t.meetingDate ?? null,
      startTimestamp: turn.startTimestamp,
    }));

    chunksPrepared += chunks.length;

    if (!dryRun) {
      // This should be an upsert/ignore strategy to keep it idempotent.
      await storage.insertTranscriptChunks(chunks);
    }
  }

  return {
    transcriptsProcessed,
    chunksPrepared,
    dryRun,
  };
}
