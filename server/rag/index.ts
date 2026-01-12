// server/rag/index.ts
import { getLastMeetingChunks } from "./retriever";

export async function answerQuestion(params: {
  question: string;
  companyId: string;
  mode?: "summary" | "last_meeting";
}) {
  const mode = params.mode ?? "summary";

  if (mode === "last_meeting" || mode === "summary") {
    const chunks = await getLastMeetingChunks(params.companyId, 120);

    if (!chunks.length) {
      return {
        answer: "I couldn't find any transcript chunks for that company yet. (Have we run ingestion?)",
        citations: [],
      };
    }

    // Deterministic “summary”: first N customer + leverege turns
    const key = chunks.slice(0, 20).map((c) => {
      const who = c.speaker_role ? `[${c.speaker_role}]` : "";
      return `${who} ${c.speaker_name ?? "Unknown"}: ${c.content}`;
    });

    const citations = chunks.slice(0, 10).map((c) => ({
      chunkId: c.id,
      transcriptId: c.transcript_id,
      chunkIndex: c.chunk_index,
    }));

    return {
      answer:
        `Here are the first discussion turns from the most recent meeting:\n\n` +
        key.join("\n"),
      citations,
    };
  }

  return { answer: "Mode not implemented yet.", citations: [] };
}
