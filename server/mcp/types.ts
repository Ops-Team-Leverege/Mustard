import type { z } from "zod";

// The vocabulary the MCP uses to reason about the world
export type CompanyOverviewInput = {
  question: string
  companyId?: string
}

/**
 * Thread context reused from prior interactions.
 * 
 * IMPORTANT ARCHITECTURAL BOUNDARY:
 * Thread follow-ups reuse resolved entity context only.
 * LLMs never see prior answers or interaction history.
 * 
 * This enables natural follow-up questions in Slack threads
 * without introducing conversation memory or hallucination risk.
 */
export type ThreadContext = {
  meetingId?: string | null;
  companyId?: string | null;
  // Prior answer is NOT included - LLMs must not see this
};

export type MCPContext = {
  db: {
    query(sql: string, params?: any[]): Promise<any[]>;
  };
  /**
   * Optional context from prior interaction in the same thread.
   * Contains only resolved entity IDs, never prior answers.
   */
  threadContext?: ThreadContext;
}

export type Capability = {
  name: string;
  description: string;
  inputSchema: z.ZodType<any>;
  handler: (ctx: MCPContext, input: any) => Promise<any>;
}
