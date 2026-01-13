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
    const companyRows = await db.query(
      `SELECT id FROM companies WHERE name ILIKE $1 LIMIT 1`,
      [companyName]
    );

    if (!companyRows || companyRows.length === 0) {
      return { answer: `Company "${companyName}" not found.`, citations: [] };
    }

    const companyId = companyRows[0].id;

    const result = await answerQuestion({
      question,
      companyId,
      mode: "last_meeting",
    });

    return result;
  },
};
