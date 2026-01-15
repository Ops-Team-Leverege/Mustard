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
