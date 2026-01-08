CREATE EXTENSION IF NOT EXISTS vector;

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;


CREATE TABLE transcript_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  transcript_id UUID NOT NULL,
  company_id UUID NOT NULL,

  content TEXT NOT NULL,
  embedding VECTOR(1536),

  chunk_index INTEGER NOT NULL,
  speaker_name TEXT NOT NULL,
  speaker_role TEXT NOT NULL,

  meeting_date TIMESTAMP NOT NULL,
  start_timestamp TEXT,

  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_chunks_company_date
  ON transcript_chunks (company_id, meeting_date DESC);

CREATE INDEX idx_chunks_role
  ON transcript_chunks (speaker_role);

CREATE INDEX idx_chunks_embedding
  ON transcript_chunks
  USING ivfflat (embedding vector_cosine_ops);
