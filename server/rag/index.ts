import { getLastMeetingChunks } from "./retriever";

export async function answerQuestion(params: {
  question: string;
  companyId: string;
  mode?: "last_meeting" | "summary";
}) {
  const mode = params.mode ?? "last_meeting";

  if (mode === "last_meeting") {
    const chunks = await getLastMeetingChunks(params.companyId, 50);

    if (chunks.length === 0) {
      return {
        answer: "No transcript data found for the most recent meeting.",
        citations: [],
      };
    }

    const lines = chunks.slice(0, 15).map((c) => {
      const role = c.speakerRole ? `[${c.speakerRole}]` : "";
      return `${role} ${c.speakerName ?? "Unknown"}: ${c.content}`;
    });

    return {
      answer:
        "Here are the first discussion turns from the most recent meeting:\n\n" +
        lines.join("\n"),
      citations: chunks.slice(0, 10).map((c) => ({
        transcriptId: c.transcriptId,
        chunkIndex: c.chunkIndex,
      })),
    };
  }

  return {
    answer: "Mode not implemented yet.",
    citations: [],
  };
}
