/**
 * RAG Type Definitions
 * 
 * Purpose:
 * Shared types for RAG transcript chunks and outputs.
 * 
 * Note: Uses snake_case to match raw SQL query results.
 * 
 * Layer: RAG (type definitions)
 */

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
