/*Shared types for RAG transcript chunks and outputs.
Important note: Uses camelCase to match Drizzle output*/

export type TranscriptChunk = {
  id: string
  transcript_id: string
  company_id: string
  content: string
  chunk_index: number
  speaker_name: string
  speaker_role: 'customer' | 'leverege' | 'unknown'
  meeting_date: Date
  start_timestamp: string | null
}
