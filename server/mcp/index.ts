/**
 * MCP Runtime
 * 
 * Purpose:
 * Creates an MCP instance that can run capabilities by name.
 * This is the main entry point for executing MCP capabilities.
 * 
 * Usage:
 * - createMCP(ctx).run("get_company_overview", { companyName: "Acme" })
 * - createMCP(ctx).list() to get available capabilities
 * 
 * Layer: MCP (orchestration)
 */

import type { MCPContext } from "./types";
import { capabilities } from "./capabilities";



export function createMCP(ctx: MCPContext) {
  return {
    async run(name: string, input: unknown) {
      const capability = capabilities.find(c => c.name === name);

      if (!capability) {
        throw new Error(`Unknown capability: ${name}`);
      }

      const parsedInput = capability.inputSchema.parse(input);
      return capability.handler(ctx, parsedInput);
    },

    list() {
      return capabilities.map(c => ({
        name: c.name,
        description: c.description,
        inputSchema: c.inputSchema,
      }));
    },
  };
}
