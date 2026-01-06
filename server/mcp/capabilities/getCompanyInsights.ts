// src/mcp/capabilities/getCompanyInsights.ts
import { z } from "zod";
import { Capability } from "../types";

export const getCompanyInsights: Capability = {
  name: "get_company_insights",
  description: "Get product insights for a specific company.",
  inputSchema: z.object({
    companyName: z.string(),
    product: z.string().optional(),
  }),
  handler: async ({ db }, { companyName, product }) => {
    const params: any[] = [companyName];
    let productFilter = "";

    if (product) {
      params.push(product);
      productFilter = `AND pi.product = $2`;
    }

    return db.query(
      `
      SELECT pi.feature, pi.context, pi.quote
      FROM product_insights pi
      JOIN companies c ON pi.company_id = c.id
      WHERE c.name ILIKE $1
      ${productFilter}
      `,
      params
    );
  },
};
