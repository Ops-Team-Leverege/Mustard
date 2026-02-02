/**
 * Get Company Overview Capability
 * 
 * Purpose:
 * Returns a summary overview of a company including notes, stage,
 * and counts of insights and Q&A pairs.
 * 
 * Layer: MCP Capability
 */

import { z } from "zod";
import type { Capability } from "../types";

export const getCompanyOverview: Capability = {
  name: "get_company_overview",
  description: "Get a summary overview of a company based on all available data.",
  inputSchema: z.object({
    companyName: z.string(),
  }),
  handler: async ({ db }, { companyName }) => {
    // Get company info, insights count, and Q&A count
    const rows = await db.query(
      `
      SELECT 
        c.name,
        c.notes,
        c.stage,
        (SELECT COUNT(*) FROM product_insights pi WHERE pi.company_id = c.id) as insights_count,
        (SELECT COUNT(*) FROM qa_pairs q WHERE q.company_id = c.id) as qa_count
      FROM companies c
      WHERE c.name ILIKE $1
      LIMIT 1
      `,
      [companyName]
    );
    return rows[0] || { error: "Company not found" };
  },
};
