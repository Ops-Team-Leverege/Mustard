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

    return run(name, args);
  }

  return { run, runFromText };
}

