export type TranscriptChunk = {
  id: string
  content: string
  speakerName: string
  speakerRole: 'customer' | 'leverege' | 'unknown'
  meetingDate: Date
  chunkIndex: number
}
