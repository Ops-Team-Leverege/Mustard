/*This file:
knows about Postgres
knows about pgvector
knows about speaker_role, meeting_date, etc.*/

import { storage } from '../storage'
import type { TranscriptChunk } from './types'

/**
 * Returns chunks from the most recent transcript (meeting)
 * for a given company.
 */
export async function getLastMeetingChunks(
  companyId: string,
  limit = 50
): Promise<TranscriptChunk[]> {
  // 1️⃣ Find the most recent transcript for this company
  const latestRows = await storage.rawQuery(
    `SELECT transcript_id
     FROM transcript_chunks
     WHERE company_id = $1
     ORDER BY meeting_date DESC NULLS LAST
     LIMIT 1`,
    [companyId]
  );

  if (!latestRows || latestRows.length === 0) {
    return [];
  }

  const transcriptId = latestRows[0].transcript_id;

  // 2️⃣ Fetch chunks for that transcript
  const rows = await storage.rawQuery(
    `SELECT
       id,
       transcript_id,
       company_id,
       content,
       chunk_index,
       speaker_name,
       speaker_role,
       meeting_date,
       start_timestamp
     FROM transcript_chunks
     WHERE transcript_id = $1
     ORDER BY chunk_index
     LIMIT $2`,
    [transcriptId, limit]
  );

  return rows as TranscriptChunk[];
}
