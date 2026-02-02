/**
 * MCP Runtime
 * 
 * Purpose:
 * Creates an MCP instance that can run tools by name.
 * This is the main entry point for executing MCP tools.
 * 
 * Usage:
 * - createMCP(ctx).run("get_company_overview", { companyName: "Acme" })
 * - createMCP(ctx).list() to get available tools
 * 
 * Layer: MCP (orchestration)
 */

import type { MCPContext } from "./types";
import { tools } from "./tools";



export function createMCP(ctx: MCPContext) {
  return {
    async run(name: string, input: unknown) {
      const tool = tools.find(t => t.name === name);

      if (!tool) {
        throw new Error(`Unknown tool: ${name}`);
      }

      const parsedInput = tool.inputSchema.parse(input);
      return tool.handler(ctx, parsedInput);
    },

    list() {
      return tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
    },
  };
}
