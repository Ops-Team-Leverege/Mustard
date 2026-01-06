// src/mcp/capabilities/getCompanyOverview.ts
import { z } from "zod";
import { Capability } from "../types";

export const getCompanyOverview: Capability = {
  name: "get_company_overview",
  description: "Get basic information about a company.",
  inputSchema: z.object({
    companyName: z.string(),
  }),
  handler: async ({ db }, { companyName }) => {
    const rows = await db.query(
      `SELECT id, name, stage FROM companies WHERE name ILIKE $1`,
      [companyName]
    );

    return rows[0] ?? null;
  },
};
