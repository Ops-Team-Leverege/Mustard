/**
 * Get Company Questions Capability
 * 
 * Purpose:
 * Retrieves Q&A pairs (interpreted Q&A) for a specific company.
 * Note: For verbatim customer questions, use customer_questions table instead.
 * 
 * Layer: MCP Capability (Extended Search - blocked in Single-Meeting Orchestrator)
 */

import { z } from "zod";
import { Capability } from "../types";

export const getCompanyQuestions: Capability = {
  name: "get_company_questions",
  description: "Get questions asked by a specific company.",
  inputSchema: z.object({
    companyName: z.string(),
  }),
  handler: async ({ db }, { companyName }) => {
    return db.query(
      `
      SELECT q.question, q.answer
      FROM qa_pairs q
      JOIN companies c ON q.company_id = c.id
      WHERE c.name ILIKE $1
      `,
      [companyName]
    );
  },
};
