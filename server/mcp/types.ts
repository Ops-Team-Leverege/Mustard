import type { z } from "zod";

// The vocabulary the MCP uses to reason about the world
export type CompanyOverviewInput = {
  question: string
  companyId?: string
}

export type MCPContext = {
  db: {
    query(sql: string, params?: any[]): Promise<any[]>;
  };
}

export type Capability = {
  name: string;
  description: string;
  inputSchema: z.ZodType<any>;
  handler: (ctx: MCPContext, input: any) => Promise<any>;
}
