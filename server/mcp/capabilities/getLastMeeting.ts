import { z } from "zod";
import type { Capability } from "../types";
import { answerQuestion } from "../../rag";

export const getLastMeeting: Capability = {
  name: "get_last_meeting",
  description: "Get information about the last/most recent meeting with a company. Use this when asked about what was discussed in the last meeting, recent meeting topics, or latest conversation with a company.",
  inputSchema: z.object({
    companyName: z.string().describe("The name of the company to get the last meeting for"),
    question: z.string().describe("The specific question about the meeting"),
  }),
  handler: async ({ db }, { companyName, question }) => {
    // Step 1: Resolve company name with case-insensitive partial match
    const companyRows = await db.query(
      `SELECT id, name FROM companies WHERE name ILIKE $1`,
      [`%${companyName}%`]
    );

    // Handle 0 matches
    if (!companyRows || companyRows.length === 0) {
      return {
        answer: `I couldn't find a company matching "${companyName}". Please check the spelling or try a different name.`,
        citations: [],
      };
    }

    // Handle >1 matches - ask for clarification
    if (companyRows.length > 1) {
      const names = companyRows.map((c: { name: string }) => c.name).join(", ");
      return {
        answer: `I found multiple companies matching "${companyName}": ${names}. Please be more specific about which company you mean.`,
        citations: [],
      };
    }

    // Exactly 1 match - proceed with RAG
    const companyId = companyRows[0].id;
    const resolvedName = companyRows[0].name;

    const result = await answerQuestion({
      question,
      companyId,
      mode: "last_meeting",
    });

    // Prepend the resolved company name for clarity
    return {
      answer: `[${resolvedName}] ${result.answer}`,
      citations: result.citations,
    };
  },
};
