// src/mcp/capabilities/searchQuestions.ts
import { z } from "zod";
import { Capability } from "../types";

export const searchQuestions: Capability = {
  name: "search_questions",
  description: "Search questions asked across all companies.",
  inputSchema: z.object({
    keyword: z.string(),
  }),
  handler: async ({ db }, { keyword }) => {
    return db.query(
      `
      SELECT c.name AS company, q.question, q.answer
      FROM qa_pairs q
      JOIN companies c ON q.company_id = c.id
      WHERE q.question ILIKE $1
      `,
      [`%${keyword}%`]
    );
  },
};
