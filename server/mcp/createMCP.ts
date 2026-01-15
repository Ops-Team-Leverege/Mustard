import type { MCPContext } from "./types";
import { decideCapability } from "./llm";
import { capabilities } from "./capabilities";

export type MCPResult = {
  capabilityName: string;
  result: unknown;
  resolvedEntities?: {
    companyId?: string;
    meetingId?: string;
    people?: string[];
  };
};

/**
 * Merge thread context into capability args if they weren't explicitly provided.
 * 
 * IMPORTANT: This enables follow-up questions in Slack threads by reusing
 * previously resolved entity IDs (meetingId, companyId) without feeding
 * prior answers to LLMs. This is context reuse, not conversation memory.
 */
function seedArgsFromThreadContext(
  args: Record<string, unknown>,
  ctx: MCPContext
): Record<string, unknown> {
  if (!ctx.threadContext) return args;
  
  const seeded = { ...args };
  
  // Seed meetingId if not explicitly provided
  if (!seeded.meetingId && ctx.threadContext.meetingId) {
    seeded.meetingId = ctx.threadContext.meetingId;
    console.log(`[MCP] Seeded meetingId from thread context: ${ctx.threadContext.meetingId}`);
  }
  
  // Seed companyId if not explicitly provided
  if (!seeded.companyId && ctx.threadContext.companyId) {
    seeded.companyId = ctx.threadContext.companyId;
    console.log(`[MCP] Seeded companyId from thread context: ${ctx.threadContext.companyId}`);
  }
  
  return seeded;
}

export function createMCP(ctx: MCPContext) {
  async function run(name: string, input: unknown): Promise<MCPResult> {
    const capability = capabilities.find(c => c.name === name);
    if (!capability) throw new Error(`Unknown capability: ${name}`);

    const parsedInput = capability.inputSchema.parse(input);
    const result = await capability.handler(ctx, parsedInput);
    
    // Extract resolved entities from input args if available
    // Note: Only capture actual IDs, not slugs - slugs are not IDs
    const resolvedEntities: MCPResult["resolvedEntities"] = {};
    if (typeof input === "object" && input !== null) {
      const args = input as Record<string, unknown>;
      if (args.companyId) resolvedEntities.companyId = String(args.companyId);
      if (args.meetingId) resolvedEntities.meetingId = String(args.meetingId);
      // companySlug is intentionally NOT captured as companyId - they are different things
    }
    
    return { capabilityName: name, result, resolvedEntities };
  }

  async function runFromText(text: string): Promise<MCPResult> {
    const descriptors = capabilities.map(c => ({
      name: c.name,
      description: c.description,
      parameters: c.inputSchema,
    }));

    const { name, args } = await decideCapability({
      text,
      capabilities: descriptors,
    });

    // Handle fallback when no capability was selected
    if (name === "__fallback__") {
      return {
        capabilityName: "__fallback__",
        result: args.response,
      };
    }

    // Seed args from thread context if available (enables follow-up questions)
    const seededArgs = seedArgsFromThreadContext(args, ctx);

    return run(name, seededArgs);
  }

  return { run, runFromText };
}

