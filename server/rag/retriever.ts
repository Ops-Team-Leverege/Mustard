/**
 * Transcript retrieval logic for RAG.
 *
 * Responsibilities:
 * - Select the correct transcript (e.g. most recent meeting)
 * - Retrieve speaker-turn chunks in deterministic order
 *
 * This file MUST NOT:
 * - Call LLMs
 * - Perform summarization or formatting
 * - Modify or infer speaker roles
 *
 * Layer: RAG – Retrieval (deterministic)
 */


import { storage } from "../storage";
import type { TranscriptChunk } from "./types";

/**
 * Returns chunks from the most recent transcript (meeting)
 * for a given company using storage abstraction.
 */
export async function getLastMeetingChunks(
  companyId: string,
  limit = 50
): Promise<TranscriptChunk[]> {
  // 1. Find the most recent transcript for this company
  const transcriptId = await storage.getLastTranscriptIdForCompany(companyId);

  if (!transcriptId) {
    return [];
  }

  // 2. Fetch chunks for that transcript
  const chunks = await storage.getChunksForTranscript(transcriptId, limit);

  // 3. Map from Drizzle camelCase to RAG TranscriptChunk type
  return chunks.map((chunk) => ({
    id: chunk.id,
    transcript_id: chunk.transcriptId,
    company_id: chunk.companyId,
    content: chunk.content,
    chunk_index: chunk.chunkIndex,
    speaker_name: chunk.speakerName || "Unknown",
    speaker_role: (chunk.speakerRole as "customer" | "leverege" | "unknown") || "unknown",
    meeting_date: chunk.meetingDate || new Date(),
    start_timestamp: chunk.startTimestamp || null,
  }));
}
