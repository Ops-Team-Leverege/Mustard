import type { MCPContext } from "./types";
import { storage } from "../storage";

export function makeMCPContext(): MCPContext {
  return {
    db: {
      async query(sql: string) {
        return storage.rawQuery(sql);
      },
    },
  };
}
