import { z } from "zod";
import type { Capability } from "../types";
import { getLastMeetingChunks } from "../../rag/retriever";
import {
  composeMeetingSummary,
  selectRepresentativeQuotes,
  type TranscriptChunk as ComposerChunk,
} from "../../rag/composer";
import { storage } from "../../storage";

export const getLastMeeting: Capability = {
  name: "get_last_meeting",
  description:
    "Get information about the last/most recent meeting with a company. Use this when asked about what was discussed in the last meeting, recent meeting topics, or latest conversation with a company.",
  inputSchema: z.object({
    companyName: z.string().describe("The name of the company to get the last meeting for"),
    question: z.string().describe("The specific question about the meeting"),
  }),
  handler: async ({ db }, { companyName /* question intentionally unused */ }) => {
    // Step 1: Resolve company name with case-insensitive partial match
    const companyRows = await db.query(
      `SELECT id, name FROM companies WHERE name ILIKE $1`,
      [`%${companyName}%`]
    );

    if (!companyRows || companyRows.length === 0) {
      return {
        answer: `I couldn't find a company matching "${companyName}". Please check the spelling or try a different name.`,
        citations: [],
      };
    }

    if (companyRows.length > 1) {
      const names = companyRows.map((c: { name: string }) => c.name).join(", ");
      return {
        answer: `I found multiple companies matching "${companyName}": ${names}. Please be more specific about which company you mean.`,
        citations: [],
      };
    }

    const companyId = companyRows[0].id;
    const resolvedName = companyRows[0].name;

    // Step 2: Retrieve last meeting transcript chunks (deterministic)
    // getLastMeetingChunks uses storage abstraction internally
    const result = await getLastMeetingChunks(companyId);

    if (!result || result.chunks.length === 0) {
      return {
        answer: `I couldn't find any meeting transcripts for ${resolvedName}.`,
        citations: [],
      };
    }

    const { chunks: rawChunks, transcriptId, transcriptCreatedAt } = result;

    // Map retriever's snake_case to composer's camelCase format
    const composerChunks: ComposerChunk[] = rawChunks.map((c) => ({
      chunkIndex: c.chunk_index,
      speakerRole: c.speaker_role,
      speakerName: c.speaker_name,
      text: c.content,
    }));

    // Step 3: Compose structured outputs (LLM-only)
    const summary = await composeMeetingSummary(composerChunks);
    const quotes = await selectRepresentativeQuotes(composerChunks);

    // Step 4: Persist the artifact for later reuse
    // Use transcript.created_at as the meeting timestamp (meeting time, not processing time)
    await storage.saveMeetingSummary({
      companyId,
      transcriptId,
      meetingTimestamp: transcriptCreatedAt,
      artifact: { summary, quotes },
    });

    // Step 5: Render response (presentation logic stays here)
    const lines: string[] = [];

    lines.push(`*[${resolvedName}] ${summary.title}*`);
    lines.push(`_${new Date(transcriptCreatedAt).toLocaleDateString()}_`);

    if (summary.purpose) {
      lines.push("\n*Purpose*");
      lines.push(`• ${summary.purpose}`);
    }

    if (summary.focusAreas?.length) {
      lines.push("\n*Focus Areas*");
      summary.focusAreas.forEach((f) => lines.push(`• ${f}`));
    }

    if (summary.keyTakeaways.length) {
      lines.push("\n*Key Takeaways*");
      summary.keyTakeaways.forEach((t) => lines.push(`• ${t}`));
    }

    if (summary.risksOrOpenQuestions.length) {
      lines.push("\n*Risks / Open Questions*");
      summary.risksOrOpenQuestions.forEach((r) => lines.push(`• ${r}`));
    }

    if (summary.recommendedNextSteps.length) {
      lines.push("\n*Recommended Next Steps*");
      summary.recommendedNextSteps.forEach((n) => lines.push(`• ${n}`));
    }

    if (quotes.length) {
      lines.push("\n*Representative Quotes*");
      quotes.forEach((q) => {
        lines.push(`• "${q.quote}" — ${q.speakerRole}`);
      });
    }

    return {
      answer: lines.join("\n"),
      citations: [],
    };
  },
};
