//The vocabulary the MCP uses to reason about the world

import { z } from "zod";

export type MCPContext = {
  db: {
    query: (sql: string) => Promise<any[]>;
  };
};
/**
 * Helper type so every capability looks the same
 */
export type Capability = {
  name: string;
  description: string;
  inputSchema: z.ZodSchema<any>;
  handler: (ctx: MCPContext, input: any) => Promise<any>;

};
