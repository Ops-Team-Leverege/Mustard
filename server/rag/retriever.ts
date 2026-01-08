/*This file:
knows about Postgres
knows about pgvector
knows about speaker_role, meeting_date, etc.*/


import { sql } from '../storage' // or wherever your DB helper lives
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
  const [latest] = await sql<{
    transcript_id: string
  }>`
    SELECT transcript_id
    FROM transcript_chunks
    WHERE company_id = ${companyId}
    ORDER BY meeting_date DESC
    LIMIT 1
  `

  if (!latest) {
    return []
  }

  // 2️⃣ Fetch chunks for that transcript
  const rows = await sql<TranscriptChunk>`
    SELECT
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
    WHERE transcript_id = ${latest.transcript_id}
    ORDER BY chunk_index
    LIMIT ${limit}
  `

  return rows
}
