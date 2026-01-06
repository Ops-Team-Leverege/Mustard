import type { MCPContext } from "./types";
import { storage } from "../storage";
import { sql as drizzleSql } from "drizzle-orm";

export function makeMCPContext(): MCPContext {
  return {
    db: {
      query: async (query: string) => {
        const stmt = drizzleSql.raw(query);
        const result = await storage["db"].execute(stmt);
        return result.rows as any[];
      },
    },
  };
}
