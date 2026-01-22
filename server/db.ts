/**
 * Database Connection
 * 
 * Purpose:
 * Provides a shared database connection using Drizzle ORM with Neon.
 * Used by services that need direct database access outside of storage.ts.
 * 
 * Layer: Infrastructure
 */

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";

function createDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  const queryClient = neon(process.env.DATABASE_URL);
  return drizzle(queryClient);
}

export const db = createDb();
