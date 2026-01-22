/**
 * MCP Context Factory
 * 
 * Purpose:
 * Creates the context object passed to all MCP capabilities.
 * Provides database access and optional thread context for follow-up queries.
 * 
 * Layer: MCP (context setup)
 */

import type { MCPContext, ThreadContext } from "./types";
import { storage } from "../storage";

export function makeMCPContext(threadContext?: ThreadContext): MCPContext {
  return {
    db: {
      async query(sql: string, params?: any[]) {
        return storage.rawQuery(sql, params);
      },
    },
    threadContext,
  };
}

export type { MCPContext, ThreadContext };
