/**
 * Search Questions Capability
 * 
 * Purpose:
 * Searches Q&A pairs across all companies by keyword.
 * Returns matching questions with answers and company context.
 * 
 * Layer: MCP Tool (Extended Search - blocked in Single-Meeting Orchestrator)
 */

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
