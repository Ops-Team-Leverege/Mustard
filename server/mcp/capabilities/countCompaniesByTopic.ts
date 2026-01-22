/**
 * Count Companies By Topic Capability
 * 
 * Purpose:
 * Counts how many distinct companies mentioned a given topic.
 * Searches across product insights context and quotes.
 * 
 * Layer: MCP Capability
 */

import { z } from "zod";
import { Capability } from "../types";

export const countCompaniesByTopic: Capability = {
  name: "count_companies_by_topic",
  description: "Count how many companies mentioned a given topic.",
  inputSchema: z.object({
    keyword: z.string(),
  }),
  handler: async ({ db }, { keyword }) => {
    const rows = await db.query(
      `
      SELECT COUNT(DISTINCT company_id) AS count
      FROM product_insights
      WHERE context ILIKE $1 OR quote ILIKE $1
      `,
      [`%${keyword}%`]
    );

    return rows[0];
  },
};
