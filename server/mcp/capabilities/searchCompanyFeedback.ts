// src/mcp/capabilities/searchCompanyFeedback.ts
import { z } from "zod";
import { Capability } from "../types";

export const searchCompanyFeedback: Capability = {
  name: "search_company_feedback",
  description: "Search customer feedback across companies by keyword.",
  inputSchema: z.object({
    keyword: z.string(),
  }),
  handler: async ({ db }, { keyword }) => {
    return db.query(
      `
      SELECT c.name AS company, pi.feature, pi.quote
      FROM product_insights pi
      JOIN companies c ON pi.company_id = c.id
      WHERE pi.context ILIKE $1 OR pi.quote ILIKE $1
      `,
      [`%${keyword}%`]
    );
  },
};
