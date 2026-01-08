/*This file:
knows about Postgres
knows about pgvector
knows about speaker_role, meeting_date, etc.*/


export async function getLastMeetingChunks(companyId: string)

export async function searchChunks(params: {
  embedding: number[]
  companyId?: string
  speakerRole?: 'customer' | 'leverege'
  limit: number
})
